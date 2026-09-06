import path from 'path';
import { RunOptions } from '../runOptions';
import { local } from './local';

/* Без module — корень проекта, с module — каталог его сабмодуля. */
const moduleDir = (module?: string): string => (
  module ? path.join(RunOptions.modulesDir, module) : RunOptions.cwd
);

/*
 * Фасад над git.local для управляемого проекта: module резолвится
 * в каталог сабмодуля (modulesDir/<module>), без module — корень.
 * Публичный доступ к пакету — только через sv.git.*.
 */
export const managedGit = {
  hasChanges: async (module?: string): Promise<boolean> => {
    const dir = moduleDir(module);

    if (await local.hasChanges(dir)) return true;

    return local.hasUnpushedCommits(dir);
  },

  hasUncommittedChanges: async (module?: string): Promise<boolean> => (
    local.hasChanges(moduleDir(module))
  ),

  getRemote: async (module?: string): Promise<string | null> => (
    local.getRemote(moduleDir(module))
  ),

  isRemoteAhead: async (module?: string): Promise<boolean> => {
    const dir = moduleDir(module);

    if (!await local.isGitRepo(dir)) return false;

    return local.isRemoteAhead(dir);
  },

  pullRebaseAutostash: async (module?: string): Promise<void> => (
    local.pullRebaseAutostash(moduleDir(module))
  ),

  isPublished: async (module?: string): Promise<boolean> => {
    const dir = moduleDir(module);

    if (!await local.isGitRepo(dir)) return false;

    return !!(await local.getRemote(dir));
  },
};
