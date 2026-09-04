import path from 'path';
import { readFile } from 'fs/promises';
import { pkgJSONManager } from './pkgJSONManager';
import {
  PubGrub,
  IOverride,
  TDependencies,
  TPubGrubResult,
} from './PubGrub';
import { EntryStore } from './entryStore';
import { RunOptions } from './runOptions';
import { versionUtil } from './versionUtil';
import { git, GitError } from './git';
import { SVError } from './errors';

/*
 * Правка package.json родителя (внутри его сабмодуля): parent-level
 * мутации обязаны пережить публикацию родителя, поэтому диапазон
 * пишется в его поле sv.
 */
const updateModuleJson = async (
  parent: string,
  override: IOverride,
): Promise<void> => {
  const parentJson = await pkgJSONManager.read(parent);

  if (!parentJson) throw new SVError('ADDON_NOT_FOUND', { name: parent });

  const sv = { ...((parentJson.sv || {}) as TDependencies) };

  if (override.add) sv[override.add] = override.version || '*';

  if (override.delete) {
    const key = Object.keys(sv)
      .find(depUrl => git.parseUrl(depUrl).name === override.delete);

    if (!key) throw new SVError('ADDON_NOT_FOUND', { name: override.delete });

    delete sv[key];
  }

  parentJson.sv = sv;
  await pkgJSONManager.write(parentJson, parent);
};

/*
 * modulesDir должен быть npm-workspace, иначе сабмодули не попадут
 * в node_modules. Поддерживаем оба формата: workspaces: [] и
 * workspaces: { packages: [] }. Возвращает true, если json изменён.
 */
const ensureWorkspaces = (baseJson: any): boolean => {
  const entry = `${RunOptions.modulesDir}/*`;

  if (Array.isArray(baseJson.workspaces)) {
    if (baseJson.workspaces.includes(entry)) return false;

    baseJson.workspaces.push(entry);

    return true;
  }

  const packages = baseJson.workspaces?.packages;

  if (Array.isArray(packages)) {
    if (packages.includes(entry)) return false;

    packages.push(entry);

    return true;
  }

  baseJson.workspaces = [entry];

  return true;
};

const MODULES_DIR_FIELD = 'sv-dir';
const DEFAULT_MODULES_DIR = 'modules';

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

export class SV {
  private resolution: TPubGrubResult | null = null;

  private store = new EntryStore();

  private explicitModulesDir?: string;

  constructor (
    projectDir: string,
    modulesDir?: string,
    options: { githubToken?: string } = {},
  ) {
    RunOptions.cwd = projectDir;
    RunOptions.modulesDir = modulesDir || DEFAULT_MODULES_DIR;
    this.explicitModulesDir = modulesDir;
    git.api.setToken(options.githubToken);
  }

  /*
   * Директория модулей: явно переданная (CLI/JS) → записанная в
   * package.json#sv-dir → выведенная из .gitmodules → 'modules'.
   * Эффективная записывается в sv-dir. Возвращает true, если json изменён.
   */
  private syncModulesDir = async (baseJson: any): Promise<boolean> => {
    const recorded = baseJson[MODULES_DIR_FIELD] as string | undefined;

    if (!this.explicitModulesDir) {
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

  private resolveDeps = (
    rootDeps: TDependencies,
  ): Promise<TPubGrubResult> => new PubGrub(this.store).resolve(rootDeps);

  /*
   * Синк рабочей копии с резолвом: недостающие сабмодули добавляются,
   * версии переключаются, исчезнувшие из резолва модули удаляются.
   */
  private syncModules = async (resolution: TPubGrubResult): Promise<void> => {
    const previous = this.resolution || {};

    await Promise.all(Object.entries(resolution).map(async ([name, entry]) => {
      const dir = path.join(RunOptions.modulesDir, name);

      if (!await git.local.isGitRepo(dir)) {
        await git.local.addSubmodule(entry.url);
      }

      if (await git.local.currentVersion(name) !== entry.version) {
        await git.local.checkout(name, entry.version);
      }
    }));

    const removed = Object.keys(previous).filter(name => !resolution[name]);

    await Promise.all(removed.map(name => git.local.rm(name)));
  };

  /*
   * Общий путь мутаций: проверка через resolve внутри simulate, и только
   * если ошибки нет — установка/переключение модулей и правка package.json
   * (корня или родителя).
   */
  private apply = async (
    baseJson: any,
    override: IOverride,
    parent?: string,
  ): Promise<void> => {
    const dirChanged = await this.syncModulesDir(baseJson);
    const rootDeps = (baseJson.sv || {}) as TDependencies;
    let nextRootDeps = rootDeps;

    const resolution = await this.store.simulate(
      [override],
      rootDeps,
      deps => {
        nextRootDeps = deps;

        return this.resolveDeps(deps);
      },
    );

    await this.syncModules(resolution);

    if (parent) {
      await updateModuleJson(parent, override);

      if (dirChanged) await pkgJSONManager.write(baseJson);
    } else {
      baseJson.sv = nextRootDeps;
      await pkgJSONManager.write(baseJson);
    }

    this.resolution = resolution;
  };

  public init = async (): Promise<void> => {
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    if (!await git.local.isGitRepo(RunOptions.cwd)) {
      throw new SVError('NOT_A_GIT_REPO');
    }

    const dirChanged = await this.syncModulesDir(baseJson);

    if (ensureWorkspaces(baseJson) || dirChanged) {
      await pkgJSONManager.write(baseJson);
    }

    const rootDeps = (baseJson.sv || {}) as TDependencies;
    const resolution = await this.resolveDeps(rootDeps);

    await this.syncModules(resolution);

    this.resolution = resolution;
  };

  public getResolution = (): TPubGrubResult => {
    if (!this.resolution) throw new SVError('NOT_INITIALIZED');

    return this.resolution;
  };

  /*
   * Установка/смена версии модуля. Первый аргумент — url репозитория
   * или имя уже установленного модуля. Без parentName — в корне проекта,
   * без version — максимально возможная ('*'). Второй аргумент —
   * версия, если это валидный semver-диапазон, иначе имя родителя.
   */
  public put = async (
    url: string,
    versionOrParent?: string,
    parentName?: string,
  ): Promise<void> => {
    const isVersion = !!versionOrParent
      && versionUtil.validate(versionOrParent, true);

    const range = (isVersion ? versionOrParent : undefined) || '*';
    const parent = (isVersion ? parentName : versionOrParent) || undefined;
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    /*
     * Вместо url можно передать имя уже установленного модуля —
     * url берём из текущего резолва.
     */
    let moduleUrl = url;

    if (!git.parseUrl(url).name) {
      const existing = this.getResolution()[url];

      if (!existing) throw new SVError('NOT_A_GIT_URL', { url });

      moduleUrl = existing.url;
    }

    if (parent && !this.getResolution()[parent]) {
      throw new SVError('ADDON_NOT_FOUND', { name: parent });
    }

    await this.apply(
      baseJson,
      { parent, add: moduleUrl, version: range },
      parent,
    );
  };

  /* Удаление модуля из родителя (без parentName — из корня проекта). */
  public delete = async (name: string, parentName?: string): Promise<void> => {
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    if (parentName) {
      const parentEntry = this.getResolution()[parentName];

      if (!parentEntry) {
        throw new SVError('ADDON_NOT_FOUND', { name: parentName });
      }

      if (!(name in parentEntry.dependencies)) {
        throw new SVError('ADDON_NOT_FOUND', { name });
      }
    }

    await this.apply(
      baseJson,
      { parent: parentName, delete: name },
      parentName,
    );
  };

  public listVersions = (
    name?: string,
  ): Record<string, string[]> | string[] => {
    const resolution = this.getResolution();

    if (name) {
      const entry = resolution[name];

      if (!entry) throw new SVError('ADDON_NOT_FOUND', { name });

      return versionUtil.sort(Object.keys(entry.versions));
    }

    return Object.fromEntries(
      Object.entries(resolution).map(([entryName, entry]) => [
        entryName,
        versionUtil.sort(Object.keys(entry.versions)),
      ]),
    );
  };

  // eslint-disable-next-line class-methods-use-this
  public hasChanges = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (await git.local.hasChanges(dir)) return true;

    return git.local.hasUnpushedCommits(dir);
  };

  // eslint-disable-next-line class-methods-use-this
  public hasUncommittedChanges = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    return git.local.hasChanges(dir);
  };

  // eslint-disable-next-line class-methods-use-this
  public currentVersion = async (module?: string): Promise<string | null> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    const tags = await git.local.tagsAtHead(dir);

    return versionUtil.latest(tags) || null;
  };

  // eslint-disable-next-line class-methods-use-this
  public latestVersion = async (module?: string): Promise<string> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    const versions = await git.local.listTags(dir);

    return versionUtil.latest(versions) || '0.0.0';
  };

  // eslint-disable-next-line class-methods-use-this
  public getRemote = async (module?: string): Promise<string | null> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    return git.local.getRemote(dir);
  };

  public isPublished = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (!await git.local.isGitRepo(dir)) return false;

    return !!(await this.getRemote(module));
  };

  // eslint-disable-next-line class-methods-use-this
  public isRemoteAhead = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (!await git.local.isGitRepo(dir)) return false;

    return git.local.isRemoteAhead(dir);
  };

  // eslint-disable-next-line class-methods-use-this
  public pullRebaseAutostash = async (module?: string): Promise<void> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    return git.local.pullRebaseAutostash(dir);
  };

  public publish = async (opts: {
    module?: string,
    repoUrl?: string,
    message?: string,
    bump: 'release' | 'minor' | 'major',
  }): Promise<string> => {
    const { module, repoUrl, message, bump } = opts;

    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (!await this.isPublished(module)) {
      if (!repoUrl) throw new GitError('GIT_REPO_URL_REQUIRED');

      if (!await git.local.isGitRepo(dir)) await git.local.init(dir);

      await git.local.addRemote(dir, repoUrl);
    }

    const currentTag = await this.currentVersion(module);
    const latestKnown = await this.latestVersion(module);

    if (currentTag && latestKnown && currentTag !== latestKnown) {
      throw new GitError('GIT_NOT_LATEST_VERSION');
    }

    await git.local.ensureBranch(dir);

    if (await git.local.isRemoteAhead(dir)) {
      await git.local.pullRebaseAutostash(dir);
    }

    const dirty = await git.local.hasChanges(dir);
    const headTag = await this.currentVersion(module);

    if (!dirty && headTag) {
      await git.local.push(dir, headTag);

      return headTag;
    }

    const next = versionUtil.bump(await this.latestVersion(module), bump);
    const pkg = await pkgJSONManager.read(module);

    if (pkg) {
      pkg.version = next;
      await pkgJSONManager.write(pkg, module);
    }

    if (await git.local.hasChanges(dir)) {
      await git.local.commitAll(dir, message || 'Update');
    }

    await git.local.addTag(dir, next);
    await git.local.push(dir, next);

    return next;
  };
}
