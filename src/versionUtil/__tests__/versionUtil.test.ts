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

  it('normalizes VersionPicker ranges', () => {
    expect(versionUtil.normalizeConstraint('1.2.4-*')).toBe('>=1.2.4');
    expect(versionUtil.normalizeConstraint('1.2.4-1.5.0'))
      .toBe('>=1.2.4 <1.5.0');
    expect(versionUtil.validate('1.2.4-*', true)).toBe(true);
    expect(versionUtil.validate('1.2.4-1.5.0', true)).toBe(true);
    expect(versionUtil.validate('1.2.4-1.2.4', true)).toBe(true);
    expect(versionUtil.validate('1.5.0-1.2.4', true)).toBe(false);
  });

  it('resolves VersionPicker major and bounded ranges', () => {
    expect(versionUtil.satisfies('8.0.0', '1.2.4-*')).toBe(true);
    expect(versionUtil.satisfies('1.2.4', '1.2.4-1.2.4')).toBe(false);
    expect(versionUtil.satisfies('1.5.0', '1.2.4-1.5.0')).toBe(false);
    expect(versionUtil.satisfies('1.5.1', '1.2.4-1.5.0')).toBe(false);
  });

  it.each([
    ['1.2.5', true],
    ['1.2.8', true],
    ['1.3.0', true],
    ['1.5.5', true],
    ['2.0.0', false],
  ])('matches %s against ^1.2.5: %s', (version, expected) => {
    expect(versionUtil.satisfies(version, '^1.2.5')).toBe(expected);
  });

  it.each([
    ['1.2.3', true],
    ['1.2.6', true],
    ['1.3.0', false],
    ['2.0.0', false],
  ])('matches %s against ~1.2.3: %s', (version, expected) => {
    expect(versionUtil.satisfies(version, '~1.2.3')).toBe(expected);
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

  it('increments the patch branch suffix for a non-latest release', () => {
    expect(versionUtil.nextPatchVersion('1.0.2', [
      '2.0.0',
      '1.0.2-patch.1',
      '1.0.2-patch.3',
      '1.0.1-patch.9',
    ])).toBe('1.0.2-patch.4');
  });

  it('continues the same patch line from a patch tag', () => {
    expect(versionUtil.nextPatchVersion('1.0.2-patch.4', [
      '2.0.0',
      '1.0.2-patch.4',
    ])).toBe('1.0.2-patch.5');
  });
});
