import { Graph, IGraphEntry } from '../Graph';
import { git } from '../../git';
import { pkgJSONManager } from '../../pkgJSONManager';
import { RunOptions } from '../../runOptions';

jest.mock('fs', () => ({
  existsSync: jest.fn(() => true),
}));

jest.mock('../../git', () => {
  const { parseGitUrl } = jest.requireActual('../../git/parseGitUrl');

  return {
    git: {
      parseUrl: parseGitUrl,
      addSumbmodule: jest.fn(async () => {}),
      listVersions: jest.fn(async () => []),
      currentVersion: jest.fn(async () => null),
      hasChanges: jest.fn(async () => false),
      hasUnpushedCommits: jest.fn(async () => false),
      checkout: jest.fn(async () => {}),
      readJSONAtRef: jest.fn(async () => null),
    },
  };
});

jest.mock('../../pkgJSONManager', () => ({
  pkgJSONManager: {
    read: jest.fn(async () => null),
    write: jest.fn(async () => {}),
  },
}));

type TPkg = {
  name: string;
  version?: string;
  sv?: Record<string, string>;
};

const ROOT = '__root__';
const url = (name: string) => `git@git:repo/${name}.git`;

const gitMock = git as unknown as {
  listVersions: jest.Mock;
  currentVersion: jest.Mock;
  checkout: jest.Mock;
  readJSONAtRef: jest.Mock;
};

const readMock = pkgJSONManager.read as jest.Mock;
let packages: Record<string, TPkg>;
let tags: Record<string, string[]>;
let heads: Record<string, string | null>;

const makeEntry = (partial: Partial<IGraphEntry>): IGraphEntry => ({
  name: 'A',
  versions: [],
  parents: {},
  used: [],
  allowedVersions: [],
  version: '',
  depsByVersion: {},
  ...partial,
});

beforeEach(() => {
  RunOptions.cwd = '/fake';
  RunOptions.modulesDir = 'addons';

  packages = {};
  tags = {};
  heads = {};

  jest.clearAllMocks();

  readMock.mockImplementation(async (name?: string) => (
    packages[name || ROOT] || null
  ));
  gitMock.listVersions.mockImplementation(
    async (name: string) => tags[name] || [],
  );
  gitMock.currentVersion.mockImplementation(
    async (name: string) => heads[name] || null,
  );
});

describe('Graph.build', () => {
  it('Happy path: root -> A -> B', async () => {
    packages[ROOT] = { name: 'root', sv: { [url('A')]: '^1.0.0' } };
    packages.A = { name: 'A', version: '1.1.0', sv: { [url('B')]: '^2.0.0' } };
    packages.B = { name: 'B', version: '2.0.0' };
    tags.A = ['1.0.0', '1.1.0'];
    tags.B = ['2.0.0'];
    heads.A = '1.1.0';
    heads.B = '2.0.0';

    const graph = await Graph.build();

    expect(graph.projectName).toBe('root');
    expect(graph.entries.A.parents).toEqual({ root: '^1.0.0' });
    expect(graph.entries.A.used).toEqual(['1.0.0', '1.1.0']);
    expect(graph.entries.A.version).toBe('1.1.0');
    expect(graph.entries.A.depsByVersion['1.1.0']).toEqual({ B: '^2.0.0' });
    expect(graph.entries.B.parents).toEqual({ A: '^2.0.0' });
    expect(graph.entries.B.used).toEqual(['2.0.0']);
    expect(graph.entries.B.version).toBe('2.0.0');
  });

  it('Нет package.json: NOT_A_NPM', async () => {
    await expect(Graph.build()).rejects.toMatchObject({
      error: 'NOT_A_NPM',
    });
  });

  it('Цикл A <-> B: CIRCULAR_DEPENDENCY с полным chain', async () => {
    packages[ROOT] = { name: 'root', sv: { [url('A')]: '^1.0.0' } };
    packages.A = { name: 'A', version: '1.0.0', sv: { [url('B')]: '^1.0.0' } };
    packages.B = { name: 'B', version: '1.0.0', sv: { [url('A')]: '^1.0.0' } };

    await expect(Graph.build()).rejects.toMatchObject({
      error: 'CIRCULAR_DEPENDENCY',
      details: expect.objectContaining({
        name: 'A',
        parent: 'B',
        chain: ['root', 'A', 'B', 'A'],
      }),
    });
  });

  it('Самоссылка A -> A', async () => {
    packages[ROOT] = { name: 'root', sv: { [url('A')]: '^1.0.0' } };
    packages.A = { name: 'A', version: '1.0.0', sv: { [url('A')]: '^1.0.0' } };

    await expect(Graph.build()).rejects.toMatchObject({
      error: 'CIRCULAR_DEPENDENCY',
      details: expect.objectContaining({
        name: 'A',
        chain: ['root', 'A', 'A'],
      }),
    });
  });

  it('Транзитивный цикл A -> B -> C -> A', async () => {
    packages[ROOT] = { name: 'root', sv: { [url('A')]: '^1.0.0' } };
    packages.A = { name: 'A', version: '1.0.0', sv: { [url('B')]: '^1.0.0' } };
    packages.B = { name: 'B', version: '1.0.0', sv: { [url('C')]: '^1.0.0' } };
    packages.C = { name: 'C', version: '1.0.0', sv: { [url('A')]: '^1.0.0' } };

    await expect(Graph.build()).rejects.toMatchObject({
      error: 'CIRCULAR_DEPENDENCY',
      details: expect.objectContaining({
        name: 'A',
        chain: ['root', 'A', 'B', 'C', 'A'],
      }),
    });
  });

  it('Ромб root -> {A, B}, A -> C, B -> C: C читается один раз', async () => {
    packages[ROOT] = {
      name: 'root',
      sv: { [url('A')]: '^1.0.0', [url('B')]: '^1.0.0' },
    };
    packages.A = { name: 'A', version: '1.0.0', sv: { [url('C')]: '^1.0.0' } };
    packages.B = { name: 'B', version: '1.0.0', sv: { [url('C')]: '^1.0.0' } };
    packages.C = { name: 'C', version: '1.2.0' };
    tags.A = ['1.0.0'];
    tags.B = ['1.0.0'];
    tags.C = ['1.0.0', '1.2.0'];
    heads.A = '1.0.0';
    heads.B = '1.0.0';
    heads.C = '1.2.0';

    const graph = await Graph.build();

    expect(graph.entries.C.parents).toEqual({ A: '^1.0.0', B: '^1.0.0' });
    expect(graph.entries.C.used).toEqual(['1.0.0', '1.2.0']);

    const cReads = readMock.mock.calls.filter(([name]) => name === 'C');

    expect(cReads).toHaveLength(1);
  });

  it('Constraints не пересекаются: VERSION_CONFLICT с parents', async () => {
    packages[ROOT] = {
      name: 'root',
      sv: { [url('A')]: '^1.0.0', [url('B')]: '^1.0.0' },
    };
    packages.A = { name: 'A', version: '1.0.0' };
    packages.B = { name: 'B', version: '1.0.0', sv: { [url('A')]: '^2.0.0' } };
    tags.A = ['1.0.0', '2.0.0'];
    tags.B = ['1.0.0'];

    await expect(Graph.build()).rejects.toMatchObject({
      error: 'VERSION_CONFLICT',
      details: expect.objectContaining({
        name: 'A',
        parents: { root: '^1.0.0', B: '^2.0.0' },
      }),
    });
  });
});

describe('Graph: инкрементальные мутации', () => {
  const makeGraph = () => {
    const graph = new Graph();
    graph.projectName = 'root';
    graph.entries = {
      A: makeEntry({
        name: 'A',
        versions: ['1.0.0', '2.0.0'],
        parents: { root: '^1.0.0' },
        version: '1.0.0',
      }),
      C: makeEntry({
        name: 'C',
        versions: ['1.0.0', '1.2.0'],
        parents: { A: '^1.0.0', B: '^1.0.0' },
        version: '1.2.0',
      }),
    };
    graph.recompute();

    return graph;
  };

  it('setConstraint + recompute: пересчёт только затронутого узла', () => {
    const graph = makeGraph();

    graph.setConstraint('A', 'root', '^2.0.0');
    graph.recompute(['A']);

    expect(graph.entries.A.used).toEqual(['2.0.0']);
    expect(graph.entries.C.used).toEqual(['1.0.0', '1.2.0']);
  });

  it('recompute с пустым пересечением кидает VERSION_CONFLICT', () => {
    const graph = makeGraph();

    graph.setConstraint('C', 'B', '^2.0.0');

    expect(() => graph.recompute(['C'])).toThrow(
      expect.objectContaining({ error: 'VERSION_CONFLICT' }),
    );
  });

  it('addNode добавляет узел и сразу считает used', () => {
    const graph = makeGraph();

    graph.addNode('D', {
      versions: ['3.0.0', '3.1.0'],
      parents: { A: '^3.0.0' },
      version: '3.1.0',
    });

    expect(graph.entries.D.used).toEqual(['3.0.0', '3.1.0']);
    expect(graph.entries.D.depsByVersion).toEqual({ '3.1.0': {} });
  });

  it('removeEdge убирает только указанного родителя', () => {
    const graph = makeGraph();

    graph.removeEdge('C', 'B');
    graph.recompute(['C']);

    expect(graph.entries.C.parents).toEqual({ A: '^1.0.0' });
  });

  it('removeNode сносит узел и edges детей на него', () => {
    const graph = makeGraph();

    graph.removeNode('A');

    expect(graph.entries.A).toBeUndefined();
    expect(graph.entries.C.parents).toEqual({ B: '^1.0.0' });
  });

  it('resolvePath: валидный путь возвращает entry и parentChain', () => {
    const graph = makeGraph();
    const { entry, parentChain } = graph.resolvePath('A.C');

    expect(entry.name).toBe('C');
    expect(parentChain).toEqual(['root', 'A']);
  });

  it('resolvePath: несуществующий путь кидает PATH_NOT_FOUND', () => {
    const graph = makeGraph();

    expect(() => graph.resolvePath('A.X')).toThrow(
      expect.objectContaining({ error: 'PATH_NOT_FOUND' }),
    );
    /* C есть в графе, но не под корнем напрямую */
    expect(() => graph.resolvePath('C')).toThrow(
      expect.objectContaining({ error: 'PATH_NOT_FOUND' }),
    );
  });

  it('ensureDeps: текущая из рабочей копии, прочие — из git', async () => {
    const graph = makeGraph();
    packages.A = { name: 'A', version: '1.0.0', sv: { [url('C')]: '^1.0.0' } };
    gitMock.readJSONAtRef.mockImplementation(
      async (_name: string, ref: string) => (
        ref === '2.0.0' ? { name: 'A', sv: { [url('C')]: '^1.2.0' } } : null
      ),
    );

    const current = await graph.ensureDeps('A', '1.0.0');
    const other = await graph.ensureDeps('A', '2.0.0');

    expect(current).toEqual({ C: '^1.0.0' });
    expect(other).toEqual({ C: '^1.2.0' });
    expect(gitMock.readJSONAtRef).toHaveBeenCalledTimes(1);
    expect(gitMock.readJSONAtRef).toHaveBeenCalledWith('A', '2.0.0');

    /* Повторный вызов — из кэша, без git */
    await graph.ensureDeps('A', '2.0.0');
    expect(gitMock.readJSONAtRef).toHaveBeenCalledTimes(1);
  });
});
