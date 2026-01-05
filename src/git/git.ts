import chalk from 'chalk';
import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { log } from '../log';
import { parseGitUrl } from './parseGitUrl';
import { versionUtil } from '../versionUtil';
import { RunOptions } from '../runOptions';

const execAsync = promisify(exec);

export const git = {
  parseUrl: parseGitUrl,

  addSumbmodule: async (url: string): Promise<void> => {
    const { name } = parseGitUrl(url);
    const module = path.join(RunOptions.modulesDir, name);

    // try {
      await execAsync(
        `git submodule add ${url} ${module}`,
        { cwd: RunOptions.cwd },
      );
    // } catch {
    //   log.error(url, 'Is not a git repo', RunOptions.cwd);
    // }
  },

  checkout: async (name: string, version: string): Promise<void> => {
    const module = path.join(RunOptions.modulesDir, name);
    const styledName = chalk.green.bold(name);
    const styledVer = chalk.green.bold(version);

    try {
      log.message('Checkout', styledName, 'to', styledVer);
      await execAsync(
        `git -C ${module} checkout ${version} -q`,
        { cwd: RunOptions.cwd },
      );
    } catch {
      log.error('Checkout failded');
    }
  },

  listVersions: async (projectName: string): Promise<string[]> => {
    const module = path.join(RunOptions.modulesDir, projectName);
    const styledName = chalk.green.bold(projectName);
    log.message('Fetching tag list for', styledName);
    await execAsync(`git -C ${module} fetch --tags`, { cwd: RunOptions.cwd });

    const res = await execAsync(
      `git -C ${module} tag -l`,
      { cwd: RunOptions.cwd },
    );

    const tagList = res.stdout.toString().split(/\r?\n/);

    return tagList.filter(tag => {
      if (!tag) return false;

      return versionUtil.validate(tag);
    });
  },
};
