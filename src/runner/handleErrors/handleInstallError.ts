import chalk from 'chalk';
import { versionUtil } from "../../versionUtil";
import { log } from '../../log';
import { git } from '../../git';

export const handleInstallError = async (error: Error, gitUrl: string) => {
  const { message } = error;
  const { url, version, name } = git.parseUrl(gitUrl);

  if (message === 'NOT_A_GIT_URL') {
    return log.error(chalk.red.bold(url), '- is not a git url!');
  }

  if (message === 'REQUESTED_VERSION_NOT_EXISTS') {
    const versions = await git.listVersions(name);
    const latestVersion = versionUtil.latest(versions);
    const requestedVersion = version || latestVersion;
    const styledName = `Package ${chalk.bold.green(name)}`;
    const styledVer = chalk.bgRed.bold.white(` ${requestedVersion} `);
    const errMsg = `does not contain version ${styledVer}.`;
    const styledVList = chalk.bold.green(versions.join(', '));
    const helpMsg = `Use one from [${styledVList}]`;

    return log.error(styledName, errMsg, helpMsg);
  }
};
