import chalk from 'chalk';
import yargs from 'yargs';
import {
  SV,
  SVError,
  TResolveError,
  printError,
  versionUtil,
} from '../src';
import { log } from './log';
import { handleErrors } from './handleErrors';

/* 'A.B.C' → { name: 'C', parent: 'B' } (parent — непосредственный родитель) */
const splitPath = (modulePath: string): { name: string, parent?: string } => {
  const parts = modulePath.split('.');
  const name = parts.pop() as string;

  return { name, parent: parts.pop() };
};

/*
 * Ошибки резолюции: при --force команда уже применила мутацию — печатаем
 * как warning и выходим с 0; без --force мутации не было — exit 1.
 */
const reportErrors = (errors: TResolveError[], force: boolean): void => {
  if (!errors.length) return;

  errors.forEach(error => {
    const paint = force ? chalk.yellow : chalk.red;

    log.message(paint(printError(error)));
  });

  if (!force) log.error('Resolve failed');
};

/* onError CLI — флаг --force: любые ошибки резолюции разрешены. */
const makeEvent = (
  event: (sv: SV, arg: any) => Promise<void>,
) => async (arg: any) => {
  const sv = new SV(process.cwd(), arg.modulesDir, {
    onError: async () => !!arg.force,
  });

  try {
    await event(sv, arg);
  } catch (e) {
    handleErrors(e as Error);
  }
};

const put = makeEvent(async (sv, arg) => {
  const { url: gitUrl, target, ver, force } = arg as {
    url: string,
    target?: string,
    ver?: string,
    force?: boolean,
  };

  const { errors } = await sv.resolve(
    gitUrl,
    ver || target,
    ver ? target : undefined,
  );

  reportErrors(errors, !!force);
});

const update = makeEvent(async (sv, arg) => {
  const { path: modulePath, force } = arg as {
    path?: string,
    force?: boolean,
  };

  if (!modulePath) {
    /* resolve без аргументов пересобирает модули на максимально разрешённые */
    const { errors } = await sv.resolve();

    reportErrors(errors, !!force);

    if (!errors.length) {
      log.message(chalk.green.bold('Modules are up to date!'));
    }

    return;
  }

  const { name, parent } = splitPath(modulePath);
  const { errors } = await sv.resolve(name, '*', parent);

  reportErrors(errors, !!force);
});

const del = makeEvent(async (sv, arg) => {
  const { path: modulePath, force } = arg as {
    path: string,
    force?: boolean,
  };
  const { name, parent } = splitPath(modulePath);
  const { errors } = await sv.resolve(name, null, parent);

  reportErrors(errors, !!force);
});

const listVersions = makeEvent(async (sv, arg) => {
  const { name, installed, force } = arg as {
    name?: string,
    installed?: boolean,
    force?: boolean,
  };

  const { resolution, errors } = await sv.resolve();

  reportErrors(errors, !!force);

  if (name && !resolution[name]) {
    throw new SVError('ADDON_NOT_FOUND', { name });
  }

  const names = name ? [name] : Object.keys(resolution);

  if (installed) {
    names.forEach(moduleName => {
      log.message(
        chalk.bold(moduleName),
        resolution[moduleName].version || chalk.red('no version tag'),
      );
    });

    return;
  }

  names.forEach(moduleName => {
    const versions = versionUtil.sort(
      Object.keys(resolution[moduleName].versions),
    );

    log.message(chalk.bold(moduleName), versions.join(', '));
  });
});

/* publish умеет работать с ещё не git/npm-инициализированным проектом */
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
});

const validate = makeEvent(async (sv, arg) => {
  const { errors } = await sv.resolve(arg.checkOnly ? true : undefined);

  reportErrors(errors, !!arg.force);

  if (!errors.length) {
    log.message(chalk.green.bold('Everything is up to date!🔥'));
  }
});

export const s = yargs.scriptName('sv')
  .usage('$0 [cmd] [args]')
  .option('modules-dir', {
    type: 'string',
    describe: 'Directory where submodules live'
      + ' (stored in package.json as sv-dir)',
  })
  .option('force', {
    type: 'boolean',
    default: false,
    describe: 'Apply changes even when dependency resolution reports errors',
  })
  .command(
    ['$0'],
    'Validate and install modules',
    y => y.option('check-only', {
      type: 'boolean',
      default: false,
      describe: 'Resolve and report errors without changing the project',
    }),
    validate,
  )
  .command(
    ['update [path]', 'u'],
    'Update modules to the latest allowed versions',
    y => y.positional('path', {
      type: 'string',
      describe: 'Module path (A.B.C), all modules when omitted',
    }),
    update,
  )
  .command(
    ['put <url> [target]', 'install', 'i'],
    'Install a submodule or change its version',
    y => y.positional('url', {
      type: 'string',
      describe: 'Git submodule url or installed module name',
    }).positional('target', {
      type: 'string',
      describe: 'Parent module name',
    }).option('ver', {
      type: 'string',
      alias: 'v',
      describe: 'Version to install',
    }),
    put,
  )
  .command(
    ['delete <path>', 'remove', 'r'],
    'Delete submodule by path',
    y => y.positional('path', {
      type: 'string',
      describe: 'Submodule path (A.B.C)',
    }),
    del,
  )
  .command(
    ['list-versions [name]', 'ls'],
    'List available versions of all modules or one',
    y => y.positional('name', {
      type: 'string',
      describe: 'Module name',
    }).option('installed', {
      type: 'boolean',
      describe: 'Show installed versions instead of available',
    }),
    listVersions,
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
