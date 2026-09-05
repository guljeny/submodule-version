import { entryStore } from '../entryStore';
import { SVError } from '../errors';
import { versionUtil } from '../versionUtil';
import {
  ICircularConflict,
  IEntrySource,
  IIncompatibility,
  IPackageEntry,
  IRequirement,
  TIsCandidateCompatible,
  ITerm,
  IVersionConflict,
  TConflict,
  TDependencies,
  TPubGrubResult,
} from './types';

interface ISolverState {
  selected: Map<string, string>;
  requirements: Map<string, IRequirement[]>;
  edges: Map<string, string[]>;
}

type TSearchResult = {
  ok: true;
  state: ISolverState;
} | {
  ok: false;
  conflict: TConflict;
};

type TTermState = 'satisfied' | 'contradicted' | 'inconclusive';

const ROOT = '<root>';
const ROOT_VERSION = '1.0.0';

const cloneState = (state: ISolverState): ISolverState => ({
  selected: new Map(state.selected),
  requirements: new Map(
    [...state.requirements].map(([name, requirements]) => [
      name,
      requirements.map(requirement => ({
        ...requirement,
        chain: [...requirement.chain],
      })),
    ]),
  ),
  edges: new Map(
    [...state.edges].map(([name, dependencies]) => [
      name,
      [...dependencies],
    ]),
  ),
});

const findPath = (
  edges: Map<string, string[]>,
  from: string,
  target: string,
  visited: Set<string> = new Set(),
): string[] | null => {
  if (from === target) return [from];
  if (visited.has(from)) return null;

  visited.add(from);

  for (const next of edges.get(from) || []) {
    const path = findPath(edges, next, target, visited);

    if (path) return [from, ...path];
  }

  return null;
};

export class PubGrub {
  private entries = new Map<string, IPackageEntry>();

  private resolution: TPubGrubResult = {};

  private partialState: ISolverState | null = null;

  private incompatibilities: IIncompatibility[] = [];

  private incompatibilityKeys = new Set<string>();

  private compatibleVersions = new Map<string, string[]>();

  constructor (
    private source: IEntrySource = entryStore,
    private isCandidateCompatible?: TIsCandidateCompatible,
  ) {}

  public resolve = async (
    rootDependencies: TDependencies,
  ): Promise<TPubGrubResult> => {
    this.entries = new Map();
    this.resolution = {};
    this.partialState = null;
    this.incompatibilities = [];
    this.incompatibilityKeys = new Set();
    this.compatibleVersions = new Map();

    const state: ISolverState = {
      selected: new Map([[ROOT, ROOT_VERSION]]),
      requirements: new Map(),
      edges: new Map(),
    };

    this.rememberState(state);

    try {
      const roots = await Promise.all(
        Object.entries(rootDependencies).map(async ([depPath, range]) => ({
          entry: await this.load(depPath),
          range: range || '*',
        })),
      );

      roots.forEach(({ entry, range }) => {
        this.assertConstraint(entry.name, range, ROOT);

        const requirement = this.requirement(
          entry.name,
          range,
          ROOT,
          [ROOT, entry.name],
        );

        this.addIncompatibility({
          terms: [
            { module: ROOT, range: ROOT_VERSION, positive: true },
            { module: entry.name, range, positive: false },
          ],
          cause: { type: 'root', requirement },
        });
      });

      this.rememberState(state);

      const result = await this.search(state);

      if (!result.ok) throw this.toError(result.conflict);

      this.resolution = this.makeResolution(result.state);

      return this.resolution;
    } catch (error) {
      this.resolution = this.makeResolution(this.partialState, true);

      throw error;
    }
  };

  public getResolution = (): TPubGrubResult => this.resolution;

  private rememberState = (state: ISolverState): void => {
    if (
      this.partialState
      && this.partialState.selected.size > state.selected.size
    ) return;

    this.partialState = cloneState(state);
  };

  private makeResolution = (
    state: ISolverState | null,
    includeUnselected = false,
  ): TPubGrubResult => Object.fromEntries(
    [...this.entries].flatMap(([name, entry]) => {
      let version = state?.selected.get(name) || '';

      if (!version && includeUnselected) {
        if (!state?.requirements.has(name)) return [];

        const ranges = (state?.requirements.get(name) || [])
          .filter(requirement => requirement.positive)
          .map(requirement => requirement.range);

        const versions = this.versionsOf(entry);

        version = versionUtil.latest(versions, ranges)
          || versionUtil.latest(versions);
      }

      if (!version) return [];

      return [[name, {
        ...entry,
        version,
        dependencies: { ...entry.versions[version] },
      }]];
    }),
  );

  private search = async (state: ISolverState): Promise<TSearchResult> => {
    this.rememberState(state);

    const propagatedConflict = this.propagate(state);

    this.rememberState(state);

    if (propagatedConflict) {
      this.learn(state, propagatedConflict);

      return { ok: false, conflict: propagatedConflict };
    }

    const unresolved = [...state.requirements]
      .filter(([name, requirements]) => (
        name !== ROOT
        && !state.selected.has(name)
        && requirements.some(requirement => requirement.positive)
      ))
      .map(([name]) => name);

    if (!unresolved.length) return { ok: true, state };

    const choices = unresolved.map(name => {
      const entry = this.entries.get(name)!;
      const requirements = state.requirements.get(name) || [];
      const versions = this.candidates(name, state);

      return { name, entry, requirements, versions };
    });

    choices.sort((a, b) => (
      a.versions.length - b.versions.length || a.name.localeCompare(b.name)
    ));

    const choice = choices[0];

    if (!choice.versions.length) {
      const conflict = this.versionConflict(
        choice.name,
        choice.requirements,
        this.versionsOf(choice.entry),
      );

      this.learn(state, conflict);

      return { ok: false, conflict };
    }

    let lastConflict: TConflict | undefined;

    for (const version of choice.versions) {
      const next = cloneState(state);

      next.selected.set(choice.name, version);
      this.rememberState(next);

      const dependencyConflict = await this.addDependencies(
        next,
        choice.entry,
        version,
      );

      this.rememberState(next);

      const result = dependencyConflict
        ? { ok: false as const, conflict: dependencyConflict }
        : await this.search(next);

      if (result.ok) return result;

      this.learn(next, result.conflict);
      lastConflict = result.conflict;

      /* Решение не участвовало в причине: откатываемся через этот уровень. */
      if (!result.conflict.packages.has(choice.name)) return result;
    }

    return {
      ok: false,
      conflict: lastConflict || this.versionConflict(
        choice.name,
        choice.requirements,
        this.versionsOf(choice.entry),
      ),
    };
  };

  /*
   * Unit propagation: если incompatibility почти удовлетворена, добавляем
   * отрицание единственного неопределённого term в partial solution.
   */
  private propagate = (state: ISolverState): TConflict | null => {
    let changed = true;

    while (changed) {
      changed = false;

      for (const incompatibility of this.incompatibilities) {
        const relations = incompatibility.terms.map(term => (
          this.relation(term, state)
        ));

        if (relations.includes('contradicted')) continue;

        const inconclusive = relations
          .map((relation, index) => ({ relation, index }))
          .filter(({ relation }) => relation === 'inconclusive');

        if (!inconclusive.length) {
          return this.conflictFrom(incompatibility, state);
        }

        if (inconclusive.length !== 1) continue;

        const term = incompatibility.terms[inconclusive[0].index];

        const requirement = this.derivedRequirement(
          term,
          incompatibility,
        );

        changed = this.addRequirement(
          state,
          term.module,
          requirement,
        ) || changed;
      }

      const selectedConflict = this.findSelectedConflict(state);

      if (selectedConflict) return selectedConflict;
    }

    return null;
  };

  private relation = (term: ITerm, state: ISolverState): TTermState => {
    const selected = state.selected.get(term.module);

    if (selected) {
      const matches = versionUtil.satisfies(selected, term.range);
      const satisfied = term.positive ? matches : !matches;

      return satisfied ? 'satisfied' : 'contradicted';
    }

    const requirements = state.requirements.get(term.module) || [];

    if (!requirements.length) return 'inconclusive';

    const candidates = this.candidates(term.module, state);

    if (!candidates.length) return 'inconclusive';

    const matching = candidates.filter(version => (
      versionUtil.satisfies(version, term.range)
    ));

    if (term.positive) {
      if (matching.length === candidates.length) return 'satisfied';
      if (!matching.length) return 'contradicted';
    } else {
      if (!matching.length) return 'satisfied';
      if (matching.length === candidates.length) return 'contradicted';
    }

    return 'inconclusive';
  };

  private candidates = (name: string, state: ISolverState): string[] => {
    const entry = this.entries.get(name);
    const versions = entry ? this.versionsOf(entry) : [];
    const requirements = state.requirements.get(name) || [];

    return versionUtil.sort(versions).filter(version => (
      requirements.every(requirement => {
        const matches = versionUtil.satisfies(version, requirement.range);

        return requirement.positive ? matches : !matches;
      })
    ));
  };

  private versionsOf = (entry: IPackageEntry): string[] => {
    const cached = this.compatibleVersions.get(entry.name);

    if (cached) return cached;

    const versions = Object.keys(entry.versions).filter(version => (
      !this.isCandidateCompatible || this.isCandidateCompatible({
        name: entry.name,
        url: entry.url,
        version,
        packageJson: entry.manifests?.[version] ?? null,
      })
    ));

    this.compatibleVersions.set(entry.name, versions);

    return versions;
  };

  private addDependencies = async (
    state: ISolverState,
    entry: IPackageEntry,
    version: string,
  ): Promise<ICircularConflict | null> => {
    const dependencies = entry.versions[version] || {};
    const dependencyNames = Object.keys(dependencies);

    Object.entries(dependencies).forEach(([name, range]) => {
      this.assertConstraint(name, range, `${entry.name}@${version}`);
    });

    await Promise.all(dependencyNames.map(name => this.load(name)));
    state.edges.set(entry.name, dependencyNames);

    for (const [name, range] of Object.entries(dependencies)) {
      const path = findPath(state.edges, name, entry.name);

      if (path) {
        const chain = [entry.name, ...path];

        return {
          type: 'circular',
          name: entry.name,
          chain,
          packages: new Set(chain),
        };
      }

      const parentRequirement = [...(state.requirements.get(entry.name) || [])]
        .sort((a, b) => a.chain.length - b.chain.length)[0];

      const requirement = this.requirement(
        name,
        range,
        `${entry.name}@${version}`,
        [...(parentRequirement?.chain || [ROOT, entry.name]), name],
      );

      this.addIncompatibility({
        terms: [
          { module: entry.name, range: version, positive: true },
          { module: name, range, positive: false },
        ],
        cause: { type: 'dependency', requirement },
      });
    }

    return null;
  };

  private load = async (depPath: string): Promise<IPackageEntry> => {
    const known = this.entries.get(depPath);

    if (known) return known;

    const entry = await this.source.fetch(depPath);
    const duplicate = this.entries.get(entry.name);

    if (duplicate && duplicate.url !== entry.url) {
      throw new SVError('ADDON_NOT_FOUND', {
        name: entry.name,
        urls: [duplicate.url, entry.url],
      });
    }

    this.entries.set(entry.name, entry);

    return entry;
  };

  private addIncompatibility = (incompatibility: IIncompatibility): void => {
    const key = incompatibility.terms
      .map(term => `${term.module}:${term.positive}:${term.range}`)
      .sort()
      .join('|');

    if (this.incompatibilityKeys.has(key)) return;

    this.incompatibilityKeys.add(key);
    this.incompatibilities.push(incompatibility);
  };

  private learn = (state: ISolverState, conflict: TConflict): void => {
    const terms = [...state.selected]
      .filter(([name]) => name !== ROOT && conflict.packages.has(name))
      .map(([module, range]) => ({ module, range, positive: true }));

    if (!terms.length) return;

    this.addIncompatibility({
      terms,
      cause: { type: 'learned', conflict },
    });
  };

  private conflictFrom = (
    incompatibility: IIncompatibility,
    state: ISolverState,
  ): TConflict => {
    if (incompatibility.cause.type === 'learned') {
      return incompatibility.cause.conflict;
    }

    const { requirement } = incompatibility.cause;
    const name = requirement.chain[requirement.chain.length - 1];

    this.addRequirement(state, name, requirement);

    return this.versionConflict(
      name,
      state.requirements.get(name) || [],
      this.entries.has(name) ? this.versionsOf(this.entries.get(name)!) : [],
    );
  };

  // eslint-disable-next-line class-methods-use-this
  private derivedRequirement = (
    term: ITerm,
    incompatibility: IIncompatibility,
  ): IRequirement => {
    if (incompatibility.cause.type !== 'learned') {
      const source = incompatibility.cause.requirement;

      return { ...source, positive: !term.positive };
    }

    return {
      range: term.range,
      positive: !term.positive,
      requiredBy: '<conflict>',
      chain: [ROOT, term.module],
    };
  };

  // eslint-disable-next-line class-methods-use-this
  private requirement = (
    name: string,
    range: string,
    requiredBy: string,
    chain: string[],
  ): IRequirement => ({
    range,
    positive: true,
    requiredBy,
    chain: chain[chain.length - 1] === name ? chain : [...chain, name],
  });

  // eslint-disable-next-line class-methods-use-this
  private addRequirement = (
    state: ISolverState,
    name: string,
    requirement: IRequirement,
  ): boolean => {
    const requirements = state.requirements.get(name) || [];

    const exists = requirements.some(current => (
      current.range === requirement.range
      && current.positive === requirement.positive
      && current.requiredBy === requirement.requiredBy
    ));

    if (exists) return false;

    requirements.push(requirement);
    state.requirements.set(name, requirements);

    return true;
  };

  private findSelectedConflict = (
    state: ISolverState,
  ): IVersionConflict | null => {
    for (const [name, version] of state.selected) {
      if (name === ROOT) continue;

      const requirements = state.requirements.get(name) || [];

      const valid = requirements.every(requirement => {
        const matches = versionUtil.satisfies(version, requirement.range);

        return requirement.positive ? matches : !matches;
      });

      if (valid) continue;

      return this.versionConflict(
        name,
        requirements,
        this.entries.has(name) ? this.versionsOf(this.entries.get(name)!) : [],
      );
    }

    return null;
  };

  // eslint-disable-next-line class-methods-use-this
  private versionConflict = (
    name: string,
    requirements: IRequirement[],
    versions: string[],
  ): IVersionConflict => ({
    type: 'version',
    name,
    requirements,
    versions: versionUtil.sort(versions),
    packages: new Set([
      name,
      ...requirements.flatMap(requirement => requirement.chain),
    ].filter(packageName => packageName !== ROOT)),
  });

  // eslint-disable-next-line class-methods-use-this
  private assertConstraint = (
    name: string,
    range: string,
    parent: string,
  ): void => {
    if (versionUtil.validate(range, true)) return;

    throw new SVError('UNKNOWN_VERSION', {
      name,
      parent,
      version: range,
    });
  };

  // eslint-disable-next-line class-methods-use-this
  private toError = (conflict: TConflict): SVError => {
    if (conflict.type === 'circular') {
      return new SVError('CIRCULAR_DEPENDENCY', {
        name: conflict.name,
        chain: conflict.chain,
      });
    }

    const parents = Object.fromEntries(
      conflict.requirements.map(requirement => [
        requirement.requiredBy,
        `${requirement.positive ? '' : 'not '}${requirement.range}`,
      ]),
    );

    const chain = [...conflict.requirements]
      .sort((a, b) => a.chain.length - b.chain.length)[0]?.chain;

    return new SVError('VERSION_CONFLICT', {
      name: conflict.name,
      parents,
      constraints: conflict.requirements,
      versions: conflict.versions,
      chain,
    });
  };
}

export const pubGrub = {
  resolve: (rootDependencies: TDependencies): Promise<TPubGrubResult> => (
    new PubGrub().resolve(rootDependencies)
  ),
};
