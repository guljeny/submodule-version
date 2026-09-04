import { SVError } from './errors';
import { git } from './git';
import { github } from './github';
import type { IPackageEntry, TDependencies } from './PubGrub/types';

const cache = new Map<string, Promise<IPackageEntry>>();
const urlByName = new Map<string, string>();

const rememberUrl = (name: string, url: string): void => {
  const current = urlByName.get(name);

  if (current && current !== url) {
    throw new SVError('ADDON_NOT_FOUND', {
      name,
      urls: [current, url],
    });
  }

  urlByName.set(name, url);
};

const normalizeDependencies = (
  dependencies: TDependencies = {},
): TDependencies => Object.fromEntries(
  Object.entries(dependencies).map(([depUrl, constraint]) => {
    const { name } = git.parseUrl(depUrl);

    if (!name) {
      throw new SVError('NOT_A_GIT_URL', { url: depUrl });
    }

    rememberUrl(name, depUrl);

    return [name, constraint];
  }),
);

const load = async (url: string, name: string): Promise<IPackageEntry> => {
  const fetched = await github.fetchVersions(url);
  const versions: Record<string, TDependencies> = {};

  fetched.forEach(({ version, pkg }) => {
    versions[version] = normalizeDependencies(pkg?.sv || {});
  });

  return { name, url, versions };
};

const resolveIdentity = (depPath: string): { name: string, url: string } => {
  const parsed = git.parseUrl(depPath);

  if (parsed.name) {
    rememberUrl(parsed.name, parsed.url);

    return { name: parsed.name, url: parsed.url };
  }

  const url = urlByName.get(depPath);

  if (!url) {
    throw new SVError('ADDON_NOT_FOUND', { name: depPath });
  }

  return { name: depPath, url };
};

export const entryStore = {
  /*
   * Загружает только один модуль: сразу все его semver-теги и зависимости
   * каждого тега. Сами подзависимости здесь не запрашиваются — PubGrub
   * вызовет fetch(name), только если реально рассмотрит нужную версию.
   */
  fetch: (depPath: string): Promise<IPackageEntry> => {
    let identity: { name: string, url: string };

    try {
      identity = resolveIdentity(depPath);
    } catch (error) {
      return Promise.reject(error);
    }

    const cached = cache.get(identity.url);

    if (cached) return cached;

    const loading = load(identity.url, identity.name);

    cache.set(identity.url, loading);
    loading.catch(() => cache.delete(identity.url));

    return loading;
  },

  urlOf: (name: string): string | undefined => urlByName.get(name),

  /* Изоляция тестов и явное обновление remote-каталога. */
  clear: (): void => {
    cache.clear();
    urlByName.clear();
  },
};
