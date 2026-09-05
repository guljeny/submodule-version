import { SV } from '../sv';
import { PubGrub } from '../PubGrub';
import { git } from '../git';
import { npm } from '../npm';
import { pkgJSONManager } from '../pkgJSONManager';
import { readFile } from 'fs/promises';

jest.mock('../PubGrub', () => ({
  PubGrub: jest.fn(),
}));

jest.mock('fs/promises', () => ({
  readFile: jest.fn(),
}));

jest.mock('../git', () => {
  const actual = jest.requireActual('../git');

  return {
    GitError: class GitError extends Error {},
    git: {
      parseUrl: actual.git.parseUrl,
      local: {
        isGitRepo: jest.fn(async () => true),
        addSubmodule: jest.fn(async () => undefined),
        checkout: jest.fn(async () => undefined),
        rm: jest.fn(async () => undefined),
        currentVersion: jest.fn(async () => null),
        getRemote: jest.fn(async () => null),
      },
      api: {
        setToken: jest.fn(),
      },
    },
  };
});

jest.mock('../pkgJSONManager', () => ({
  pkgJSONManager: {
    read: jest.fn(async () => null),
    write: jest.fn(async () => undefined),
  },
}));

jest.mock('../npm', () => ({
  npm: {
    install: jest.fn(async () => undefined),
  },
}));

const PubGrubMock = PubGrub as unknown as jest.Mock;
const resolveMock = jest.fn();
const readMock = pkgJSONManager.read as jest.Mock;
const writeMock = pkgJSONManager.write as jest.Mock;
const readFileMock = readFile as jest.Mock;
const localMock = git.local as unknown as Record<string, jest.Mock>;
const npmInstallMock = npm.install as jest.Mock;
const url = (name: string) => `git@git:repo/${name}.git`;

const entry = (
  name: string,
  versions: Record<string, Record<string, string>>,
  version: string,
) => ({
  name,
  url: url(name),
  versions,
  version,
  dependencies: versions[version] || {},
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  PubGrubMock.mockImplementation(() => ({ resolve: resolveMock }));
  resolveMock.mockResolvedValue({});
  readFileMock.mockRejectedValue(new Error('ENOENT'));
  localMock.isGitRepo.mockResolvedValue(true);
  localMock.currentVersion.mockResolvedValue(null);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SV.init', () => {
  it('fails before resolving when package.json is missing', async () => {
    readMock.mockResolvedValue(null);
    const sv = new SV('/project');

    await expect(sv.init()).rejects.toMatchObject({ error: 'NOT_A_NPM' });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('fails before resolving outside a git repository', async () => {
    readMock.mockResolvedValue({ sv: {} });
    localMock.isGitRepo.mockResolvedValue(false);
    const sv = new SV('/project');

    await expect(sv.init()).rejects.toMatchObject({
      error: 'NOT_A_GIT_REPO',
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('passes rootDeps to PubGrub and stores its result', async () => {
    const rootDeps = { 'git@git:repo/A.git': '^1.0.0' };

    const result = {
      A: entry('A', { '1.2.0': {} }, '1.2.0'),
    };

    readMock.mockResolvedValue({ sv: rootDeps });
    resolveMock.mockResolvedValue(result);

    const sv = new SV('/project');

    await sv.init();

    expect(resolveMock).toHaveBeenCalledWith(rootDeps);
    expect(sv.getResolution()).toBe(result);
    expect(sv.listVersions()).toEqual({ A: ['1.2.0'] });
  });

  it('guards result before init', () => {
    expect(() => new SV('/project').getResolution()).toThrow(
      expect.objectContaining({ error: 'NOT_INITIALIZED' }),
    );
  });

  it('adds the modules dir to package.json workspaces', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.init();

    expect(writeMock).toHaveBeenCalledWith({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
  });

  it('keeps workspaces and respects a custom modules dir', async () => {
    readMock.mockResolvedValue({ sv: {}, workspaces: ['packages/*'] });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project', 'libs');

    await sv.init();

    expect(writeMock).toHaveBeenCalledWith({
      sv: {},
      workspaces: ['packages/*', 'libs/*'],
      'sv-dir': 'libs',
    });
  });

  it('skips the write when the workspace entry exists', async () => {
    readMock.mockResolvedValue({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.init();

    expect(writeMock).not.toHaveBeenCalled();
  });

  it('uses the recorded sv-dir when no dir is passed', async () => {
    readMock.mockResolvedValue({
      sv: { [url('A')]: '*' },
      workspaces: ['libs/*'],
      'sv-dir': 'libs',
    });
    resolveMock.mockResolvedValue({
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    });

    const sv = new SV('/project');

    await sv.init();

    expect(writeMock).not.toHaveBeenCalled();
    expect(localMock.isGitRepo).toHaveBeenCalledWith('libs/A');
  });

  it('derives the modules dir from existing .gitmodules', async () => {
    readFileMock.mockResolvedValue([
      '[submodule "addons/A"]',
      '\tpath = addons/A',
      '[submodule "addons/B"]',
      '\tpath = addons/B',
    ].join('\n'));
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.init();

    expect(writeMock).toHaveBeenCalledWith({
      sv: {},
      workspaces: ['addons/*'],
      'sv-dir': 'addons',
    });
  });

  it('runs npm install when modules change', async () => {
    readMock.mockResolvedValue({
      sv: { [url('A')]: '*' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    localMock.isGitRepo.mockImplementation(
      async (dir: string) => dir === '/project',
    );
    resolveMock.mockResolvedValue({
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    });

    const sv = new SV('/project');

    await sv.init();

    expect(npmInstallMock).toHaveBeenCalled();
  });

  it('skips npm install when nothing changed', async () => {
    readMock.mockResolvedValue({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.init();

    expect(npmInstallMock).not.toHaveBeenCalled();
  });
});

describe('SV.put', () => {
  it('installs a root module and writes the range', async () => {
    readMock.mockResolvedValue({ sv: {} });
    localMock.isGitRepo.mockResolvedValue(false);
    resolveMock.mockResolvedValue({
      B: entry('B', { '1.2.0': {} }, '1.2.0'),
    });

    const sv = new SV('/project');

    await sv.put(url('B'), '^1.2.0');

    expect(resolveMock).toHaveBeenCalledWith({ [url('B')]: '^1.2.0' });
    expect(writeMock).toHaveBeenCalledWith({
      sv: { [url('B')]: '^1.2.0' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    expect(localMock.addSubmodule).toHaveBeenCalledWith(url('B'));
    expect(localMock.checkout).toHaveBeenCalledWith('B', '1.2.0');
    expect(npmInstallMock).toHaveBeenCalled();
  });

  it('falls back to * when version is omitted', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.put(url('B'));

    expect(resolveMock).toHaveBeenCalledWith({ [url('B')]: '*' });
    expect(writeMock).toHaveBeenCalledWith({
      sv: { [url('B')]: '*' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
  });

  it('treats a non-version second argument as parent name', async () => {
    readMock.mockResolvedValue({
      sv: { [url('A')]: '*' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    resolveMock.mockResolvedValue({
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    });

    const sv = new SV('/project');

    await sv.init();
    await sv.put(url('B'), 'A');

    /* rootDeps не меняются, диапазон пишется в package.json родителя */
    expect(resolveMock).toHaveBeenLastCalledWith({ [url('A')]: '*' });
    expect(writeMock).toHaveBeenCalledWith(
      {
        sv: { [url('A')]: '*', [url('B')]: '*' },
        workspaces: ['modules/*'],
        'sv-dir': 'modules',
      },
      'A',
    );
  });

  it('accepts an installed module name instead of url', async () => {
    readMock.mockResolvedValue({
      sv: { [url('B')]: '*' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    resolveMock.mockResolvedValue({
      B: entry('B', { '1.2.0': {} }, '1.2.0'),
    });

    const sv = new SV('/project');

    await sv.init();
    await sv.put('B', '^1.1.0');

    expect(resolveMock).toHaveBeenLastCalledWith({ [url('B')]: '^1.1.0' });
    expect(writeMock).toHaveBeenCalledWith({
      sv: { [url('B')]: '^1.1.0' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
  });

  it('rejects a name that is not an installed module', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.init();

    await expect(sv.put('Ghost')).rejects.toMatchObject({
      error: 'NOT_A_GIT_URL',
      details: { url: 'Ghost' },
    });
  });

  it('rejects put into a parent that is not installed', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.init();
    writeMock.mockClear(); /* init пишет workspaces — интересует только put */

    await expect(sv.put(url('B'), 'Nope')).rejects.toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'Nope' },
    });
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('applies nothing when the check resolve fails', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockRejectedValue(new Error('version conflict'));

    const sv = new SV('/project');

    await expect(sv.put(url('B'), '^1.0.0')).rejects.toThrow(
      'version conflict',
    );
    expect(writeMock).not.toHaveBeenCalled();
    expect(localMock.addSubmodule).not.toHaveBeenCalled();
    expect(npmInstallMock).not.toHaveBeenCalled();
  });

  it('propagates an npm install failure', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue({});
    npmInstallMock.mockRejectedValueOnce(new Error('npm failed'));

    const sv = new SV('/project');

    await expect(sv.put(url('B'))).rejects.toThrow('npm failed');
  });

  it('delegates the verified mutation to dangerousPut', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue({});
    const sv = new SV('/project');

    const dangerousPut = jest.spyOn(sv, 'dangerousPut')
      .mockResolvedValue(undefined);

    await sv.put(url('B'), '^1.0.0');

    expect(dangerousPut).toHaveBeenCalledWith(
      url('B'),
      '^1.0.0',
      undefined,
    );
  });
});

describe('SV.dangerousPut', () => {
  it('adds and records a module without calling PubGrub', async () => {
    readMock.mockResolvedValue({ sv: {} });
    localMock.isGitRepo.mockResolvedValue(false);
    resolveMock.mockRejectedValue(new Error('version conflict'));
    const sv = new SV('/project');

    await sv.dangerousPut(url('B'), '^2.0.0');

    expect(resolveMock).not.toHaveBeenCalled();
    expect(localMock.addSubmodule).toHaveBeenCalledWith(url('B'));
    expect(localMock.checkout).not.toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledWith({
      sv: { [url('B')]: '^2.0.0' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    expect(npmInstallMock).toHaveBeenCalledTimes(1);
  });

  it('resolves an installed module name from package.json without init',
    async () => {
      readMock.mockResolvedValue({ sv: { [url('B')]: '^1.0.0' } });
      const sv = new SV('/project');

      await sv.dangerousPut('B', '^2.0.0');

      expect(writeMock).toHaveBeenCalledWith({
        sv: { [url('B')]: '^2.0.0' },
        workspaces: ['modules/*'],
        'sv-dir': 'modules',
      });
      expect(resolveMock).not.toHaveBeenCalled();
    });

  it('uses the recorded modules dir before touching git', async () => {
    readMock.mockResolvedValue({
      sv: {},
      workspaces: ['addons/*'],
      'sv-dir': 'addons',
    });
    const sv = new SV('/project');

    await sv.dangerousPut(url('B'));

    expect(localMock.isGitRepo).toHaveBeenCalledWith('addons/B');
  });
});

describe('SV.delete', () => {
  it('removes a root dependency and uninstalls its module', async () => {
    readMock.mockResolvedValue({
      sv: { [url('A')]: '*' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    resolveMock.mockResolvedValueOnce({
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.init();
    await sv.delete('A');

    expect(resolveMock).toHaveBeenLastCalledWith({});
    expect(writeMock).toHaveBeenCalledWith({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    expect(localMock.rm).toHaveBeenCalledWith('A');
    expect(npmInstallMock).toHaveBeenCalled();
  });

  it('rejects deleting a module missing from rootDeps', async () => {
    readMock.mockResolvedValue({ sv: {} });

    const sv = new SV('/project');

    await expect(sv.delete('Ghost')).rejects.toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'Ghost' },
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('removes a dependency from the parent package.json', async () => {
    readMock.mockImplementation(async (module?: string) => (
      module === 'A'
        ? { sv: { [url('B')]: '^1.0.0' } }
        : { sv: { [url('A')]: '*' } }
    ));
    resolveMock.mockResolvedValue({
      A: entry('A', { '1.0.0': { B: '^1.0.0' } }, '1.0.0'),
    });

    const sv = new SV('/project');

    await sv.init();
    await sv.delete('B', 'A');

    expect(writeMock).toHaveBeenCalledWith({ sv: {} }, 'A');
  });

  it('rejects deleting a module the parent does not depend on', async () => {
    readMock.mockResolvedValue({ sv: { [url('A')]: '*' } });
    resolveMock.mockResolvedValue({
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    });

    const sv = new SV('/project');

    await sv.init();

    await expect(sv.delete('B', 'A')).rejects.toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'B' },
    });
    /* resolve не вызывался повторно — только внутри init */
    expect(resolveMock).toHaveBeenCalledTimes(1);
  });

  it('delegates the verified mutation to dangerousDelete', async () => {
    readMock.mockResolvedValue({ sv: { [url('A')]: '*' } });
    resolveMock.mockResolvedValue({});
    const sv = new SV('/project');

    const dangerousDelete = jest.spyOn(sv, 'dangerousDelete')
      .mockResolvedValue(undefined);

    await sv.delete('A');

    expect(dangerousDelete).toHaveBeenCalledWith('A', undefined);
  });
});

describe('SV.dangerousDelete', () => {
  it('removes and records a module without calling PubGrub', async () => {
    readMock.mockResolvedValue({ sv: { [url('A')]: '*' } });
    resolveMock.mockRejectedValue(new Error('version conflict'));
    const sv = new SV('/project');

    await sv.dangerousDelete('A');

    expect(resolveMock).not.toHaveBeenCalled();
    expect(localMock.rm).toHaveBeenCalledWith('A');
    expect(writeMock).toHaveBeenCalledWith({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    expect(npmInstallMock).toHaveBeenCalledTimes(1);
  });

  it('does not touch git when the dependency is missing', async () => {
    readMock.mockResolvedValue({ sv: {} });
    const sv = new SV('/project');

    await expect(sv.dangerousDelete('Ghost')).rejects.toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'Ghost' },
    });
    expect(localMock.rm).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
    expect(npmInstallMock).not.toHaveBeenCalled();
  });
});

describe('SV.listVersions', () => {
  it('returns versions of one package by name', async () => {
    readMock.mockResolvedValue({ sv: { [url('A')]: '*' } });
    resolveMock.mockResolvedValue({
      A: entry('A', { '1.0.0': {}, '1.2.0': {} }, '1.2.0'),
    });

    const sv = new SV('/project');

    await sv.init();

    expect(sv.listVersions('A')).toEqual(['1.2.0', '1.0.0']);
  });

  it('rejects an unknown package name', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue({});

    const sv = new SV('/project');

    await sv.init();

    expect(() => sv.listVersions('Nope')).toThrow(
      expect.objectContaining({
        error: 'ADDON_NOT_FOUND',
        details: { name: 'Nope' },
      }),
    );
  });
});
