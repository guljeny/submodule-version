import { entryStore } from '../entryStore';
import { github } from '../github';

jest.mock('../github', () => ({
  github: {
    fetchVersions: jest.fn(),
  },
}));

const fetchVersionsMock = github.fetchVersions as jest.Mock;
const url = (name: string) => `git@git:repo/${name}.git`;

beforeEach(() => {
  entryStore.clear();
  jest.clearAllMocks();
});

describe('entryStore.fetch', () => {
  const singleModuleLoad
    = 'loads all tags of one module without fetching nested modules';

  const nestedName
    = 'resolves nested name through the URL learned from its parent';

  it(singleModuleLoad, async () => {
    fetchVersionsMock.mockResolvedValueOnce([
      {
        version: '1.0.0',
        pkg: { sv: { [url('B')]: '^1.0.0' } },
      },
      {
        version: '2.0.0',
        pkg: { sv: { [url('C')]: '^2.0.0' } },
      },
    ]);

    await expect(entryStore.fetch(url('A'))).resolves.toEqual({
      name: 'A',
      url: url('A'),
      versions: {
        '1.0.0': { B: '^1.0.0' },
        '2.0.0': { C: '^2.0.0' },
      },
    });

    expect(fetchVersionsMock).toHaveBeenCalledTimes(1);
    expect(fetchVersionsMock).toHaveBeenCalledWith(url('A'));
    expect(entryStore.urlOf('B')).toBe(url('B'));
    expect(entryStore.urlOf('C')).toBe(url('C'));
  });

  it(nestedName, async () => {
    fetchVersionsMock
      .mockResolvedValueOnce([{
        version: '1.0.0',
        pkg: { sv: { [url('B')]: '*' } },
      }])
      .mockResolvedValueOnce([{ version: '2.0.0', pkg: {} }]);

    await entryStore.fetch(url('A'));
    const result = await entryStore.fetch('B');

    expect(result.name).toBe('B');
    expect(fetchVersionsMock).toHaveBeenLastCalledWith(url('B'));
  });

  it('deduplicates concurrent and repeated requests', async () => {
    fetchVersionsMock.mockResolvedValue([{ version: '1.0.0', pkg: {} }]);

    const first = entryStore.fetch(url('A'));
    const second = entryStore.fetch(url('A'));

    expect(first).toBe(second);

    await Promise.all([first, second]);
    await entryStore.fetch('A');

    expect(fetchVersionsMock).toHaveBeenCalledTimes(1);
  });

  it('does not cache a failed request', async () => {
    fetchVersionsMock
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce([{ version: '1.0.0', pkg: {} }]);

    await expect(entryStore.fetch(url('A'))).rejects.toThrow('network');
    await expect(entryStore.fetch(url('A'))).resolves.toMatchObject({
      name: 'A',
    });

    expect(fetchVersionsMock).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed nested dependency URLs', async () => {
    fetchVersionsMock.mockResolvedValueOnce([{
      version: '1.0.0',
      pkg: { sv: { B: '*' } },
    }]);

    await expect(entryStore.fetch(url('A'))).rejects.toMatchObject({
      error: 'NOT_A_GIT_URL',
      details: { url: 'B' },
    });
  });
});
