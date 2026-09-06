import path from 'path';
import { readFile } from 'fs/promises';
import { TPubGrubResult } from '../PubGrub';
import { git } from '../git';
import { RunOptions } from '../runOptions';

const MODULES_DIR_FIELD = 'sv-dir';

export const DEFAULT_MODULES_DIR = 'modules';

/*
 * Уже добавленные сабмодули — источник правды о директории:
 * .gitmodules с единым родителем у всех path (addons/X, addons/Y → addons).
 */
const deriveModulesDir = async (): Promise<string | null> => {
  try {
    const content = await readFile(
      path.join(RunOptions.cwd, '.gitmodules'),
      'utf-8',
    );

    const dirs = new Set(
      [...content.matchAll(/^\s*path\s*=\s*(.+)$/gm)]
        .map(match => match[1].trim().split('/')[0]),
    );

    return dirs.size === 1 ? [...dirs][0] : null;
  } catch {
    return null;
  }
};

/*
 * Имена установленных sv-сабмодулей: path из .gitmodules внутри
 * modulesDir. Источник правды о наборе для удаления — сохранённого
 * resolution у SV больше нет.
 */
const listManagedSubmodules = async (): Promise<string[]> => {
  try {
    const content = await readFile(
      path.join(RunOptions.cwd, '.gitmodules'),
      'utf-8',
    );

    return [...content.matchAll(/^\s*path\s*=\s*(.+)$/gm)]
      .map(match => match[1].trim())
      .filter(modulePath => modulePath.split('/')[0] === RunOptions.modulesDir)
      .map(modulePath => modulePath.slice(RunOptions.modulesDir.length + 1));
  } catch {
    return [];
  }
};

/* Без module — корень проекта, с module — каталог его сабмодуля. */
export const moduleDir = (module?: string): string => (
  module ? path.join(RunOptions.modulesDir, module) : RunOptions.cwd
);

/*
 * Директория модулей: явно переданная (CLI/JS) → записанная в
 * package.json#sv-dir → выведенная из .gitmodules → 'modules'.
 * Эффективная записывается в sv-dir. Возвращает true, если json изменён.
 */
export const syncModulesDir = async (
  baseJson: any,
  explicitModulesDir?: string,
): Promise<boolean> => {
  const recorded = baseJson[MODULES_DIR_FIELD] as string | undefined;

  if (!explicitModulesDir) {
    if (recorded) {
      RunOptions.modulesDir = recorded;

      return false;
    }

    const derived = await deriveModulesDir();

    if (derived) RunOptions.modulesDir = derived;
  }

  if (recorded === RunOptions.modulesDir) return false;

  baseJson[MODULES_DIR_FIELD] = RunOptions.modulesDir;

  return true;
};

/*
 * Синк рабочей копии с резолвом: недостающие сабмодули добавляются,
 * версии переключаются. Исчезнувшие из резолва модули (набор — из
 * .gitmodules) удаляются только при allowRemove: при ошибках загрузки
 * даже полный fallback может не содержать недоступный модуль, поэтому
 * force-операция не должна удалять его. Возвращает true при изменении.
 */
export const syncModules = async (
  resolution: TPubGrubResult,
  allowRemove: boolean,
): Promise<boolean> => {
  let changed = false;

  await Promise.all(Object.entries(resolution).map(async ([name, entry]) => {
    const dir = path.join(RunOptions.modulesDir, name);

    if (!await git.local.isGitRepo(dir)) {
      await git.local.addSubmodule(entry.url);
      changed = true;
    }

    if (await git.local.currentVersion(name) !== entry.version) {
      await git.local.checkout(name, entry.version);
      changed = true;
    }
  }));

  if (!allowRemove) return changed;

  const removed = (await listManagedSubmodules())
    .filter(name => !resolution[name]);

  if (removed.length) changed = true;

  await Promise.all(removed.map(name => git.local.rm(name)));

  return changed;
};
