import { GraphError } from '../../Graph';
import { log } from '../../log';
import chalk from 'chalk';

export const handleBuildGraphError = (error: Error) => {
  if (!(error instanceof GraphError)) return;

  const { message: errorMessage, details } = error;

  if (errorMessage === 'NOT_A_NPM') {
    log.error('Not a npm project');
  }

  if (errorMessage === 'UNKNOWN_VERSION') {
    const { name, version, parent } = details;
    const stV = chalk.bgRed.bold.white(` ${version} `);
    const stName = chalk.red.bold(name);
    const stParent = chalk.green.bold(parent);

    log.error('Unknown version', stV, 'for', stName, 'in', stParent);
  }

  if (errorMessage === 'VERSION_CONFLICT') {
    const { parents, name } = details;

    const longestVersion = Object.values(parents ?? {}).reduce((len, v) => (
      v.length > len ? v.length : len
    ), 0);

    const formattedName = chalk.green.bold(name);
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

    log.error(conflictMsg.join('\n'));
  }

  log.error(errorMessage);
};
