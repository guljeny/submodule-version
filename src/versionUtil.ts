import semver from 'semver';

export type TVersionConstraint = string;

const normalizeConstraint = (constraint = '*'): string | null => {
  const value = constraint.trim();

  if (!value) return null;

  return semver.validRange(value);
};

const validate = (value: string, range = false): boolean => {
  const input = value.trim();

  if (!input) return false;

  if (range) return normalizeConstraint(input) !== null;

  return semver.valid(input) === input;
};

const compare = (a: string, b: string): number => semver.compare(a, b);

const satisfies = (version: string, constraint = '*'): boolean => {
  const range = normalizeConstraint(constraint);

  return range !== null && semver.satisfies(version, range);
};

const sort = (versions: string[]): string[] => (
  [...versions].filter(v => validate(v)).sort(semver.rcompare)
);

const select = (
  versions: string[],
  constraints: string[] = ['*'],
): string[] => sort(versions).filter(version => (
  constraints.every(constraint => satisfies(version, constraint))
));

const latest = (
  versions: string[],
  constraints: string[] = ['*'],
): string => select(versions, constraints)[0] || '';

const intersection = (...sets: string[][]): string[] => {
  if (!sets.length) return [];

  return sort(sets[0].filter(version => (
    sets.slice(1).every(set => set.includes(version))
  )));
};

const union = (...sets: string[][]): string[] => (
  sort([...new Set(sets.flat())])
);

const difference = (left: string[], right: string[]): string[] => {
  const excluded = new Set(right);

  return sort(left.filter(version => !excluded.has(version)));
};

const intersects = (left: string[], right: string[]): boolean => {
  const rightSet = new Set(right);

  return left.some(version => rightSet.has(version));
};

const isSubset = (subset: string[], superset: string[]): boolean => {
  const allowed = new Set(superset);

  return subset.every(version => allowed.has(version));
};

const bump = (
  version: string,
  kind: 'release' | 'minor' | 'major',
): string => {
  const release = kind === 'release' ? 'patch' : kind;
  const next = semver.inc(version, release);

  if (!next) throw new Error(`Invalid semantic version: ${version}`);

  return next;
};

export const versionUtil = {
  normalizeConstraint,
  validate,
  compare,
  satisfies,
  sort,
  select,
  latest,
  intersection,
  union,
  difference,
  intersects,
  isSubset,
  bump,
};
