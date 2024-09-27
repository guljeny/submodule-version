import chalk from "chalk";
import { parseGitUrl } from "./parseGitUrl";
import { pkgJsonUtil } from "./pkgJsonUtil";
import { log } from "./log";
import { git } from "./git";
import { versionUtil } from "./versionUtil";
import { buildGraph } from "./buildGraph";

interface IArg {
  url: string;
  target?: string;
}

/* Yargs typed as any */
export const install = (arg: any) => {
  const { target } = arg as IArg;
  const { url, version, name } = parseGitUrl(arg.url);

  if (!name) {
    return log.error(chalk.red.bold(url), '- is not a git url!');
  }

  const targetPkg = pkgJsonUtil.read(target);
  let installedPkg = pkgJsonUtil.read(name);

  if (!installedPkg) {
    git.addSumbmodule(url);
    installedPkg = pkgJsonUtil.read(name);
  }

  const versions = git.listVersions(name);
  const latestVersion = versionUtil.latest(versions);
  const requestedVersion = version || latestVersion;

  if (!versions.includes(requestedVersion) && versions.length) {
    const styledName = `Package ${chalk.bold.green(name)}`;
    const styledVer = chalk.bgRed.bold.white(` ${requestedVersion} `);
    const errMsg = `does not contain version ${styledVer}.`;
    const styledVList = chalk.bold.green(versions.join(', '));
    const helpMsg = `Use one from [${styledVList}]`;
    log.error(styledName, errMsg, helpMsg);
  }

  targetPkg.sv[url] = requestedVersion ? `^${requestedVersion}` : '*';
  pkgJsonUtil.write(targetPkg, target);
  buildGraph();
};
