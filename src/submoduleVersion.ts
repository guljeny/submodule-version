import chalk from 'chalk';
import yargs from 'yargs';
import { buildGraph } from './buildGraph';
import { install } from './install';
import { log } from './log';

const mainProcess = () => {
  buildGraph();
  log.message(chalk.green.bold('Everything is up to date!🔥'));
};

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
yargs.scriptName('sv')
  .usage('$0 <cmd> [args]')
  .command(
    ['validate', '$0', 'v'],
    'Validate and install modules',
    () => {},
    mainProcess,
  )
  .command(
    ['install <url> [target]', 'i'],
    'Install new submodule',
    y => y.positional('url', {
      type: 'string',
      describe: 'Git submodule url',
    }).positional('target', {
      type: 'string',
      describe: 'Target module name',
    }),
    install,
  )
  .help()
  .argv;
