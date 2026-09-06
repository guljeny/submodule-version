import semver from 'semver';

export type TVersionConstraint = string;

/* VersionPicker хранит x.y.z-* для диапазона без верхней границы.
 * Ранний вариант picker'а мог записать x.y.z-a.b.c; читаем его как
 * стандартный диапазон с исключённой верхней границей. */
const normalizePickerConstraint = (
  value: string,
): string | null | undefined => {
  if (value.endsWith('-*')) {
    const version = value.slice(0, -2);

    return semver.valid(version) === version ? `>=${version}` : null;
  }

  for (let index = value.length - 1; index >= 0; index -= 1) {
    if (value[index] !== '-') continue;

    const from = value.slice(0, index);
    const to = value.slice(index + 1);
    if (semver.valid(from) !== from || semver.valid(to) !== to) continue;

    return semver.lte(from, to) ? `>=${from} <${to}` : null;
  }

  return undefined;
};

const normalizeConstraint = (constraint = '*'): string | null => {
  const value = constraint.trim();

  if (!value) return null;

  const pickerConstraint = normalizePickerConstraint(value);

  return pickerConstraint === undefined
    ? semver.validRange(value)
    : pickerConstraint;
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

/* Публикация с не последнего тега образует отдельную patch-линейку:
 * 1.0.2 -> 1.0.2-patch.1, затем автоматически .2, .3 и т.д. */
const nextPatchVersion = (version: string, versions: string[]): string => {
  const parsed = semver.parse(version);

  if (!parsed) throw new Error(`Invalid semantic version: ${version}`);

  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  const prefix = `${base}-patch.`;

  const numbers = versions.flatMap(candidate => {
    if (!candidate.startsWith(prefix)) return [];

    const value = candidate.slice(prefix.length);

    return /^\d+$/.test(value) ? [Number(value)] : [];
  });

  const next = (numbers.length ? Math.max(...numbers) : 0) + 1;

  return `${prefix}${next}`;
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
  nextPatchVersion,
};
