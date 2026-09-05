import chalk from 'chalk';
import yargs from 'yargs';
import { SV, SVError } from '../src';
import { log } from './log';
import { handleErrors } from './handleErrors';

/* 'A.B.C' → { name: 'C', parent: 'B' } (parent — непосредственный родитель) */
const splitPath = (modulePath: string): { name: string, parent?: string } => {
  const parts = modulePath.split('.');
  const name = parts.pop() as string;

  return { name, parent: parts.pop() };
};

const makeEvent = (
  event: (sv: SV, arg: any) => Promise<void>,
  { skipInit = false } = {},
) => async (arg: any) => {
  const sv = new SV(process.cwd(), arg.modulesDir);

  try {
    /* publish умеет работать с ещё не git/npm-инициализированным проектом */
    if (!skipInit && arg.verify !== false) {
      await sv.init();
    }

    await event(sv, arg);
  } catch (e) {
    handleErrors(e as Error);
  }
};

const put = makeEvent(async (sv, arg) => {
  const { url: gitUrl, target, ver, verify } = arg as {
    url: string,
    target?: string,
    ver?: string,
    verify?: boolean,
  };

  const method = verify === false ? sv.dangerousPut : sv.put;

  await method(gitUrl, ver || target, ver ? target : undefined);
});

const update = makeEvent(async (sv, arg) => {
  const { path: modulePath } = arg as { path?: string };

  if (!modulePath) {
    /* init внутри makeEvent уже пересобрал модули на максимально разрешённые */
    log.message(chalk.green.bold('Modules are up to date!'));

    return;
  }

  const { name, parent } = splitPath(modulePath);
  const entry = sv.getResolution()[name];

  if (!entry) throw new SVError('ADDON_NOT_FOUND', { name });

  await sv.put(entry.url, '*', parent);
});

const del = makeEvent(async (sv, arg) => {
  const { path: modulePath, verify } = arg as {
    path: string,
    verify?: boolean,
  };
  const { name, parent } = splitPath(modulePath);

  const method = verify === false ? sv.dangerousDelete : sv.delete;

  await method(name, parent);
});

const listVersions = makeEvent(async (sv, arg) => {
  const { name, installed } = arg as { name?: string, installed?: boolean };

  if (installed) {
    const resolution = sv.getResolution();

    if (name && !resolution[name]) {
      throw new SVError('ADDON_NOT_FOUND', { name });
    }

    const names = name ? [name] : Object.keys(resolution);

    await Promise.all(names.map(async moduleName => {
      const version = await sv.currentVersion(moduleName);

      log.message(
        chalk.bold(moduleName),
        version || chalk.red('no version tag'),
      );
    }));

    return;
  }

  const versions = sv.listVersions(name);

  if (name) {
    log.message(chalk.bold(name), (versions as string[]).join(', '));

    return;
  }

  Object.entries(versions as Record<string, string[]>)
    .forEach(([moduleName, moduleVersions]) => {
      log.message(chalk.bold(moduleName), moduleVersions.join(', '));
    });
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
  sv.getResolution();

  log.message(chalk.green.bold('Everything is up to date!🔥'));
});

export const s = yargs.scriptName('sv')
  .usage('$0 [cmd] [args]')
  .option('modules-dir', {
    type: 'string',
    describe: 'Directory where submodules live'
      + ' (stored in package.json as sv-dir)',
  })
  .command(
    ['$0'],
    'Validate and install modules',
    () => {},
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
    }).option('verify', {
      type: 'boolean',
      default: true,
      describe: 'Verify dependency versions (disable with --no-verify)',
    }),
    put,
  )
  .command(
    ['delete <path>', 'remove', 'r'],
    'Delete submodule by path',
    y => y.positional('path', {
      type: 'string',
      describe: 'Submodule path (A.B.C)',
    }).option('verify', {
      type: 'boolean',
      default: true,
      describe: 'Verify dependency versions (disable with --no-verify)',
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
