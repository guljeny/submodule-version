import chalk from 'chalk';
import yargs from 'yargs';
import { buildGraph } from './buildGraph';
import { versionUtil } from './versionUtil';
import { install } from './install';
import { log } from './log';
import { git } from './git';

const mainProcess = () => {
  buildGraph();
  log.message(chalk.green.bold('Everything is up to date!🔥'));
};

const update = () => {
  const graph = buildGraph();
  if (!graph) return;
  Object.entries(graph).forEach(([name, data]) => {
    const { version, used } = data;
    const latestVersion = versionUtil.latest(used);
    if (latestVersion !== version) {
      git.checkout(name, latestVersion);
    }
  });
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
    ['update', 'u'],
    'Update git modules to actual versions',
    () => {},
    update,
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
