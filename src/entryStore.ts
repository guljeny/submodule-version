import path from 'path';
import { SVError } from './errors';
import { git } from './git';
import { pkgJSONManager } from './pkgJSONManager';
import { RunOptions } from './runOptions';
import { versionUtil } from './versionUtil';
import type {
  IEntrySource,
  IOverride,
  IPackageEntry,
  TDependencies,
} from './PubGrub/types';

/*
 * Оверрайды без parent применяются к корню: add добавляет/меняет
 * диапазон по url, delete убирает зависимость по имени модуля.
 */
const applyRootOverrides = (
  overrides: IOverride[],
  rootDeps: TDependencies,
): TDependencies => {
  const next = { ...rootDeps };

  overrides.forEach(override => {
    if (override.add) {
      const { name } = git.parseUrl(override.add);

      if (!name) {
        throw new SVError('NOT_A_GIT_URL', { url: override.add });
      }

      next[override.add] = override.version || '*';
    }

    if (override.delete) {
      const key = Object.keys(next)
        .find(depUrl => git.parseUrl(depUrl).name === override.delete);

      if (!key) {
        throw new SVError('ADDON_NOT_FOUND', { name: override.delete });
      }

      delete next[key];
    }
  });

  return next;
};

export class EntryStore implements IEntrySource {
  private cache = new Map<string, Promise<IPackageEntry>>();

  private urlByName = new Map<string, string>();

  /* Активны только внутри simulate; вне коллбэка оверрайдов не существует */
  private overrides: IOverride[] | null = null;

  private rememberUrl = (name: string, url: string): void => {
    const current = this.urlByName.get(name);

    if (current && current !== url) {
      throw new SVError('ADDON_NOT_FOUND', {
        name,
        urls: [current, url],
      });
    }

    this.urlByName.set(name, url);
  };

  private normalizeDependencies = (
    dependencies: TDependencies = {},
  ): TDependencies => Object.fromEntries(
    Object.entries(dependencies).map(([depUrl, constraint]) => {
      const { name } = git.parseUrl(depUrl);

      if (!name) {
        throw new SVError('NOT_A_GIT_URL', { url: depUrl });
      }

      this.rememberUrl(name, depUrl);

      return [name, constraint];
    }),
  );

  /*
   * Рабочая копия сабмодуля — источник правды для checkout'нутой версии:
   * зависимости, изменённые локально и ещё не опубликованные тегом,
   * видны резолверу сразу. Применяется только к версии на HEAD (по тегам)
   * и только если такая версия есть в remote-наборе: HEAD без тега
   * (середина publish) или локальный тег вне remote — оверлей пропускается.
   */
  private localOverlay = async (
    name: string,
    versions: Record<string, TDependencies>,
    manifests: Record<string, unknown | null>,
  ): Promise<void> => {
    if (!RunOptions.cwd || !RunOptions.modulesDir) return;

    const dir = path.join(RunOptions.cwd, RunOptions.modulesDir, name);

    if (!await git.local.isGitRepo(dir)) return;

    const version = versionUtil.latest(await git.local.tagsAtHead(dir));

    if (!version || !versions[version]) return;

    const pkg = await pkgJSONManager.read(name);

    if (!pkg) return;

    versions[version] = this.normalizeDependencies(pkg.sv || {});
    manifests[version] = pkg;
  };

  private load = async (url: string, name: string): Promise<IPackageEntry> => {
    const fetched = await git.api.fetchVersions(url);
    const versions: Record<string, TDependencies> = {};
    const manifests: Record<string, unknown | null> = {};

    fetched.forEach(({ version, pkg }) => {
      versions[version] = this.normalizeDependencies(pkg?.sv || {});
      manifests[version] = pkg;
    });

    await this.localOverlay(name, versions, manifests);

    return { name, url, versions, manifests };
  };

  private resolveIdentity = (
    depPath: string,
  ): { name: string, url: string } => {
    const parsed = git.parseUrl(depPath);

    if (parsed.name) {
      this.rememberUrl(parsed.name, parsed.url);

      return { name: parsed.name, url: parsed.url };
    }

    const url = this.urlByName.get(depPath);

    if (!url) {
      throw new SVError('ADDON_NOT_FOUND', { name: depPath });
    }

    return { name: depPath, url };
  };

  /*
   * Патчим клон — сырой энтри в кэше остаётся нетронутым, оверрайды
   * не переживают simulate. add/delete применяются к каждой версии
   * родителя: будто модуль установлен (или удалён) в любой версии.
   */
  private applyOverrides = (entry: IPackageEntry): IPackageEntry => {
    const related = (this.overrides || [])
      .filter(override => override.parent === entry.name);

    if (!related.length) return entry;

    const versions = Object.fromEntries(
      Object.entries(entry.versions).map(([version, deps]) => {
        const patched = { ...deps };

        related.forEach(override => {
          if (override.add) {
            const { name } = git.parseUrl(override.add);

            if (!name) {
              throw new SVError('NOT_A_GIT_URL', { url: override.add });
            }

            this.rememberUrl(name, override.add);
            patched[name] = override.version || '*';
          }

          if (override.delete) {
            delete patched[override.delete];
          }
        });

        return [version, patched];
      }),
    );

    return { ...entry, versions };
  };

  /*
   * Загружает только один модуль: сразу все его semver-теги и зависимости
   * каждого тега. Сами подзависимости здесь не запрашиваются — PubGrub
   * вызовет fetch(name), только если реально рассмотрит нужную версию.
   */
  public fetch = (depPath: string): Promise<IPackageEntry> => {
    let identity: { name: string, url: string };

    try {
      identity = this.resolveIdentity(depPath);
    } catch (error) {
      return Promise.reject(error);
    }

    const cached = this.cache.get(identity.url);

    if (cached) {
      return this.overrides ? cached.then(this.applyOverrides) : cached;
    }

    const loading = this.load(identity.url, identity.name);

    this.cache.set(identity.url, loading);
    loading.catch(() => this.cache.delete(identity.url));

    return this.overrides ? loading.then(this.applyOverrides) : loading;
  };

  /*
   * Прогон коллбэка с потенциальными изменениями дерева. Оверрайды без
   * parent превращаются в эффективные rootDeps и уходят аргументом
   * в коллбэк, parent-оверрайды перезаписывают модули на всех fetch'ах
   * внутри. После завершения (в т.ч. по ошибке) оверрайды снимаются.
   */
  public simulate = async <T>(
    overrides: IOverride[],
    rootDeps: TDependencies,
    cb: (rootDeps: TDependencies) => Promise<T>,
  ): Promise<T> => {
    this.overrides = overrides.filter(override => override.parent);

    try {
      const rootOverrides = overrides.filter(override => !override.parent);

      return await cb(applyRootOverrides(rootOverrides, rootDeps));
    } finally {
      this.overrides = null;
    }
  };

  public urlOf = (name: string): string | undefined => this.urlByName.get(name);

  /* Изоляция тестов и явное обновление remote-каталога. */
  public clear = (): void => {
    this.cache.clear();
    this.urlByName.clear();
  };
}

export const entryStore = new EntryStore();
