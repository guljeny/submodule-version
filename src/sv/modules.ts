import path from 'path';
import { existsSync } from 'fs';
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
  const entries = Object.entries(resolution);

  const registeredModules = new Set(
    await git.local.listRegisteredSubmodules(entries.map(([name]) => name)),
  );

  /* Чтения независимы и остаются параллельными. Отдельно проверяем
   * регистрацию: после прерванного submodule add каталог уже может быть
   * Git-репозиторием, хотя superproject о нём ещё не знает. */
  const states = await Promise.all(entries.map(async ([name, entry]) => {
    const dir = path.join(RunOptions.modulesDir, name);
    const exists = await git.local.isGitRepo(dir);
    const registered = registeredModules.has(name);

    const currentVersion = exists
      ? await git.local.currentVersion(name)
      : null;

    return {
      name,
      entry,
      exists,
      registered,
      currentVersion,
      pathExisted: existsSync(path.join(RunOptions.cwd, dir)),
    };
  }));

  const missing = states.filter(state => !state.exists);
  const createdByOperation = missing.filter(state => !state.pathExisted);

  /* Clone — медленная сетевая часть, но корневой index не меняет. */
  const preparation = await Promise.allSettled(missing.map(state => (
    git.local.prepareSubmodule(state.entry.url)
  )));

  const preparationError = preparation.find(
    result => result.status === 'rejected',
  );

  const discardPrepared = async (): Promise<void> => {
    /* cleanup тоже трогает root index, если модуль успел зарегистрироваться. */
    for (const state of [...createdByOperation].reverse()) {
      try {
        await git.local.discardPreparedSubmodule(state.name);
      } catch {
        // Сохраняем исходную ошибку операции; следующий resolve увидит partial.
      }
    }
  };

  if (preparationError?.status === 'rejected') {
    await discardPrepared();
    throw preparationError.reason;
  }

  /* Checkout разных рабочих копий использует разные вложенные index-файлы.
   * currentVersion возвращает базовый semver-тег и не вынуждает checkout при
   * локальных коммитах поверх уже выбранной версии. */
  const versionChanges = states.filter(
    state => state.currentVersion !== state.entry.version,
  );

  const unregistered = states.filter(state => !state.registered);

  try {
    /* До регистрации выбираем нужный commit: именно его submodule add
     * запишет как gitlink. Эти checkout работают в независимых репозиториях. */
    await Promise.all(versionChanges
      .filter(state => !state.registered)
      .map(state => git.local.checkout(state.name, state.entry.version)));

    /* submodule add меняет общий index и .gitmodules. Регистрация уже
     * подготовленных репозиториев быстрая, но обязана идти последовательно. */
    for (const moduleState of unregistered) {
      await git.local.addSubmodule(moduleState.entry.url);
    }

    /* Уже зарегистрированные модули можно переключать параллельно: каждый
     * checkout меняет только собственный вложенный index. */
    await Promise.all(versionChanges
      .filter(state => state.registered)
      .map(state => git.local.checkout(state.name, state.entry.version)));
  } catch (error) {
    await discardPrepared();
    throw error;
  }

  if (missing.length || versionChanges.length
    || unregistered.length) {
    changed = true;
  }

  if (!allowRemove) return changed;

  const removed = (await listManagedSubmodules())
    .filter(name => !resolution[name]);

  if (removed.length) changed = true;

  /* git rm также меняет общий index — удаления не запускаем параллельно. */
  for (const name of removed) await git.local.rm(name);

  return changed;
};
