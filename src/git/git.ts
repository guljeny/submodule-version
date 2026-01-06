import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { parseGitUrl } from './parseGitUrl';
import { versionUtil } from '../versionUtil';
import { RunOptions } from '../runOptions';
import { GitError } from './GitError';

const execAsync = promisify(exec);

export const git = {
  parseUrl: parseGitUrl,

  addSumbmodule: async (url: string): Promise<void> => {
    const { name } = parseGitUrl(url);
    const module = path.join(RunOptions.modulesDir, name);

    try {
      await execAsync(
        `git submodule add ${url} ${module}`,
        { cwd: RunOptions.cwd },
      );
    } catch {
      throw new GitError('GIT_NOT_A_REPO');
    }
  },

  checkout: async (name: string, version: string): Promise<void> => {
    const module = path.join(RunOptions.modulesDir, name);

    try {
      await execAsync(
        `git -C ${module} checkout ${version} -q`,
        { cwd: RunOptions.cwd },
      );
    } catch {
      throw new GitError('GIT_MODULE_CHECKOUT_FAILED');
    }
  },

  listVersions: async (projectName: string): Promise<string[]> => {
    const module = path.join(RunOptions.modulesDir, projectName);
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

  rm: async (submoduleName: string) => {
    await execAsync(
      `git rm -f ${RunOptions.modulesDir}/${submoduleName}`,
      { cwd: RunOptions.cwd },
    );
    await execAsync(
      `rm -rf .git/${RunOptions.modulesDir}/${submoduleName}`,
      { cwd: RunOptions.cwd },
    );
  },
};
