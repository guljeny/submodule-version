import { entryStore } from '../entryStore';
import { git } from '../git';

jest.mock('../git', () => {
  const actual = jest.requireActual('../git');

  return {
    ...actual,
    git: {
      ...actual.git,
      api: { fetchVersions: jest.fn() },
    },
  };
});

const fetchVersionsMock = git.api.fetchVersions as jest.Mock;
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
      manifests: {
        '1.0.0': { sv: { [url('B')]: '^1.0.0' } },
        '2.0.0': { sv: { [url('C')]: '^2.0.0' } },
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

describe('entryStore.simulate', () => {
  it('rewrites parent versions inside the callback only', async () => {
    fetchVersionsMock.mockResolvedValue([{ version: '1.0.0', pkg: {} }]);

    const patched = await entryStore.simulate(
      [{ parent: 'A', add: url('B'), version: '^1.2.3' }],
      {},
      () => entryStore.fetch(url('A')),
    );

    expect(patched.versions['1.0.0']).toEqual({ B: '^1.2.3' });
    expect(entryStore.urlOf('B')).toBe(url('B'));

    /* после коллбэка оверрайдов нет, кэш остался сырым */
    const raw = await entryStore.fetch(url('A'));

    expect(raw.versions['1.0.0']).toEqual({});
    expect(fetchVersionsMock).toHaveBeenCalledTimes(1);
  });

  it('lets the solver fetch an overridden child by name', async () => {
    fetchVersionsMock.mockImplementation(async (moduleUrl: string) => (
      moduleUrl === url('B')
        ? [{ version: '2.0.0', pkg: {} }]
        : [{ version: '1.0.0', pkg: {} }]
    ));

    const child = await entryStore.simulate(
      [{ parent: 'A', add: url('B') }],
      {},
      async () => {
        await entryStore.fetch(url('A'));

        return entryStore.fetch('B');
      },
    );

    expect(child).toEqual({
      name: 'B',
      url: url('B'),
      versions: { '2.0.0': {} },
      manifests: { '2.0.0': {} },
    });
  });

  it('deletes a dependency from every parent version', async () => {
    fetchVersionsMock.mockResolvedValue([{
      version: '1.0.0',
      pkg: { sv: { [url('B')]: '^1.0.0' } },
    }]);

    const patched = await entryStore.simulate(
      [{ parent: 'A', delete: 'B' }],
      {},
      () => entryStore.fetch(url('A')),
    );

    expect(patched.versions['1.0.0']).toEqual({});

    const raw = await entryStore.fetch(url('A'));

    expect(raw.versions['1.0.0']).toEqual({ B: '^1.0.0' });
  });

  it('clears overrides when the callback throws', async () => {
    fetchVersionsMock.mockResolvedValue([{ version: '1.0.0', pkg: {} }]);

    await expect(entryStore.simulate(
      [{ parent: 'A', add: url('B') }],
      {},
      async () => {
        throw new Error('boom');
      },
    )).rejects.toThrow('boom');

    const raw = await entryStore.fetch(url('A'));

    expect(raw.versions['1.0.0']).toEqual({});
  });

  it('rejects an override with a malformed module url', async () => {
    fetchVersionsMock.mockResolvedValue([{ version: '1.0.0', pkg: {} }]);

    await expect(entryStore.simulate(
      [{ parent: 'A', add: 'not-a-url' }],
      {},
      () => entryStore.fetch(url('A')),
    )).rejects.toMatchObject({
      error: 'NOT_A_GIT_URL',
      details: { url: 'not-a-url' },
    });
  });

  it('passes root overrides as effective rootDeps', async () => {
    const seen = await entryStore.simulate(
      [{ add: url('B'), version: '^1.2.3' }],
      { [url('A')]: '*' },
      async rootDeps => rootDeps,
    );

    expect(seen).toEqual({ [url('A')]: '*', [url('B')]: '^1.2.3' });
  });

  it('defaults the version of a root override to *', async () => {
    const seen = await entryStore.simulate(
      [{ add: url('B') }],
      {},
      async rootDeps => rootDeps,
    );

    expect(seen).toEqual({ [url('B')]: '*' });
  });

  it('deletes a root dependency by module name', async () => {
    const seen = await entryStore.simulate(
      [{ delete: 'A' }],
      { [url('A')]: '*', [url('B')]: '^2.0.0' },
      async rootDeps => rootDeps,
    );

    expect(seen).toEqual({ [url('B')]: '^2.0.0' });
  });

  it('rejects a root delete of a module missing from rootDeps', async () => {
    const cb = jest.fn(async (rootDeps: Record<string, string>) => rootDeps);

    await expect(entryStore.simulate(
      [{ delete: 'Ghost' }],
      {},
      cb,
    )).rejects.toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'Ghost' },
    });
    expect(cb).not.toHaveBeenCalled();
  });
});
