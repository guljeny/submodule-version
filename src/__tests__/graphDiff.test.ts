import { graphDiff, IGraphEntry } from '../graph';

const makeEntry = (partial: Partial<IGraphEntry>): IGraphEntry => ({
  name: 'A',
  versions: {},
  version: '',
  ...partial,
});

const rootEntry = makeEntry({
  name: 'ROOT',
  versions: {
    '1.0.0': { A: '^1.0.0' },
  },
  version: '1.0.0',
});

const AEntry = makeEntry({
  name: 'A',
  versions: {
    '1.0.0': { B: '^1.0.0' },
    '2.0.0': { B: '^2.0.0' },
  },
  version: '1.0.0',
});

const BEntry = makeEntry({
  name: 'B',
  versions: {
    '1.0.0': {},
    '2.0.0': {},
  },
  version: '1.0.0',
});

const CEntry = makeEntry({
  name: 'C',
  versions: {
    '1.0.0': {},
  },
  version: '1.0.0',
});

describe('graphDiff', () => {
  it('одинаковые снимки — пустой diff', () => {
    const original = { ROOT: rootEntry, A: AEntry, B: BEntry };

    expect(graphDiff(original, original)).toEqual([]);
  });

  it('новый узел — PUT, parent тот, кто на него ссылается', () => {
    const original = { ROOT: rootEntry, A: AEntry, B: BEntry };

    const modified = {
      ...original,
      ROOT: makeEntry({
        name: 'ROOT',
        versions: {
          '1.0.0': { A: '^1.0.0', C: '^1.0.0' },
        },
        version: '1.0.0',
      }),
      C: CEntry,
    };

    const diff = graphDiff(original, modified);

    expect(diff).toEqual([
      { parent: undefined, method: 'PUT', entry: modified.ROOT },
      { parent: 'ROOT', method: 'PUT', entry: CEntry },
    ]);
  });

  it('новый узел без родителя — PUT с parent undefined', () => {
    const original = { ROOT: rootEntry, A: AEntry, B: BEntry };
    const modified = { ...original, C: CEntry };

    expect(graphDiff(original, modified)).toEqual([
      { parent: undefined, method: 'PUT', entry: CEntry },
    ]);
  });

  it('удалённый узел — DELETE после всех PUT', () => {
    const original = { ROOT: rootEntry, A: AEntry, B: BEntry };

    const modifiedA = makeEntry({
      name: 'A',
      versions: {
        '1.0.0': {},
        '2.0.0': { B: '^2.0.0' },
      },
      version: '1.0.0',
    });

    const modified = { ROOT: rootEntry, A: modifiedA };
    const diff = graphDiff(original, modified);

    expect(diff).toEqual([
      { parent: 'ROOT', method: 'PUT', entry: modifiedA },
      { parent: 'A', method: 'DELETE', entry: BEntry },
    ]);
  });

  it('изменилась версия — PUT с новой entry', () => {
    const original = { ROOT: rootEntry, A: AEntry, B: BEntry };

    const modifiedB = makeEntry({
      name: 'B',
      versions: BEntry.versions,
      version: '2.0.0',
    });

    const modified = { ...original, B: modifiedB };

    expect(graphDiff(original, modified)).toEqual([
      { parent: 'A', method: 'PUT', entry: modifiedB },
    ]);
  });

  it('parent — родитель с изменившимся constraint, а не первый', () => {
    const rootWithB = makeEntry({
      name: 'ROOT',
      versions: {
        '1.0.0': { A: '^1.0.0', B: '^1.0.0' },
      },
      version: '1.0.0',
    });

    const original = { ROOT: rootWithB, A: AEntry, B: BEntry };

    const modifiedA = makeEntry({
      name: 'A',
      versions: {
        '1.0.0': { B: '^2.0.0' },
        '2.0.0': { B: '^2.0.0' },
      },
      version: '1.0.0',
    });

    const modifiedB = makeEntry({
      name: 'B',
      versions: BEntry.versions,
      version: '2.0.0',
    });

    const modified = { ROOT: rootWithB, A: modifiedA, B: modifiedB };
    const diff = graphDiff(original, modified);

    /* B упоминают и ROOT, и A — constraint изменился только у A */
    expect(diff).toEqual([
      { parent: 'ROOT', method: 'PUT', entry: modifiedA },
      { parent: 'A', method: 'PUT', entry: modifiedB },
    ]);
  });

  it('подгрузка versions не текущей версии — не операция', () => {
    const original = { ROOT: rootEntry, A: AEntry, B: BEntry };

    const modified = {
      ...original,
      A: makeEntry({
        name: 'A',
        versions: {
          ...AEntry.versions,
          '1.5.0': { B: '^1.0.0' },
        },
        version: '1.0.0',
      }),
    };

    expect(graphDiff(original, modified)).toEqual([]);
  });
});
