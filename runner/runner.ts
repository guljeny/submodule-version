import chalk from 'chalk';
import yargs from 'yargs';
import { SV } from '../src';
import { log } from './log';
import { handleErrors } from './handleErrors';

const BASE_DIR = 'modules';

const makeEvent = (
  event: (sv: SV, arg: any) => Promise<void>,
  { skipInit = false } = {},
) => {
  return async (arg: any) => {
    const sv = new SV(process.cwd(), BASE_DIR);

    try {
      /* publish умеет работать с ещё не git/npm-инициализированным проектом */
      if (!skipInit) {
        await sv.init();
      }

      await event(sv, arg);
    } catch (e) {
      handleErrors(e as Error);
    }
  };
};

const install = makeEvent(async (sv, arg) => {
  const { url: gitUrl, target, version } = arg as {
    url: string,
    target?: string,
    version?: string,
  };
  await sv.add(gitUrl, target, version);
});

const update = makeEvent(async sv => {
  const versions = sv.listVersions();

  await Promise.all(Object.keys(versions).map(name => sv.setVersion(name)));
});

const setVersion = makeEvent(async (sv, arg) => {
  const { path, version } = arg as {path: string, version?: string};
  await sv.setVersion(path, version);
});

const remove = makeEvent(async (sv, arg) => {
  const { path } = arg as {path: string};
  await sv.remove(path);
});

const publish = makeEvent(async (sv, arg) => {
  const { module, bump, message, repoUrl } = arg as {
    module?: string,
    bump: 'release' | 'minor' | 'major',
    message?: string,
    repoUrl?: string,
  };

  const version = await sv.publish({ module, bump, message, repoUrl });

  log.message(
    chalk.green.bold('Published'),
    chalk.bgGreen.black(` ${module || 'project'} `),
    chalk.green.bold('version'),
    chalk.bgGreen.black(` ${version} `),
  );
}, { skipInit: true });

const validate = makeEvent(async sv => {
  const graph = sv.getGraph();

  Object.entries(graph.entries).forEach(([name, entry]) => {
    const noUsedVersion = !entry.version
      || !graph.used(name).includes(entry.version);

    if (noUsedVersion && Object.keys(entry.versions).length === 0) {
      log.message(
        chalk.yellow('⚠️  WARN: Module'),
        chalk.bgYellow.black(` ${name} `),
        chalk.yellow('does not contain any version tag!'),
      );
    }
  });

  log.message(chalk.green.bold('Everything is up to date!🔥'));
});

/* init внутри makeEvent: загрузит deps и напечатает граф */
const init = makeEvent(async () => {});

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
export const s = yargs.scriptName('sv')
  .usage('$0 <cmd> [args]')
  .command(
    ['validate', '$0', 'v'],
    'Validate and install modules',
    () => {},
    validate,
  )
  .command(
    ['init'],
    'Init project, load deps and print the graph',
    () => {},
    init,
  )
  .command(
    ['update', 'u'],
    'Update git modules to actual versions',
    () => {},
    update,
  )
  .command(
    ['install <url> [target] [version]', 'i'],
    'Install new submodule',
    y => y.positional('url', {
      type: 'string',
      describe: 'Git submodule url',
    }).positional('target', {
      type: 'string',
      describe: 'Target module path (A.B) or version (1.2.0)',
    }).positional('version', {
      type: 'string',
      describe: 'Version to install',
    }),
    install,
  )
  .command(
    ['set-version <path> [version]', 'sv'],
    'Set submodule version (latest allowed when omitted)',
    y => y.positional('path', {
      type: 'string',
      describe: 'Submodule path (A.B.C)',
    }).positional('version', {
      type: 'string',
      describe: 'Version to checkout',
    }),
    setVersion,
  )
  .command(
    ['remove <path>', 'r'],
    'Remove submodule by path',
    y => y.positional('path', {
      type: 'string',
      describe: 'Submodule path (A.B.C)',
    }),
    remove,
  )
  .command(
    ['publish [module]', 'p'],
    'Commit, tag and push a new version',
    y => y.positional('module', {
      type: 'string',
      describe: 'Module name (project itself when omitted)',
    }).option('bump', {
      type: 'string',
      describe: 'Version bump kind',
      choices: ['release', 'minor', 'major'] as const,
      default: 'release' as const,
    }).option('message', {
      type: 'string',
      alias: 'm',
      describe: 'Commit message',
    }).option('repo-url', {
      type: 'string',
      describe: 'Git repo url (required for the first publish)',
    }),
    publish,
  )
  .help()
  .argv;
