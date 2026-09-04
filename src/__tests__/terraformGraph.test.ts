import { Graph, graphDiff, IGraphEntry } from '../graph';
import { terraformGraph } from '../terraformGraph';
import { git } from '../git';
import { pkgJSONManager } from '../pkgJSONManager';

jest.mock('../git', () => {
  const { parseGitUrl } = jest.requireActual('../git/parseGitUrl');

  return {
    git: {
      parseUrl: parseGitUrl,
      readJSONAtRef: jest.fn(async () => null),
    },
  };
});

jest.mock('../pkgJSONManager', () => ({
  pkgJSONManager: {
    read: jest.fn(async () => null),
    write: jest.fn(async () => {}),
  },
}));

const url = (name: string) => `git@git:repo/${name}.git`;
const readJSONAtRefMock = git.readJSONAtRef as jest.Mock;
const readMock = pkgJSONManager.read as jest.Mock;

const makeEntry = (partial: Partial<IGraphEntry>): IGraphEntry => ({
  name: 'A',
  versions: {},
  version: '',
  ...partial,
});

const graph = new Graph();
graph.projectName = 'ROOT';

// const makeGraph = (
//   entries: Record<string, Partial<IGraphEntry>>,
//   projectName = 'myProject',
// ) => {
//   graph.entries = Object.fromEntries(
//     Object.entries(entries).map(([name, partial]) => [
//       name,
//       makeEntry({ name, ...partial }),
//     ]),
//   );

//   return graph;
// };

const rootEntry = makeEntry({
  name: 'root',
  versions: {
    '1.0.0': {
      A: '^1.0.0',
    },
  },
  version: '1.0.0',
});

const AEntry = makeEntry({
  name: 'A',
  versions: {
    '1.0.0': { B: '^1.0.0' },
    '1.5.0': { B: '^1.0.0' },
    '2.0.0': { B: '^1.0.0' },
    '2.1.2': { B: '^1.0.0' },
    '2.2.0': { B: '^2.0.0' },
  },
  version: '1.5.0',
});

const BEntry = makeEntry({
  name: 'B',
  versions: {
    '0.0.3': {},
    '1.0.0': {},
    '1.5.0': {},
    '1.5.1': {},
    '2.0.0': {},
  },
  version: '1.0.0',
});

// const CEntry = makeEntry({
//   name: 'C',
//   versions: ['0.0.1', '1.0.0', '1.1.0', '1.1.1', '1.2.1', '2.0.1'],
//   requestedVersions: { myProject: '^1.1.0', B: '^1.0.0' },
// });

const DEntry = makeEntry({
  name: 'D',
  versions: {
    '0.0.1': { B: '*' },
    '1.0.0': { B: '^1.0.0' },
    '1.1.0': { B: '^1.0.0' },
    '1.1.1': { B: '^1.0.0' },
    '1.2.1': { B: '^1.5.0' },
    '2.0.1': { B: '2.0.0' },
  },
});

const sharedGraphConfig = {
  ROOT: rootEntry,
  A: AEntry,
  B: BEntry,
  // C: CEntry,
};

describe('checkAdd', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readMock.mockImplementation(async () => null);
    graph.entries = sharedGraphConfig;
  });

  // Verified, do not change
  it('Добавляем новую версию без зависимостей', () => {
    const modifiedGraph = terraformGraph(graph, DEntry, '^1.0.0');
    const diff = graphDiff(graph.entries, modifiedGraph);
    expect(diff.length).toBe(2);
    expect(modifiedGraph.D).toBeDefined();
  });

  // Verified, do not change
  it('Добавляем новую версию c зависимостями ломающими обновление', () => {
    expect(() => terraformGraph(graph, DEntry, '2.0.1'))
      .toThrow('VERSION_CONFLICT');
  });

  it('Добавляем новую версию c зависимостями требующими обновление', () => {
    expect(graph.entries.B.version).toBe('1.0.0');
    const modifiedGraph = terraformGraph(graph, DEntry, '^1.2.1');
    const diff = graphDiff(graph.entries, modifiedGraph);
    // expect(diff).toBe([]);

    // expect(diff.length).toBe(3);
    expect(modifiedGraph.D).toBeDefined();
    expect(modifiedGraph.B.version).toBe('1.5.0');
  });

  it('Добавляем новую версию с новой подзависимостью', () => {

//     const modifiedGraph = terraformGraph(graph, DEntry, '^1.2.1');
//     const diff = graphDiff(graph.entries, modifiedGraph);

//     /* E инициализируется в графе: exact-пин 1.0.1, deps подгрузятся позже */
//     expect(diff.length).toBe(3);
//     expect(modifiedGraph.G).toBeDefined();
//     expect(modifiedGraph.E).toBeDefined();
//     expect(modifiedGraph.E.version).toBe('1.0.1');
  });

  it('Добавляем новую версию с существующей подзависимостью', () => {
    const modifiedGraph = terraformGraph(graph, DEntry, '1.1.0');
    const diff = graphDiff(graph.entries, modifiedGraph);

    expect(diff.length).toBe(2);
    expect(modifiedGraph.D.version).toBe('1.1.0');
  });

  it('Добавляем новую версию с подзависимостью где надо апать minor', () => {
    const HEntry = makeEntry({
      name: 'H',
      versions: {
        '1.0.0': { B: '^1.5.0' },
      },
    });

    const modifiedGraph = terraformGraph(graph, HEntry, '^1.0.0');
    const diff = graphDiff(graph.entries, modifiedGraph);

    /* B уже резолвится в 1.5.1 — сужение до ^1.5.0 резолв не меняет */
    expect(diff.length).toBe(2);
    expect(modifiedGraph.H).toBeDefined();
  });

  it('Добавляем новую версию где constraint апается до minor', () => {
    const modifiedGraph = terraformGraph(graph, DEntry, '^1.0.0');

    /* Просим ^1.0.0 — ставится последняя допустимая 1.2.1 */
    expect(modifiedGraph.D.version).toBe('1.2.1');
  });

  it('Добавляем новую версию с подзависимостью где надо апать major', () => {
    const JEntry = makeEntry({
      name: 'J',
      versions: {
        '1.0.0': { B: '^0.0.3' },
      },
    });

    expect(() => terraformGraph(graph, JEntry, '^1.0.0'))
      .toThrow('VERSION_CONFLICT');
  });

  it('Пробуем обновить версию до конфликта в major', () => {
    expect(() => terraformGraph(graph, AEntry, '2.2.0'))
      .toThrow('VERSION_CONFLICT');
  });
});
