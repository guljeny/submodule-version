import { pkgJSONManager } from "./pkgJSONManager";
import { buildGraph } from "./buildGraph";
import { RunOptions } from "./runOptions";
import { versionUtil } from "./versionUtil";
import { git } from "./git";

export class SV {
  constructor (
    projectDir: string,
    modulesDir: string = 'addons',
  ) {
    RunOptions.cwd = projectDir;
    RunOptions.modulesDir = modulesDir;
  }

  public buildGraph = buildGraph;

  // eslint-disable-next-line class-methods-use-this
  public install = async (gitUrl: string, parentModule?: string) => {
    const { url, version, name } = git.parseUrl(gitUrl);

    if (!name) {
      throw new Error('NOT_A_GIT_URL');
    }

    const targetPkg = await pkgJSONManager.read(parentModule);
    let installedPkg = await pkgJSONManager.read(name);

    if (!installedPkg) {
      await git.addSumbmodule(url);
      installedPkg = pkgJSONManager.read(name);
    }

    const versions = await git.listVersions(name);
    const latestVersion = versionUtil.latest(versions);
    const requestedVersion = version || latestVersion;

    if (!versions.includes(requestedVersion) && versions.length) {
      throw new Error('REQUESTED_VERSION_NOT_EXISTS');
    }

    if (!targetPkg.sv) {
      targetPkg.sv = {};
    }

    targetPkg.sv[url] = requestedVersion ? `^${requestedVersion}` : '*';
    await pkgJSONManager.write(targetPkg, parentModule);
    await buildGraph();
  };

  // eslint-disable-next-line class-methods-use-this
  public update = async () => {
    const graph = await buildGraph();
    if (!graph) return;
    await Promise.all(Object.entries(graph).map(async ([name, data]) => {
      const { version, used } = data;
      const latestVersion = versionUtil.latest(used);
      if (latestVersion !== version) {
        await git.checkout(name, latestVersion);
      }
    }));
  };

  // eslint-disable-next-line class-methods-use-this
  public remove = async (submoduleName: string, parentModule?: string) => {
    await git.rm(submoduleName);
    const json = await pkgJSONManager.read(parentModule);

    if (!json.sv) return;

    json.sv = Object.keys(json.sv).reduce((acc, k) => {
      if (k.endsWith(`${submoduleName}.git`)) {
        return acc;
      }

      return { ...acc, [k]: json.sv[k] };
    }, {});

    await pkgJSONManager.write(json, parentModule);
    await buildGraph();
  };
}
