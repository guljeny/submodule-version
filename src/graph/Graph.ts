import { versionUtil } from '../versionUtil';
import { entryStore } from '../entryStore';
import { SVError } from '../errors';

export type TSV = Record<string, string>;

export interface IGraphEntry {
  name: string;
  /*
   * version -> deps этой версии (name -> constraint). Все версии и их
   * deps загружаются из GitHub API сразу (entryStore) — ленивой
   * подгрузки и null-значений больше нет.
   */
  versions: Record<string, TSV>;
  /* Выбранная версия — проставляется при сборке/трансформации графа */
  version?: string;
}

/*
 * deps узла — deps его выбранной версии; версия не выбрана — deps
 * неизвестны (пустой объект).
 */
const dependenciesOf = (entry: IGraphEntry): TSV => (
  (entry.version && entry.versions[entry.version]) || {}
);

/* Глубокая копия записи: граф мутирует свои entries, кэш store не трогаем */
const cloneEntry = (entry: IGraphEntry): IGraphEntry => ({
  ...entry,
  versions: Object.fromEntries(
    Object.entries(entry.versions).map(([v, deps]) => [v, { ...deps }]),
  ),
});

export class Graph {
  public entries: Record<string, IGraphEntry> = {};

  /*
   * Минимальный граф из entryStore: только рутовые зависимости
   * ({ Dep1: IGraphEntry, Dep2: IGraphEntry }) с проставленной version —
   * последняя, удовлетворяющая requestedVersion (exact — пин в себя).
   * Данные уже должны быть загружены (entryStore.fetch), обращений
   * в сеть отсюда нет — только промисы из кэша store.
   */
  public init = async (
    rootDeps: Record<string, string>,
  ): Promise<Graph> => {
    const entries: Record<string, IGraphEntry> = {};

    await Promise.all(
      Object.entries(rootDeps).map(async ([depPath, requestedVersion]) => {
        const entry = await entryStore.get(depPath);
        const requested = requestedVersion || '*';
        const versions = Object.keys(entry.versions);

        /* exact-версия — только из существующих тегов */
        if (versionUtil.validate(requested)) {
          if (!versions.includes(requested)) {
            throw new SVError('REQUESTED_VERSION_NOT_EXISTS', {
              name: entry.name,
              requestedVersion: requested,
              versions,
            });
          }

          entries[entry.name] = { ...cloneEntry(entry), version: requested };

          return;
        }

        const version = versionUtil.latest(versionUtil.pick(
          versions,
          requested,
        ));

        /* Теги есть, но ни один не подходит под constraint */
        if (!version && versions.length) {
          throw new SVError('VERSION_CONFLICT', {
            name: entry.name,
            requestedVersion: requested,
            versions,
          });
        }

        entries[entry.name] = {
          ...cloneEntry(entry),
          version: version || undefined,
        };
      }),
    );

    this.entries = entries;

    return this;
  };

  /*
   * Трансформация графа: поставить/сменить/удалить зависимость.
   * entryPath — всегда ('A' — рутовая зависимость, 'A.B' — B внутри A);
   * version — constraint ('*' — любая), null — удаление.
   * Возвращает НОВЫЙ граф, текущий не мутируется.
   * Логика резолва будет описана отдельно — сейчас заглушка: возвращает
   * копию графа без изменений.
   */
  public terraform = (
    entryPath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    version: string | null = '*',
  ): Graph => {
    const next = new Graph();

    next.entries = this.cloneEntries();

    return next;
  };

  public static dependenciesOf = dependenciesOf;

  /* Кто и с каким constraint требует аддон (parentName -> constraint) */
  public requirementsOf = (name: string): Record<string, string> => (
    Object.fromEntries(
      Object.values(this.entries)
        .filter(entry => name in Graph.dependenciesOf(entry))
        .map(entry => [entry.name, Graph.dependenciesOf(entry)[name]]),
    )
  );

  /*
   * Пересечение constraints всех требующих — вычисляется на лету:
   * после любой мутации кэш не может устареть, потому что его нет.
   */
  public used = (name: string): string[] => {
    const entry = this.entries[name];

    if (!entry) return [];

    return Object.values(this.requirementsOf(name)).reduce(
      (selective, v) => versionUtil.pick(selective, v),
      Object.keys(entry.versions),
    );
  };

  /*
   * Копия entries для нового графа: записи и их versions независимы
   * от оригинала.
   */
  public cloneEntries = (): Record<string, IGraphEntry> => Object.fromEntries(
    Object.entries(this.entries).map(([name, entry]) => [
      name,
      cloneEntry(entry),
    ]),
  );
}
