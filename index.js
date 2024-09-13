#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const yargs = require('yargs');
const JSON_NAME = 'package.json';
const cwd = process.cwd();
const VERSION_REGEX = /(^.*@.*)@(.*)$/;
const DEFAULT_DIR = 'modules';

const logger = (...message) => {
  // eslint-disable-next-line no-console
  console.log(...message);
};

const abort = (...message) => {
  logger(...message);
  yargs.exit(1, message.join(' '));
};

const readProjectJSON = () => {
  const jsonPath = path.join(cwd, JSON_NAME);
  const isJsonExists = fs.existsSync(jsonPath);
  if (!isJsonExists) throw new Error(`${cwd} is not npm project`);
  const jsonString = fs.readFileSync(jsonPath, 'utf-8');

  return JSON.parse(jsonString);
};

const writeProjectJSON = data => {
  fs.writeFileSync(path.join(cwd, JSON_NAME), JSON.stringify(data, null, 2));
};

const isGitUrl = url => url.endsWith('.git');

const getName = url => {
  if (isGitUrl(url)) return /\/(.*)\.git/.exec(url)[1];
  const parts = url.split('/');

  return parts[parts.length - 1];
};

const install = (url, version, location) => {
  const name = getName(url);
  const targetLocation = path.join(location, name);
  const gitCmd = `git submodule add -b ${version} ${url} ${targetLocation}`;
  try {
    execSync(gitCmd);
  } catch {
    abort(url, 'Is not a git repo');
  }
};

const graph = {};

const buildGraph = (dependencies = {}, parent, location) => {
  Object.entries(dependencies).forEach(([url, version]) => {
    const name = getName(url);
    const dependencyJSON = path.join(cwd, location, name, JSON_NAME);
    const dependencyIsInstalled = fs.existsSync(dependencyJSON);

    graph[name] = {
      ...(graph[name] || {}),
      [version]: [...(graph[name]?.[version] || []), parent],
    };

    if (!dependencyIsInstalled) install(url, version, location);
    const jsonString = fs.readFileSync(dependencyJSON, 'utf-8');
    const { wv: depWV = {} } = JSON.parse(jsonString);

    buildGraph(depWV.dependencies, name, location);
  });
};

const computeErrors = () => {
  const errorList = Object.entries(graph).reduce((acc, [name, links]) => {
    if (Object.keys(links).length <= 1) return acc;

    const err = Object.entries(links).reduce((errAcc, [version, usedBy]) => (
      `${errAcc} Version <${version}> used by: ${usedBy.join(', ')}.`
    ), `Confilict in module [${name}]!`);

    return [...acc, err];
  }, []);

  return errorList.join('\n');
};

const validate = (wv, name) => {
  buildGraph(wv.dependencies, name, wv?.dir || DEFAULT_DIR);
  logger('Everything is up to date.');
  const errors = computeErrors();
  if (!errors) return;
  abort(errors);
};

const checkoutModule = (url, version) => {
  const module = isGitUrl(url) ? `${DEFAULT_DIR}/${getName(url)}` : url;
  logger('checkout', module);
  try {
    execSync(`git -C ${module} checkout ${version}`);
  } catch {
    abort('Checkout failded');
  };
};

const validationCommand = () => {
  const { name, wv } = readProjectJSON();
  validate(wv, name);
};

const makeInstallCommand = arg => {
  const { url } = arg;
  const versionMatch = VERSION_REGEX.exec(url) || [];
  const [, gitaddress = url, version = 'master'] = versionMatch;

  if (!isGitUrl(gitaddress)) {
    abort(gitaddress, 'is not a git URL');
  }

  const projectJSON = readProjectJSON();
  const installedDep = projectJSON?.wv.dependencies?.[gitaddress];

  if (installedDep && installedDep !== version) {
    checkoutModule(gitaddress, version);
  }

  const wv = {
    ...(projectJSON.wv || {}),
    dependencies: {
      ...(projectJSON.wv?.dependencies || {}),
      [gitaddress]: version,
    },
  };

  if (!installedDep || installedDep !== version) {
    writeProjectJSON({ ...projectJSON, wv });
  }
  validate(wv, projectJSON.name);
};

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
yargs.scriptName('wv')
  .usage('$0 <cmd> [args]')
  .command(
    ['validate', '$0', 'v'],
    'Validate and install modules',
    () => {},
    validationCommand,
  )
  .command(
    ['install <url>', 'i'],
    'Install new submodule',
    y => y.positional('url', {
      type: 'string',
      describe: 'git submodule url',
    }),
    makeInstallCommand,
  )
  .help()
  .argv;
