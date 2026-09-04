import { Graph, IGraphEntry, TSV } from './Graph';

export interface IGraphDiffEntry {
  /* Родитель, чьи deps меняются; у корня родителя нет */
  parent?: string;
  method: 'PUT' | 'DELETE';
  /* Пакет, который ставим (уже с нужной версией) или удаляем */
  entry: IGraphEntry;
}

/* Ключи родителей узла в данном снимке entries */
const parentsOf = (
  entries: Record<string, IGraphEntry>,
  name: string,
): string[] => Object.keys(entries)
  .filter(key => key !== name && name in Graph.dependenciesOf(entries[key]));

const sameDeps = (a: TSV, b: TSV): boolean => {
  const keysA = Object.keys(a);

  return keysA.length === Object.keys(b).length
    && keysA.every(k => a[k] === b[k]);
};

/*
 * Разница двух снимков entries списком операций:
 * PUT — узел новый, либо у него изменилась версия или deps текущей
 * версии (entry — из modified, уже с нужной версией);
 * DELETE — узла нет в modified (entry — из original).
 * parent — чьи deps затронуты: тот, чей constraint новый/изменился,
 * иначе первый родитель; у корня родителя нет.
 * Ленивые изменения versions не текущей версии операцией не считаются.
 */
export const graphDiff = (
  original: Record<string, IGraphEntry>,
  modified: Record<string, IGraphEntry>,
): IGraphDiffEntry[] => {
  const diff: IGraphDiffEntry[] = [];

  Object.keys(modified).forEach(name => {
    const entry = modified[name];
    const prev = original[name];
    const parents = parentsOf(modified, name);

    if (!prev) {
      diff.push({ parent: parents[0], method: 'PUT', entry });

return;
    }

    const changed = prev.version !== entry.version
      || !sameDeps(
        Graph.dependenciesOf(prev),
        Graph.dependenciesOf(entry),
      );

    if (!changed) return;

    const parent = parents.find(p => {
      const prevDeps = original[p]
        ? Graph.dependenciesOf(original[p])
        : {};

      return prevDeps[name]
        !== Graph.dependenciesOf(modified[p])[name];
    }) || parents[0];

    diff.push({ parent, method: 'PUT', entry });
  });

  Object.keys(original).forEach(name => {
    if (modified[name]) return;

    diff.push({
      parent: parentsOf(original, name)[0],
      method: 'DELETE',
      entry: original[name],
    });
  });

  return diff;
};
