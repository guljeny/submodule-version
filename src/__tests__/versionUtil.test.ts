import { versionUtil } from '../versionUtil';

describe('Latest', () => {
  it('Single version', () => {
    const v = versionUtil.latest(['1.0.0']);

    expect(v).toBe('1.0.0');
  });

  it('Path versions', () => {
    const v = versionUtil.latest(['^1.0.0', '^1.0.1']);

    expect(v).toBe('1.0.1');
  });

  it('Minor versions', () => {
    const v = versionUtil.latest(['^1.1.0', '^1.0.23']);

    expect(v).toBe('1.1.0');
  });

  it('Major versions', () => {
    const v = versionUtil.latest(['^2.0.0', '^1.10.23']);

    expect(v).toBe('2.0.0');
  });
});

describe('Validate', () => {
  it('Pass', () => {
    expect(versionUtil.validate('')).toBe(false);
    expect(versionUtil.validate('123')).toBe(false);
    expect(versionUtil.validate('1.2.3')).toBe(true);
    expect(versionUtil.validate('1.2.3', true)).toBe(true);
    expect(versionUtil.validate('^1.2.3', true)).toBe(true);
    expect(versionUtil.validate('^1.2.3')).toBe(false);
    expect(versionUtil.validate('*')).toBe(false);
    expect(versionUtil.validate('*', true)).toBe(true);
  });
});

describe('Compare', () => {
  it('Major mode', () => {
    expect(versionUtil.compare([1, 2, 3], [1, 3, 4], 0)).toBe(true);
    expect(versionUtil.compare([1, 3, 3], [1, 2, 4], 0)).toBe(false);
    expect(versionUtil.compare([1, 2, 3], [1, 2, 4], 1)).toBe(true);
    expect(versionUtil.compare([1, 2, 4], [1, 2, 3], 1)).toBe(false);
  });

  it('Minor mode', () => {
    expect(versionUtil.compare([1, 2, 3], [1, 2, 4], 1)).toBe(true);
    expect(versionUtil.compare([1, 2, 4], [1, 2, 3], 1)).toBe(false);
  });

  it('Path mode', () => {
    expect(versionUtil.compare([1, 2, 3], [1, 2, 3], 2)).toBe(true);
    expect(versionUtil.compare([1, 2, 4], [1, 2, 3], 2)).toBe(false);
    expect(versionUtil.compare([1, 2, 3], [1, 2, 4], 2)).toBe(false);
  });
});
