import { PubGrub } from '../PubGrub';
import type {
  IEntrySource,
  IPackageEntry,
  TDependencies,
  TPubGrubResult,
  TResolveResult,
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

const CandidateA = {
  ...defineModule('CandidateA', {
    '1.0.0': {},
    '2.0.0': {},
  }),
  manifests: {
    '1.0.0': { compatible: true },
    '2.0.0': { compatible: false },
  },
};

const RangeA = defineModule('RangeA', {
  '1.2.3': {},
  '1.2.6': {},
  '1.3.0': {},
  '1.5.5': {},
  '2.0.0': {},
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
  CandidateA,
  RangeA,
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

  public resolve = (): Promise<TResolveResult> => {
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
    const { resolution, errors } = await root.resolve();

    expect(resolution).toEqual({});
    expect(errors).toEqual([]);
    expect(root.fetched).toEqual([]);
  });

  it('selects highest compatible nested versions', async () => {
    const currentRoot = root.add(A, '^1.0.0');
    const { resolution } = await currentRoot.resolve();

    expect(selected(resolution)).toEqual({
      A: '1.2.0',
      B: '1.2.0',
      C: '1.4.2',
      E: '0.0.3',
    });
    expect(resolution.B.dependencies).toEqual({ C: '^1.4.2' });
  });

  it('allows minor and patch updates for a caret range', async () => {
    const currentRoot = root.add(RangeA, '^1.2.5');
    const { resolution } = await currentRoot.resolve();

    expect(selected(resolution)).toEqual({ RangeA: '1.5.5' });
  });

  it('allows only patch updates for a tilde range', async () => {
    const currentRoot = root.add(RangeA, '~1.2.3');
    const { resolution } = await currentRoot.resolve();

    expect(selected(resolution)).toEqual({ RangeA: '1.2.6' });
  });

  it('collects requested constraints per requester', async () => {
    const currentRoot = root.add(A, '^1.0.0');
    const { resolution } = await currentRoot.resolve();

    expect(resolution.A.requestedVersion).toEqual({ '<root>': '^1.0.0' });
    expect(resolution.B.requestedVersion).toEqual({ A: '^1.2.0' });
    expect(resolution.E.requestedVersion).toEqual({ C: '^0.0.3' });
  });

  it('merges constraints of two parents in requestedVersion', async () => {
    const currentRoot = root
      .add(DiamondLeft)
      .add(DiamondRight);

    const { resolution } = await currentRoot.resolve();

    expect(resolution.DiamondShared.requestedVersion).toEqual({
      DiamondLeft: '^1.0.0',
      DiamondRight: '^1.4.0',
    });
    expect(resolution.DiamondLeft.requestedVersion).toEqual({
      '<root>': '*',
    });
  });

  it('backtracks from an incompatible newer parent version', async () => {
    const currentRoot = root.add(BacktrackA);
    const { resolution } = await currentRoot.resolve();

    expect(selected(resolution)).toEqual({
      BacktrackA: '1.0.0',
      BacktrackB: '1.5.0',
    });
  });

  it('backtracks through multiple dependency levels', async () => {
    const currentRoot = root.add(DeepA);
    const { resolution } = await currentRoot.resolve();

    expect(selected(resolution)).toEqual({
      DeepA: '1.0.0',
      DeepB: '1.0.0',
      DeepC: '1.1.0',
    });
  });

  it('intersects constraints from two root modules', async () => {
    const currentRoot = root
      .add(DiamondLeft)
      .add(DiamondRight);

    const { resolution } = await currentRoot.resolve();

    expect(selected(resolution)).toEqual({
      DiamondLeft: '1.0.0',
      DiamondRight: '1.0.0',
      DiamondShared: '1.5.0',
    });
  });

  it('does not fetch dependencies of unselected tags', async () => {
    const currentRoot = root.add(LazyA);
    const { resolution } = await currentRoot.resolve();

    expect(selected(resolution)).toEqual({
      LazyA: '2.0.0',
      LazyB: '2.0.0',
    });
    expect(currentRoot.fetched).toEqual([url('LazyA'), 'LazyB']);
  });

  it('backs away from a circular newer version', async () => {
    const currentRoot = root.add(FallbackA);
    const { resolution } = await currentRoot.resolve();

    expect(selected(resolution)).toEqual({ FallbackA: '1.0.0' });
  });

  it('selects the highest candidate accepted by the host', async () => {
    const fixture = source(ALL_MODULES);

    const resolver = new PubGrub(
      fixture.store,
      candidate => (candidate.packageJson as any)?.compatible !== false,
    );

    const { resolution } = await resolver.resolve({ [CandidateA.url]: '*' });

    expect(selected(resolution)).toEqual({ CandidateA: '1.0.0' });
    expect(resolution.CandidateA.versions).toEqual({
      '1.0.0': {},
      '2.0.0': {},
    });
  });

  it('reports a conflict when the host rejects every candidate', async () => {
    const fixture = source(ALL_MODULES);
    const resolver = new PubGrub(fixture.store, () => false);

    const { resolution, errors } = await resolver.resolve({
      [CandidateA.url]: '*',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      error: 'VERSION_CONFLICT',
      details: { name: 'CandidateA', versions: [] },
    });

    expect(resolution).toEqual({});
    expect(resolver.getResolution()).toEqual({});
  });
});

describe('PubGrub errors', () => {
  it('keeps a best-effort resolution after a version conflict', async () => {
    const fixture = source(ALL_MODULES);
    const resolver = new PubGrub(fixture.store);

    const dependencies = {
      [ConflictA.url]: '^1.0.0',
      [ConflictB.url]: '*',
    };

    const { resolution, errors } = await resolver.resolve(dependencies);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      error: 'VERSION_CONFLICT',
    });

    expect(selected(resolution)).toEqual({
      ConflictA: '1.0.0',
      ConflictB: '1.0.0',
    });
    expect(resolver.getResolution()).toBe(resolution);
  });

  it('keeps an available version when the requested one does not exist',
    async () => {
      const fixture = source(ALL_MODULES);
      const resolver = new PubGrub(fixture.store);

      const { resolution, errors } = await resolver.resolve({
        [ExactA.url]: '9.0.0',
      });

      expect(errors[0]).toMatchObject({ error: 'VERSION_CONFLICT' });

      expect(selected(resolution)).toEqual({
        ExactA: '1.0.0',
      });
    });

  it('reports every requirement in a version conflict', async () => {
    const currentRoot = root
      .add(ConflictA, '^1.0.0')
      .add(ConflictB);

    const { errors } = await currentRoot.resolve();

    expect(errors[0]).toMatchObject({
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
    const { errors } = await currentRoot.resolve();

    expect(errors[0]).toMatchObject({
      error: 'VERSION_CONFLICT',
      details: { name: 'ExactA', versions: ['1.0.0'] },
    });
  });

  it('reports a module without version tags', async () => {
    const currentRoot = root.add(Empty);
    const { errors } = await currentRoot.resolve();

    expect(errors[0]).toMatchObject({
      error: 'VERSION_CONFLICT',
      details: { name: 'Empty', versions: [] },
    });
  });

  it('reports an invalid nested constraint and its owner', async () => {
    const currentRoot = root.add(InvalidA);
    const { resolution, errors } = await currentRoot.resolve();

    expect(errors[0]).toMatchObject({
      error: 'UNKNOWN_VERSION',
      details: {
        name: 'InvalidB',
        parent: 'InvalidA@1.0.0',
        version: 'invalid',
      },
    });
    /* Модуль с битым constraint пропускается, резолюция продолжается */
    expect(selected(resolution)).toEqual({ InvalidA: '1.0.0' });
  });

  it('skips a root that fails to load and resolves the rest', async () => {
    const fixture = source(ALL_MODULES);

    const failingStore: IEntrySource = {
      fetch: async (depPath: string) => {
        if (depPath === url('A')) throw new Error('network');

        return fixture.store.fetch(depPath);
      },
    };

    const resolver = new PubGrub(failingStore);

    const { resolution, errors } = await resolver.resolve({
      [url('A')]: '*',
      [ExactA.url]: '*',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: url('A') },
    });
    expect(selected(resolution)).toEqual({ ExactA: '1.0.0' });
  });

  it('skips a nested module that fails to load', async () => {
    const fixture = source(ALL_MODULES);

    const failingStore: IEntrySource = {
      fetch: async (depPath: string) => {
        if (depPath === 'E') throw new Error('network');

        return fixture.store.fetch(depPath);
      },
    };

    const resolver = new PubGrub(failingStore);

    const { resolution, errors } = await resolver.resolve({
      [url('A')]: '*',
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'E' },
    });
    expect(selected(resolution)).toEqual({
      A: '1.2.0',
      B: '1.2.0',
      C: '1.4.2',
    });
  });

  it('reports the complete circular chain', async () => {
    const currentRoot = root.add(CycleA);
    const { errors } = await currentRoot.resolve();

    expect(errors[0]).toMatchObject({
      error: 'CIRCULAR_DEPENDENCY',
      details: {
        chain: ['CycleC', 'CycleA', 'CycleB', 'CycleC'],
      },
    });
  });

  it('reports a self dependency', async () => {
    const currentRoot = root.add(SelfCycle);
    const { errors } = await currentRoot.resolve();

    expect(errors[0]).toMatchObject({
      error: 'CIRCULAR_DEPENDENCY',
      details: { chain: ['SelfCycle', 'SelfCycle'] },
    });
  });
});
