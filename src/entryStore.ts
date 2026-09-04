import { github } from './github';
import { git } from './git';
import { SVError } from './errors';
import type { IGraphEntry, TSV } from './graph';

/*
 * Кэш entries, загруженных из GitHub API: если кто-то уже начал грузить
 * entry по этому depPath — вернётся существующий промис, если загружена —
 * готовая зависимость. Ключ — git-url (он же ключ в sv package.json).
 */
const cache = new Map<string, Promise<IGraphEntry>>();
/*
 * name -> git-url подзависимости: регистрируется при загрузке sv deps
 * каждого entry, нужен fetch'у для рекурсии и SV для add submodule.
 */
const urlByName = new Map<string, string>();

const normalizeSv = (sv: TSV = {}): TSV => Object.fromEntries(
  Object.entries(sv).map(([depUrl, constraint]) => {
    const depName = git.parseUrl(depUrl).name || depUrl;

    urlByName.set(depName, depUrl);

    return [depName, constraint];
  }),
);

const load = async (url: string, name: string): Promise<IGraphEntry> => {
  /* Теги + package.json каждого тега — батчем через GraphQL */
  const fetched = await github.fetchVersions(url);
  const versions: Record<string, TSV> = {};

  fetched.forEach(({ version, pkg }) => {
    versions[version] = normalizeSv(pkg?.sv);
  });

  return { name, versions };
};

export const entryStore = {
  /*
   * Entry по depPath (git-url, можно с @version). Повторный вызов отдаёт
   * тот же промис/entry — параллельные запросы не дублируются.
   */
  get: (depPath: string): Promise<IGraphEntry> => {
    const { url, name } = git.parseUrl(depPath);

    if (!name) {
      return Promise.reject(new SVError('NOT_A_GIT_URL', { url: depPath }));
    }

    const cached = cache.get(url);

    if (cached) return cached;

    const loading = load(url, name);

    cache.set(url, loading);

    /* Неудачную загрузку не кэшируем — следующий вызов повторит запрос */
    loading.catch(() => cache.delete(url));

    return loading;
  },

  /*
   * Entry + рекурсивно все её подзависимости (их url известны — load
   * родителя регистрирует их в urlByName). visited — защита от циклов:
   * уже запрошенный url не обходим повторно.
   */
  fetch: async (
    depPath: string,
    visited: Set<string> = new Set(),
  ): Promise<IGraphEntry> => {
    const { url } = git.parseUrl(depPath);
    const entry = await entryStore.get(depPath);

    if (visited.has(url)) return entry;

    visited.add(url);

    const depUrls = new Set<string>();

    Object.values(entry.versions).forEach(deps => {
      Object.keys(deps).forEach(depName => {
        const depUrl = urlByName.get(depName);

        if (depUrl) depUrls.add(depUrl);
      });
    });

    await Promise.all(
      [...depUrls].map(depUrl => entryStore.fetch(depUrl, visited)),
    );

    return entry;
  },

  /* git-url по имени зависимости (git submodule add) */
  urlOf: (name: string): string | undefined => urlByName.get(name),
};
