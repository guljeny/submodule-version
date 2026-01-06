import { PkgJSONManager } from "./PkgJSONManager";
import { Graph } from "./Graph";
import { RunOptions } from "./runOptions";
import { versionUtil } from "./versionUtil";
import { git } from "./git";

export class SV {
  private pkgJSONManager: PkgJSONManager;
  private graph: Graph;

  constructor (
    projectDir: string,
    modulesDir: string = 'addons',
  ) {
    RunOptions.cwd = projectDir;
    RunOptions.modulesDir = modulesDir;

    this.pkgJSONManager = new PkgJSONManager();
    this.graph = new Graph(this.pkgJSONManager);
  }

  public buildGraph = () => this.graph.build();

  public install = async (gitUrl: string, parentModule?: string) => {
    const { url, version, name } = git.parseUrl(gitUrl);

    if (!name) {
      throw new Error('NOT_A_GIT_URL');
    }

    const targetPkg = await this.pkgJSONManager.read(parentModule);
    let installedPkg = await this.pkgJSONManager.read(name);

    if (!installedPkg) {
      await git.addSumbmodule(url);
      installedPkg = this.pkgJSONManager.read(name);
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
    await this.pkgJSONManager.write(targetPkg, parentModule);
    await this.graph.build();
  };

  public update = async () => {
    const graph = await this.graph.build();
    if (!graph) return;
    await Promise.all(Object.entries(graph).map(async ([name, data]) => {
      const { version, used } = data;
      const latestVersion = versionUtil.latest(used);
      if (latestVersion !== version) {
        await git.checkout(name, latestVersion);
      }
    }));
  };

  public remove = async (submoduleName: string) => {
    await git.rm(submoduleName);
    await this.graph.build();
  };
}
