#!/usr/bin/env node

const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const yargs = require('yargs');
const JSON_NAME = 'package.json';
const cwd = process.cwd();
const VERSION_REGEX = /(^.*@.*)@(.*)$/;

const config = {
  dir: 'modules',
  tag: 'master',
};

const logger = (...message) => {
  // eslint-disable-next-line no-console
  console.log(...message);
};

const abort = (...message) => {
  logger(...message);
  yargs.exit(1, message.join(' '));
};

const configPath = path.join(cwd, '.sw.config.json');

if (fs.existsSync(configPath)) {
  const { dir, tag } = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
  if (dir) config.dir = dir;
  if (tag) config.tag = tag;
}

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

const checkout = (url, version) => {
  const module = isGitUrl(url) ? `${config.dir}/${getName(url)}` : url;
  logger('checkout', module);
  try {
    execSync(`git -C ${module} checkout ${version} -q`);
  } catch {
    abort('Checkout failded');
  };
};

const install = (url, version, location) => {
  const name = getName(url);
  const targetLocation = path.join(location, name);
  const gitCmd = `git submodule add ${url} ${targetLocation}`;
  try {
    execSync(gitCmd);
    checkout(url, version);
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
    const { sv } = JSON.parse(jsonString);

    buildGraph(sv, name, location);
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

const validate = (sv, name) => {
  buildGraph(sv, name, config.dir);

  const errors = computeErrors();
  if (errors) abort(errors);

  Object.entries(graph).forEach(([url, versions]) => {
    checkout(`${config.dir}/${url}`, versions[0]);
  });

  logger('Everything is up to date.');
};

const validationCommand = () => {
  const { name, sv } = readProjectJSON();
  validate(sv, name);
};

const installCommand = arg => {
  const { url } = arg;
  const versionMatch = VERSION_REGEX.exec(url) || [];
  const [, gitaddress = url, version = config.tag] = versionMatch;

  if (!isGitUrl(gitaddress)) {
    abort(gitaddress, 'is not a git URL');
  }

  const projectJSON = readProjectJSON();
  const installedDep = projectJSON.sv?.[gitaddress];

  if (installedDep && installedDep !== version) {
    checkout(gitaddress, version);
  }

  const sv = {
    ...(projectJSON.sv || {}),
    [gitaddress]: version,
  };

  if (!installedDep || installedDep !== version) {
    writeProjectJSON({ ...projectJSON, sv });
  }
  validate(sv, projectJSON.name);
};

// eslint-disable-next-line @typescript-eslint/no-unused-expressions
yargs.scriptName('sv')
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
    installCommand,
  )
  .help()
  .argv;
