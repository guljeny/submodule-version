import chalk from 'chalk';
import { SVError, ERR } from '../../src';
import { log } from '../log';

export const handleSVError = (error: Error) => {
  if (!(error instanceof SVError)) return;

  const { error: code, details } = error;

  if (code === ERR.NOT_A_NPM) {
    log.error('Not a npm project');
  }

  if (code === ERR.NOT_A_GIT_REPO) {
    log.error('Is not a git repo');
  }

  if (code === ERR.NOT_A_GIT_URL) {
    log.error(chalk.red.bold(String(details.url || '')), '- is not a git url!');
  }

  if (code === ERR.NOT_INITIALIZED) {
    log.error('SV is not initialized - call init() first');
  }

  if (code === ERR.PATH_NOT_FOUND) {
    log.error('Path', chalk.red.bold(String(details.path)), 'is not found in the graph');
  }

  if (code === ERR.REQUESTED_VERSION_NOT_EXISTS) {
    const styledName = `Package ${chalk.bold.green(String(details.name))}`;
    const styledVer = chalk.bgRed.bold.white(` ${details.requestedVersion} `);
    const errMsg = `does not contain version ${styledVer}.`;
    const styledVList = chalk.bold.green((details.versions || []).join(', '));
    const helpMsg = `Use one from [${styledVList}]`;

    log.error(styledName, errMsg, helpMsg);
  }

  if (code === ERR.UNKNOWN_VERSION) {
    const stV = chalk.bgRed.bold.white(` ${details.version} `);
    const stName = chalk.red.bold(String(details.name));
    const stParent = chalk.green.bold(String(details.parent));

    log.error('Unknown version', stV, 'for', stName, 'in', stParent);
  }

  if (code === ERR.CIRCULAR_DEPENDENCY) {
    const chain = (details.chain || []).join(' -> ');

    log.error('Circular dependency:', chalk.red.bold(chain));
  }

  if (code === ERR.VERSION_CONFLICT) {
    const { parents, name, chain } = details;

    const longestVersion = Object.values(parents ?? {}).reduce((len, v) => (
      v.length > len ? v.length : len
    ), 0);

    const formattedName = chalk.green.bold(String(name));
    const baseMsg = `${chalk.red('Confilict')} for ${formattedName}:`;

    const conflictMsg = Object.entries(parents ?? {})
      .reduce((msg, [pName, v]) => {
        const formatedV = chalk.bold.red(
          String(v).padEnd(longestVersion, ' '),
        );

        return [
          ...msg,
          `  - Version ${formatedV} used in ${chalk.green.bold(pName)}`,
        ];
      }, [baseMsg]);

    if (chain?.length) {
      conflictMsg.push(`  chain: ${chain.join(' -> ')}`);
    }

    log.error(conflictMsg.join('\n'));
  }

  if (code === ERR.GIT_DIRTY_SWITCH_CONFLICT) {
    log.error('Checkout failed: uncommitted changes cannot be carried over - move them manually');
  }

  log.error(code);
};
