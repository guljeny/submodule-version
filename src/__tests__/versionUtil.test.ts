import { versionUtil } from '../versionUtil';

describe('versionUtil: SemVer primitives', () => {
  it('validates exact versions and ranges separately', () => {
    expect(versionUtil.validate('1.2.3')).toBe(true);
    expect(versionUtil.validate('1.2.3-beta.1')).toBe(true);
    expect(versionUtil.validate('v1.2.3')).toBe(false);
    expect(versionUtil.validate('^1.2.3')).toBe(false);
    expect(versionUtil.validate('^1.2.3', true)).toBe(true);
    expect(versionUtil.validate('~1.2.3', true)).toBe(true);
    expect(versionUtil.validate('*', true)).toBe(true);
    expect(versionUtil.validate('', true)).toBe(false);
    expect(versionUtil.validate('not-a-range', true)).toBe(false);
  });

  it('uses standard caret semantics for zero versions', () => {
    expect(versionUtil.satisfies('1.9.0', '^1.2.3')).toBe(true);
    expect(versionUtil.satisfies('2.0.0', '^1.2.3')).toBe(false);
    expect(versionUtil.satisfies('0.2.9', '^0.2.3')).toBe(true);
    expect(versionUtil.satisfies('0.3.0', '^0.2.3')).toBe(false);
    expect(versionUtil.satisfies('0.0.3', '^0.0.3')).toBe(true);
    expect(versionUtil.satisfies('0.0.4', '^0.0.3')).toBe(false);
  });

  it('selects the highest version satisfying every constraint', () => {
    const versions = ['2.0.0', '1.4.2', '1.3.2', 'broken'];

    expect(versionUtil.sort(versions)).toEqual(['2.0.0', '1.4.2', '1.3.2']);
    expect(versionUtil.select(versions, ['^1.3.2', '^1.4.0']))
      .toEqual(['1.4.2']);
    expect(versionUtil.latest(versions, ['^1.0.0'])).toBe('1.4.2');
    expect(versionUtil.compare('1.2.0', '1.1.9')).toBeGreaterThan(0);
  });
});

describe('versionUtil: finite sets used by PubGrub', () => {
  const one = ['1.0.0', '1.2.0'];
  const two = ['1.2.0', '2.0.0'];

  it('intersects, joins and subtracts version sets', () => {
    expect(versionUtil.intersection(one, two)).toEqual(['1.2.0']);
    expect(versionUtil.union(one, two)).toEqual(['2.0.0', '1.2.0', '1.0.0']);
    expect(versionUtil.difference(one, two)).toEqual(['1.0.0']);
  });

  it('checks intersection and subset relations', () => {
    expect(versionUtil.intersects(one, two)).toBe(true);
    expect(versionUtil.intersects(['1.0.0'], ['2.0.0'])).toBe(false);
    expect(versionUtil.isSubset(['1.2.0'], one)).toBe(true);
    expect(versionUtil.isSubset(one, ['1.2.0'])).toBe(false);
  });
});

describe('versionUtil.bump', () => {
  it.each([
    ['release', '1.2.4'],
    ['minor', '1.3.0'],
    ['major', '2.0.0'],
  ] as const)('bumps %s', (kind, expected) => {
    expect(versionUtil.bump('1.2.3', kind)).toBe(expected);
  });
});
