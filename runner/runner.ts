import chalk from 'chalk';
import yargs from 'yargs';
import { SV } from '../src';
import { log } from './log';
import { handleErrors } from './handleErrors';

const BASE_DIR = 'modules';

const makeEvent = (event: (sv: SV, arg: any) => Promise<void>) => {
  const sv = new SV(process.cwd(), BASE_DIR);

  return async (arg: any) => {
    const { url: gitUrl } = arg as {url: string};

    try {
      await event(sv, arg);
    } catch (e) {
      handleErrors(e as Error, gitUrl);
    }
  };
};

const install = makeEvent(async (sv, arg) => {
  const { url: gitUrl, target } = arg as {url: string, target?: string};
  await sv.install(gitUrl, target);
});

const update = makeEvent(async sv => {
  await sv.update();
});

const remove = makeEvent(async (sv, arg) => {
  const { name } = arg as {name: string};
  await sv.remove(name);
});

const validate = makeEvent(async sv => {
  const result = await sv.buildGraph();

  Object.entries(result).forEach(([name, entry]) => {
    if (!entry.used.includes(entry.version) && entry.versions.length === 0) {
      log.message(
        chalk.yellow('⚠️  WARN: Module'),
        chalk.bgYellow.black(` ${name} `),
        chalk.yellow('does not contain any version tag!'),
      );
    }
  });

  log.message(chalk.green.bold('Everything is up to date!🔥'));
});

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
  .command(
    ['remove <name>', 'r'],
    'Remove submodule by name',
    y => y.positional('name', {
      type: 'string',
      describe: 'Submodule name',
    }),
    remove,
  )
  .help()
  .argv;
