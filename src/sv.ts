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
import { npm } from './npm';
import { SVError } from './errors';

/*
 * Правка package.json родителя (внутри его сабмодуля): parent-level
 * мутации обязаны пережить публикацию родителя, поэтому диапазон
 * пишется в его поле sv.
 */
const applyOverride = (json: any, override: IOverride): any => {
  const sv = { ...((json.sv || {}) as TDependencies) };

  if (override.add) sv[override.add] = override.version || '*';

  if (override.delete) {
    const key = Object.keys(sv)
      .find(depUrl => git.parseUrl(depUrl).name === override.delete);

    if (!key) throw new SVError('ADDON_NOT_FOUND', { name: override.delete });

    delete sv[key];
  }

  return { ...json, sv };
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

const parsePutArgs = (
  versionOrParent?: string,
  parentName?: string,
): { range: string, parent?: string } => {
  const isVersion = !!versionOrParent
    && versionUtil.validate(versionOrParent, true);

  return {
    range: (isVersion ? versionOrParent : undefined) || '*',
    parent: (isVersion ? parentName : versionOrParent) || undefined,
  };
};

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

  /* Safe put передаёт сюда уже выбранную PubGrub версию на время мутации. */
  private verifiedResolution: TPubGrubResult | null = null;

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
   * Возвращает true, если рабочая копия изменилась.
   */
  private syncModules = async (
    resolution: TPubGrubResult,
  ): Promise<boolean> => {
    const previous = this.resolution || {};
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

    const removed = Object.keys(previous).filter(name => !resolution[name]);

    if (removed.length) changed = true;

    await Promise.all(removed.map(name => git.local.rm(name)));

    return changed;
  };

  private verify = async (
    baseJson: any,
    override: IOverride,
  ): Promise<TPubGrubResult> => {
    const rootDeps = (baseJson.sv || {}) as TDependencies;

    return this.store.simulate(
      [override],
      rootDeps,
      deps => this.resolveDeps(deps),
    );
  };

  private findModuleUrl = async (
    urlOrName: string,
    parent?: string,
  ): Promise<string> => {
    if (git.parseUrl(urlOrName).name) return urlOrName;

    const resolved = this.resolution?.[urlOrName];

    if (resolved) return resolved.url;

    const targetJson = await pkgJSONManager.read(parent);

    const existing = Object.keys((targetJson?.sv || {}) as TDependencies)
      .find(depUrl => git.parseUrl(depUrl).name === urlOrName);

    if (existing) return existing;

    const remote = await git.local.getRemote(
      path.join(RunOptions.modulesDir, urlOrName),
    );

    if (remote && git.parseUrl(remote).name) return remote;

    throw new SVError('NOT_A_GIT_URL', { url: urlOrName });
  };

  private prepareBaseJson = async (baseJson: any): Promise<boolean> => {
    const dirChanged = await this.syncModulesDir(baseJson);
    const workspaceChanged = ensureWorkspaces(baseJson);

    return dirChanged || workspaceChanged;
  };

  public init = async (): Promise<void> => {
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    if (!await git.local.isGitRepo(RunOptions.cwd)) {
      throw new SVError('NOT_A_GIT_REPO');
    }

    const dirChanged = await this.syncModulesDir(baseJson);
    const jsonChanged = ensureWorkspaces(baseJson) || dirChanged;

    if (jsonChanged) {
      await pkgJSONManager.write(baseJson);
    }

    const rootDeps = (baseJson.sv || {}) as TDependencies;
    const resolution = await this.resolveDeps(rootDeps);
    const modulesChanged = await this.syncModules(resolution);

    /*
     * npm install запускается только когда реально что-то изменилось —
     * иначе каждый CLI-вызов (init идёт перед любой командой) платил
     * бы за полный прогон npm.
     */
    if (jsonChanged || modulesChanged) await npm.install();

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
    const { range, parent } = parsePutArgs(versionOrParent, parentName);
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    await this.syncModulesDir(baseJson);

    /*
     * Вместо url можно передать имя уже установленного модуля —
     * url берём из текущего резолва.
     */
    const moduleUrl = await this.findModuleUrl(url, parent);

    if (parent && !this.getResolution()[parent]) {
      throw new SVError('ADDON_NOT_FOUND', { name: parent });
    }

    const resolution = await this.verify(baseJson, {
      parent,
      add: moduleUrl,
      version: range,
    });

    await this.syncModules(resolution);
    this.verifiedResolution = resolution;

    try {
      await this.dangerousPut(moduleUrl, range, parent);
      this.resolution = resolution;
    } finally {
      this.verifiedResolution = null;
    }
  };

  /*
   * Принудительная установка без PubGrub: добавляет отсутствующий git
   * submodule, выбирает подходящий range git-тег, записывает constraint и
   * запускает npm install. Совместимость с остальным деревом не проверяется.
   */
  public dangerousPut = async (
    url: string,
    versionOrParent?: string,
    parentName?: string,
  ): Promise<void> => {
    const { range, parent } = parsePutArgs(versionOrParent, parentName);
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    const baseChanged = await this.prepareBaseJson(baseJson);
    const moduleUrl = await this.findModuleUrl(url, parent);
    const { name } = git.parseUrl(moduleUrl);

    const targetJson = parent
      ? await pkgJSONManager.read(parent)
      : baseJson;

    if (!targetJson) throw new SVError('ADDON_NOT_FOUND', { name: parent });

    /* Проверяем запись до git-мутации, чтобы не оставить лишний submodule. */
    const nextTargetJson = applyOverride(
      targetJson,
      { parent, add: moduleUrl, version: range },
    );

    if (!await git.local.isGitRepo(path.join(RunOptions.modulesDir, name))) {
      await git.local.addSubmodule(moduleUrl);
    }

    const verifiedVersion = this.verifiedResolution?.[name]?.version;

    const versions = verifiedVersion
      ? []
      : await git.local.listVersions(name);

    const version = verifiedVersion
      || versionUtil.latest(versions, [range]);

    if (version && await git.local.currentVersion(name) !== version) {
      await git.local.checkout(name, version);
    }

    if (parent) {
      await pkgJSONManager.write(nextTargetJson, parent);
    } else {
      await pkgJSONManager.write(nextTargetJson);
    }

    if (parent && baseChanged) await pkgJSONManager.write(baseJson);

    this.resolution = null;
    await npm.install();
  };

  /* Удаление модуля из родителя (без parentName — из корня проекта). */
  public delete = async (name: string, parentName?: string): Promise<void> => {
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    await this.syncModulesDir(baseJson);

    if (parentName) {
      const parentEntry = this.getResolution()[parentName];

      if (!parentEntry) {
        throw new SVError('ADDON_NOT_FOUND', { name: parentName });
      }

      if (!(name in parentEntry.dependencies)) {
        throw new SVError('ADDON_NOT_FOUND', { name });
      }
    }

    const override = { parent: parentName, delete: name };
    const resolution = await this.verify(baseJson, override);

    await this.syncModules(resolution);
    await this.dangerousDelete(name, parentName);
    this.resolution = resolution;
  };

  /* Принудительное удаление без запуска PubGrub. */
  public dangerousDelete = async (
    name: string,
    parentName?: string,
  ): Promise<void> => {
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    const baseChanged = await this.prepareBaseJson(baseJson);

    const targetJson = parentName
      ? await pkgJSONManager.read(parentName)
      : baseJson;

    if (!targetJson) {
      throw new SVError('ADDON_NOT_FOUND', { name: parentName });
    }

    const override = { parent: parentName, delete: name };
    /* Проверяем запись до git-мутации, чтобы неизвестное имя было no-op. */
    const nextTargetJson = applyOverride(targetJson, override);
    const dir = path.join(RunOptions.modulesDir, name);

    if (await git.local.isGitRepo(dir)) await git.local.rm(name);

    if (parentName) {
      await pkgJSONManager.write(nextTargetJson, parentName);
    } else {
      await pkgJSONManager.write(nextTargetJson);
    }

    if (parentName && baseChanged) await pkgJSONManager.write(baseJson);
    this.resolution = null;
    await npm.install();
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
