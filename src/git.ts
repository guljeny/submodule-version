import chalk from 'chalk';
import { execSync } from 'child_process';
import path from 'path';
import { config } from './config';
import { log } from './log';
import { parseGitUrl } from './parseGitUrl';
import { versionUtil } from './versionUtil';

const addSumbmodule = (url: string) => {
  const { name } = parseGitUrl(url);
  const module = path.join(config.dir, name);

  try {
    execSync(`git submodule add ${url} ${module}`);
  } catch {
    log.error(url, 'Is not a git repo');
  }
};

const checkout = (name: string, version: string) => {
  const module = path.join(config.dir, name);
  const styledName = chalk.green.bold(name);
  const styledVer = chalk.green.bold(version);

  try {
    log.message('Checkout', styledName, 'to', styledVer);
    execSync(`git -C ${module} checkout ${version} -q`);
  } catch {
    log.error('Checkout failded');
  };
};

const listVersions = (projectName: string) => {
  const module = path.join(config.dir, projectName);
  const styledName = chalk.green.bold(projectName);
  log.message('Fetching tag list for', styledName);
  execSync(`git -C ${module} fetch --tags`);
  const res = execSync(`git -C ${module} tag -l`);
  const tagList = res.toString().split(/\r?\n/);

  return tagList.filter(tag => {
    if (!tag) return false;

    return versionUtil.validate(tag);
  });
};

export const git = {
  addSumbmodule,
  checkout,
  listVersions,
};
