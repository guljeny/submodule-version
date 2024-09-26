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

const checkout = (url: string, version: string) => {
  const { name } = parseGitUrl(url);
  const module = path.join(config.dir, name);

  try {
    execSync(`git -C ${module} checkout ${version} -q`);
  } catch {
    log.error('Checkout failded');
  };
};

const listVersions = (projectName: string) => {
  const module = path.join(config.dir, projectName);
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
