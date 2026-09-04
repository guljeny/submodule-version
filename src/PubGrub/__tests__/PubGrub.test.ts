import { PubGrub } from '../PubGrub';
import type {
  IEntrySource,
  IPackageEntry,
  TDependencies,
  TPubGrubResult,
} from '../types';

const url = (name: string) => `git@git:repo/${name}.git`;

const defineModule = (
  name: string,
  versions: Record<string, TDependencies>,
): IPackageEntry => ({ name, url: url(name), versions });

const A = defineModule('A', {
  '1.0.0': { B: '^1.0.0', C: '^1.3.2' },
  '1.2.0': { B: '^1.2.0', C: '^1.3.2' },
});

const B = defineModule('B', {
  '1.0.0': { C: '^1.3.2' },
  '1.2.0': { C: '^1.4.2' },
});

const C = defineModule('C', {
  '1.3.2': {},
  '1.4.2': { E: '^0.0.3' },
});

const E = defineModule('E', {
  '0.0.3': {},
  '0.0.4': {},
});

const BacktrackA = defineModule('BacktrackA', {
  '1.0.0': { BacktrackB: '^1.0.0' },
  '2.0.0': { BacktrackB: '^2.0.0' },
});

const BacktrackB = defineModule('BacktrackB', {
  '1.5.0': {},
});

const DeepA = defineModule('DeepA', {
  '1.0.0': { DeepB: '^1.0.0' },
  '2.0.0': { DeepB: '^2.0.0' },
});

const DeepB = defineModule('DeepB', {
  '1.0.0': { DeepC: '^1.0.0' },
  '2.0.0': { DeepC: '^2.0.0' },
});

const DeepC = defineModule('DeepC', {
  '1.1.0': {},
});

const DiamondLeft = defineModule('DiamondLeft', {
  '1.0.0': { DiamondShared: '^1.0.0' },
});

const DiamondRight = defineModule('DiamondRight', {
  '1.0.0': { DiamondShared: '^1.4.0' },
});

const DiamondShared = defineModule('DiamondShared', {
  '1.2.0': {},
  '1.5.0': {},
  '2.0.0': {},
});

const LazyA = defineModule('LazyA', {
  '1.0.0': { Unused: '*' },
  '2.0.0': { LazyB: '*' },
});

const LazyB = defineModule('LazyB', {
  '1.0.0': { AlsoUnused: '*' },
  '2.0.0': {},
});

const Unused = defineModule('Unused', { '1.0.0': {} });
const AlsoUnused = defineModule('AlsoUnused', { '1.0.0': {} });

const FallbackA = defineModule('FallbackA', {
  '1.0.0': {},
  '2.0.0': { FallbackB: '*' },
});

const FallbackB = defineModule('FallbackB', {
  '1.0.0': { FallbackA: '^2.0.0' },
});

const ConflictA = defineModule('ConflictA', { '1.0.0': {} });

const ConflictB = defineModule('ConflictB', {
  '1.0.0': { ConflictA: '^2.0.0' },
});

const ExactA = defineModule('ExactA', { '1.0.0': {} });
const Empty = defineModule('Empty', {});

const InvalidA = defineModule('InvalidA', {
  '1.0.0': { InvalidB: 'invalid' },
});

const InvalidB = defineModule('InvalidB', { '1.0.0': {} });

const CycleA = defineModule('CycleA', {
  '1.0.0': { CycleB: '*' },
});

const CycleB = defineModule('CycleB', {
  '1.0.0': { CycleC: '*' },
});

const CycleC = defineModule('CycleC', {
  '1.0.0': { CycleA: '*' },
});

const SelfCycle = defineModule('SelfCycle', {
  '1.0.0': { SelfCycle: '*' },
});

const ALL_MODULES = [
  A,
  B,
  C,
  E,
  BacktrackA,
  BacktrackB,
  DeepA,
  DeepB,
  DeepC,
  DiamondLeft,
  DiamondRight,
  DiamondShared,
  LazyA,
  LazyB,
  Unused,
  AlsoUnused,
  FallbackA,
  FallbackB,
  ConflictA,
  ConflictB,
  ExactA,
  Empty,
  InvalidA,
  InvalidB,
  CycleA,
  CycleB,
  CycleC,
  SelfCycle,
];

const source = (modules: IPackageEntry[]) => {
  const entries = Object.fromEntries(modules.map(entry => [entry.name, entry]));
  const calls: string[] = [];

  const store: IEntrySource = {
    fetch: jest.fn(async (depPath: string) => {
      calls.push(depPath);

      const name = depPath.endsWith('.git')
        ? depPath.match(/\/([^/]+)\.git$/)?.[1]
        : depPath;

      return entries[name!];
    }),
  };

  return { store, calls };
};

class TestRoot {
  public fetched: string[] = [];

  constructor (
    private modules: IPackageEntry[],
    private dependencies: TDependencies = {},
  ) {}

  public add = (
    entry: IPackageEntry,
    range = '*',
  ): TestRoot => new TestRoot(this.modules, {
    ...this.dependencies,
    [entry.url]: range,
  });

  public resolve = (): Promise<TPubGrubResult> => {
    const fixture = source(this.modules);

    this.fetched = fixture.calls;

    return new PubGrub(fixture.store).resolve(this.dependencies);
  };
}

const root = new TestRoot(ALL_MODULES);

const selected = (result: TPubGrubResult) => Object.fromEntries(
  Object.entries(result).map(([name, entry]) => [name, entry.version]),
);

describe('PubGrub resolution', () => {
  it('resolves an empty root', async () => {
    const result = await root.resolve();

    expect(result).toEqual({});
    expect(root.fetched).toEqual([]);
  });

  it('selects highest compatible nested versions', async () => {
    const currentRoot = root.add(A, '^1.0.0');
    const result = await currentRoot.resolve();

    expect(selected(result)).toEqual({
      A: '1.2.0',
      B: '1.2.0',
      C: '1.4.2',
      E: '0.0.3',
    });
    expect(result.B.dependencies).toEqual({ C: '^1.4.2' });
  });

  it('backtracks from an incompatible newer parent version', async () => {
    const currentRoot = root.add(BacktrackA);
    const result = await currentRoot.resolve();

    expect(selected(result)).toEqual({
      BacktrackA: '1.0.0',
      BacktrackB: '1.5.0',
    });
  });

  it('backtracks through multiple dependency levels', async () => {
    const currentRoot = root.add(DeepA);
    const result = await currentRoot.resolve();

    expect(selected(result)).toEqual({
      DeepA: '1.0.0',
      DeepB: '1.0.0',
      DeepC: '1.1.0',
    });
  });

  it('intersects constraints from two root modules', async () => {
    const currentRoot = root
      .add(DiamondLeft)
      .add(DiamondRight);

    const result = await currentRoot.resolve();

    expect(selected(result)).toEqual({
      DiamondLeft: '1.0.0',
      DiamondRight: '1.0.0',
      DiamondShared: '1.5.0',
    });
  });

  it('does not fetch dependencies of unselected tags', async () => {
    const currentRoot = root.add(LazyA);
    const result = await currentRoot.resolve();

    expect(selected(result)).toEqual({
      LazyA: '2.0.0',
      LazyB: '2.0.0',
    });
    expect(currentRoot.fetched).toEqual([url('LazyA'), 'LazyB']);
  });

  it('backs away from a circular newer version', async () => {
    const currentRoot = root.add(FallbackA);
    const result = await currentRoot.resolve();

    expect(selected(result)).toEqual({ FallbackA: '1.0.0' });
  });
});

describe('PubGrub errors', () => {
  it('reports every requirement in a version conflict', async () => {
    const currentRoot = root
      .add(ConflictA, '^1.0.0')
      .add(ConflictB);

    await expect(currentRoot.resolve()).rejects.toMatchObject({
      error: 'VERSION_CONFLICT',
      details: {
        name: 'ConflictA',
        parents: {
          '<root>': '^1.0.0',
          'ConflictB@1.0.0': '^2.0.0',
        },
        versions: ['1.0.0'],
      },
    });
  });

  it('reports an unavailable exact version', async () => {
    const currentRoot = root.add(ExactA, '9.0.0');

    await expect(currentRoot.resolve()).rejects.toMatchObject({
      error: 'VERSION_CONFLICT',
      details: { name: 'ExactA', versions: ['1.0.0'] },
    });
  });

  it('reports a module without version tags', async () => {
    const currentRoot = root.add(Empty);

    await expect(currentRoot.resolve()).rejects.toMatchObject({
      error: 'VERSION_CONFLICT',
      details: { name: 'Empty', versions: [] },
    });
  });

  it('reports an invalid nested constraint and its owner', async () => {
    const currentRoot = root.add(InvalidA);

    await expect(currentRoot.resolve()).rejects.toMatchObject({
      error: 'UNKNOWN_VERSION',
      details: {
        name: 'InvalidB',
        parent: 'InvalidA@1.0.0',
        version: 'invalid',
      },
    });
  });

  it('reports the complete circular chain', async () => {
    const currentRoot = root.add(CycleA);

    await expect(currentRoot.resolve()).rejects.toMatchObject({
      error: 'CIRCULAR_DEPENDENCY',
      details: {
        chain: ['CycleC', 'CycleA', 'CycleB', 'CycleC'],
      },
    });
  });

  it('reports a self dependency', async () => {
    const currentRoot = root.add(SelfCycle);

    await expect(currentRoot.resolve()).rejects.toMatchObject({
      error: 'CIRCULAR_DEPENDENCY',
      details: { chain: ['SelfCycle', 'SelfCycle'] },
    });
  });
});
