import { SV } from '../sv';
import { PubGrub } from '../PubGrub';
import { git } from '../git';
import { npm } from '../npm';
import { pkgJSONManager } from '../pkgJSONManager';
import { readFile } from 'fs/promises';
import { SVError } from '../errors';
import { getResolutionPreference } from '../PubGrub/resolutionPreference';

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
        listVersions: jest.fn(async () => []),
        getRemote: jest.fn(async () => null),
        tagsAtHead: jest.fn(async () => []),
        listTags: jest.fn(async () => []),
        hasChanges: jest.fn(async () => false),
        hasUnpushedCommits: jest.fn(async () => false),
        ensureBranch: jest.fn(async () => undefined),
        createBranch: jest.fn(async () => undefined),
        isRemoteAhead: jest.fn(async () => false),
        pullRebaseAutostash: jest.fn(async () => undefined),
        commitAll: jest.fn(async () => undefined),
        addTag: jest.fn(async () => undefined),
        push: jest.fn(async () => undefined),
        init: jest.fn(async () => undefined),
        addRemote: jest.fn(async () => undefined),
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

/* Фасад managedGit делегирует в git.local — в тесте воспроизводим его
 * над замоканным local, сохраняя резолв module → modulesDir/<module>. */
jest.mock('../git/managed', () => {
  const path = jest.requireActual('path');
  const { RunOptions } = jest.requireActual('../runOptions');
  const { git: mockedGit } = jest.requireMock('../git');

  const moduleDir = (module?: string): string => (
    module ? path.join(RunOptions.modulesDir, module) : RunOptions.cwd
  );

  return {
    managedGit: {
      hasChanges: async (module?: string) => {
        const dir = moduleDir(module);

        if (await mockedGit.local.hasChanges(dir)) return true;

        return mockedGit.local.hasUnpushedCommits(dir);
      },
      hasUncommittedChanges: async (module?: string) => (
        mockedGit.local.hasChanges(moduleDir(module))
      ),
      getRemote: async (module?: string) => (
        mockedGit.local.getRemote(moduleDir(module))
      ),
      currentVersion: async (module: string) => (
        mockedGit.local.currentVersion(module)
      ),
      isRemoteAhead: async (module?: string) => {
        const dir = moduleDir(module);

        if (!await mockedGit.local.isGitRepo(dir)) return false;

        return mockedGit.local.isRemoteAhead(dir);
      },
      pullRebaseAutostash: async (module?: string) => (
        mockedGit.local.pullRebaseAutostash(moduleDir(module))
      ),
      isPublished: async (module?: string) => {
        const dir = moduleDir(module);

        if (!await mockedGit.local.isGitRepo(dir)) return false;

        return !!(await mockedGit.local.getRemote(dir));
      },
    },
  };
});

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

const resolved = (
  resolution: Record<string, unknown>,
  errors: SVError[] = [],
) => ({ resolution, errors });

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  PubGrubMock.mockImplementation(() => ({
    resolve: resolveMock,
  }));
  resolveMock.mockResolvedValue(resolved({}));
  readFileMock.mockRejectedValue(new Error('ENOENT'));
  localMock.isGitRepo.mockResolvedValue(true);
  localMock.currentVersion.mockResolvedValue(null);
  localMock.listVersions.mockResolvedValue([]);
  localMock.tagsAtHead.mockResolvedValue([]);
  localMock.listTags.mockResolvedValue([]);
  localMock.hasChanges.mockResolvedValue(false);
  localMock.hasUnpushedCommits.mockResolvedValue(false);
  localMock.isRemoteAhead.mockResolvedValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('SV.resolve validation', () => {
  it('fails before resolving when package.json is missing', async () => {
    readMock.mockResolvedValue(null);
    const sv = new SV('/project');

    await expect(sv.resolve()).rejects.toMatchObject({ error: 'NOT_A_NPM' });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('fails before resolving outside a git repository', async () => {
    readMock.mockResolvedValue({ sv: {} });
    localMock.isGitRepo.mockResolvedValue(false);
    const sv = new SV('/project');

    await expect(sv.resolve()).rejects.toMatchObject({
      error: 'NOT_A_GIT_REPO',
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('passes rootDeps to PubGrub and returns its result', async () => {
    const rootDeps = { 'git@git:repo/A.git': '^1.0.0' };

    const result = {
      A: entry('A', { '1.2.0': {} }, '1.2.0'),
    };

    readMock.mockResolvedValue({ sv: rootDeps });
    resolveMock.mockResolvedValue(resolved(result));

    const sv = new SV('/project');

    await expect(sv.resolve()).resolves.toEqual({
      resolution: result,
      errors: [],
    });

    expect(resolveMock).toHaveBeenCalledWith(rootDeps);
  });

  it('passes the candidate compatibility callback to PubGrub', async () => {
    const isCandidateCompatible = jest.fn(() => true);

    readMock.mockResolvedValue({ sv: {} });

    const sv = new SV('/project', undefined, { isCandidateCompatible });

    await sv.resolve();

    expect(PubGrubMock).toHaveBeenCalledWith(
      expect.anything(),
      isCandidateCompatible,
    );
  });

  it('creates a fresh PubGrub on every resolve', async () => {
    readMock.mockResolvedValue({ sv: {} });
    const sv = new SV('/project');

    await sv.resolve();
    await sv.resolve();

    expect(PubGrubMock).toHaveBeenCalledTimes(2);
  });

  it('adds the modules dir to package.json workspaces', async () => {
    readMock.mockResolvedValue({ sv: {} });

    const sv = new SV('/project');

    await sv.resolve();

    expect(writeMock).toHaveBeenCalledWith({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
  });

  it('keeps workspaces and respects a custom modules dir', async () => {
    readMock.mockResolvedValue({ sv: {}, workspaces: ['packages/*'] });

    const sv = new SV('/project', 'libs');

    await sv.resolve();

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

    const sv = new SV('/project');

    await sv.resolve();

    expect(writeMock).not.toHaveBeenCalled();
  });

  it('uses the recorded sv-dir when no dir is passed', async () => {
    readMock.mockResolvedValue({
      sv: { [url('A')]: '*' },
      workspaces: ['libs/*'],
      'sv-dir': 'libs',
    });
    resolveMock.mockResolvedValue(resolved({
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    }));

    const sv = new SV('/project');

    await sv.resolve();

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

    const sv = new SV('/project');

    await sv.resolve();

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
    resolveMock.mockResolvedValue(resolved({
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    }));

    const sv = new SV('/project');

    await sv.resolve();

    expect(npmInstallMock).toHaveBeenCalled();
  });

  it('skips npm install when nothing changed', async () => {
    readMock.mockResolvedValue({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });

    const sv = new SV('/project');

    await sv.resolve();

    expect(npmInstallMock).not.toHaveBeenCalled();
  });

  it('checks the tree without applying any project changes', async () => {
    const resolution = {
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    };

    readMock.mockResolvedValue({ sv: { [url('A')]: '*' } });
    resolveMock.mockResolvedValue(resolved(resolution));
    const sv = new SV('/project');

    await expect(sv.resolve(true)).resolves.toEqual({
      resolution,
      errors: [],
    });

    expect(writeMock).not.toHaveBeenCalled();
    expect(localMock.addSubmodule).not.toHaveBeenCalled();
    expect(localMock.checkout).not.toHaveBeenCalled();
    expect(localMock.rm).not.toHaveBeenCalled();
    expect(npmInstallMock).not.toHaveBeenCalled();
  });

  it('does not ask to apply resolution errors in check-only mode', async () => {
    const error = new SVError('VERSION_CONFLICT');
    const onError = jest.fn(async () => true);
    readMock.mockResolvedValue({ sv: { [url('A')]: '*' } });
    resolveMock.mockResolvedValue(resolved({}, [error]));
    const sv = new SV('/project', undefined, { onError });

    await expect(sv.resolve(true)).resolves.toEqual({
      resolution: {},
      errors: [error],
    });

    expect(onError).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
    expect(npmInstallMock).not.toHaveBeenCalled();
  });
});

describe('SV.git', () => {
  it('returns the installed module version', async () => {
    localMock.currentVersion.mockResolvedValue('1.2.3');
    const sv = new SV('/project', 'addons');

    await expect(sv.git.currentVersion('A')).resolves.toBe('1.2.3');

    expect(localMock.currentVersion).toHaveBeenCalledWith('A');
  });
});

describe('SV.resolve put', () => {
  it('installs a root module and writes the range', async () => {
    readMock.mockResolvedValue({ sv: {} });
    localMock.isGitRepo.mockImplementation(
      async (dir: string) => dir === '/project',
    );
    resolveMock.mockResolvedValue(resolved({
      B: entry('B', { '1.2.0': {} }, '1.2.0'),
    }));

    const sv = new SV('/project');

    await sv.resolve(url('B'), '^1.2.0');

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

  it('marks the current put as the preferred conflict fallback', async () => {
    readMock.mockResolvedValue({ sv: { [url('A')]: '*' } });
    resolveMock.mockImplementation(async dependencies => {
      expect(getResolutionPreference(dependencies)).toEqual({
        depPath: url('B'),
        name: 'B',
        range: '^2.0.0',
      });

      return resolved({
        A: entry('A', { '1.0.0': {} }, '1.0.0'),
        B: entry('B', { '2.0.0': {} }, '2.0.0'),
      });
    });

    const sv = new SV('/project');

    await sv.resolve(url('B'), '^2.0.0');
  });

  it('resolves through * and writes ^ with the highest selected version',
    async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue(resolved({
      B: entry('B', {
        '1.2.0': {},
        '1.5.5': {},
        '2.0.0': {},
      }, '2.0.0'),
    }));

    const sv = new SV('/project');

    await sv.resolve(url('B'));

    expect(resolveMock).toHaveBeenCalledWith({ [url('B')]: '*' });
    expect(writeMock).toHaveBeenCalledWith({
      sv: { [url('B')]: '^2.0.0' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
  });

  it('preserves an explicitly passed * range', async () => {
    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue(resolved({
      B: entry('B', { '2.0.0': {} }, '2.0.0'),
    }));

    const sv = new SV('/project');

    await sv.resolve(url('B'), '*');

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
    resolveMock
      .mockResolvedValueOnce(resolved({
        A: entry('A', { '1.0.0': {} }, '1.0.0'),
      }))
      .mockResolvedValueOnce(resolved({
        A: entry('A', {
          '1.0.0': { B: '*' },
        }, '1.0.0'),
        B: entry('B', { '1.4.2': {} }, '1.4.2'),
      }));

    const sv = new SV('/project');

    await sv.resolve();
    await sv.resolve(url('B'), 'A');

    /* rootDeps не меняются, диапазон пишется в package.json родителя */
    expect(resolveMock).toHaveBeenLastCalledWith({ [url('A')]: '*' });
    expect(writeMock).toHaveBeenCalledWith(
      {
        sv: { [url('A')]: '*', [url('B')]: '^1.4.2' },
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
    resolveMock.mockResolvedValue(resolved({
      B: entry('B', { '1.2.0': {} }, '1.2.0'),
    }));

    const sv = new SV('/project');

    /* url имени берётся из корневого package.json#sv */
    await sv.resolve('B', '^1.1.0');

    expect(resolveMock).toHaveBeenCalledWith({ [url('B')]: '^1.1.0' });
    expect(writeMock).toHaveBeenCalledWith({
      sv: { [url('B')]: '^1.1.0' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
  });

  it('resolves an installed module name from the git remote', async () => {
    readMock.mockResolvedValue({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    localMock.getRemote.mockImplementation(async (dir: string) => (
      dir === 'modules/B' ? url('B') : null
    ));
    const sv = new SV('/project');

    await sv.resolve('B', '^2.0.0');

    expect(resolveMock).toHaveBeenCalledWith({ [url('B')]: '^2.0.0' });
    expect(writeMock).toHaveBeenCalledWith({
      sv: { [url('B')]: '^2.0.0' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
  });

  it('rejects a name that is not an installed module', async () => {
    readMock.mockResolvedValue({ sv: {} });
    const sv = new SV('/project');

    await expect(sv.resolve('Ghost')).rejects.toMatchObject({
      error: 'NOT_A_GIT_URL',
      details: { url: 'Ghost' },
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('rejects put into a parent that is not installed', async () => {
    readMock.mockImplementation(async (module?: string) => (
      module ? null : { sv: {} }
    ));
    const sv = new SV('/project');

    await expect(sv.resolve(url('B'), 'Nope')).rejects.toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'Nope' },
    });
    expect(writeMock).not.toHaveBeenCalled();
    expect(localMock.addSubmodule).not.toHaveBeenCalled();
    expect(npmInstallMock).not.toHaveBeenCalled();
  });

  it('propagates an npm install failure', async () => {
    const result = {
      B: entry('B', { '1.0.0': {} }, '1.0.0'),
    };

    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue(resolved(result));
    npmInstallMock.mockRejectedValueOnce(
      new SVError('NPM_INSTALL_FAILED'),
    );

    const sv = new SV('/project');

    await expect(sv.resolve(url('B'))).rejects.toMatchObject({
      error: 'NPM_INSTALL_FAILED',
      /* Мутация package.json/modules уже применена — post-mutation
       * resolution передаётся в details ошибки. */
      details: { resolution: result },
    });
  });
});

describe('SV.resolve errors', () => {
  it('applies nothing on resolution errors without onError', async () => {
    const conflict = new SVError('VERSION_CONFLICT');

    const partial = {
      B: entry('B', { '1.0.0': {} }, '1.0.0'),
    };

    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue(resolved(partial, [conflict]));
    const sv = new SV('/project');
    const result = await sv.resolve(url('B'), '^1.0.0');

    expect(result).toEqual({ resolution: partial, errors: [conflict] });
    expect(writeMock).not.toHaveBeenCalled();
    expect(localMock.addSubmodule).not.toHaveBeenCalled();
    expect(npmInstallMock).not.toHaveBeenCalled();
  });

  it('applies the mutation when onError allows every error', async () => {
    const conflict = new SVError('VERSION_CONFLICT');

    const partial = {
      B: entry('B', { '1.0.0': {} }, '1.0.0'),
    };

    readMock.mockResolvedValue({ sv: {} });
    localMock.isGitRepo.mockImplementation(
      async (dir: string) => dir === '/project',
    );
    resolveMock.mockResolvedValue(resolved(partial, [conflict]));
    const onError = jest.fn(async () => true);
    const sv = new SV('/project', undefined, { onError });
    const result = await sv.resolve(url('B'), '^1.0.0');

    expect(onError).toHaveBeenCalledWith(conflict);
    expect(result).toEqual({ resolution: partial, errors: [conflict] });
    expect(writeMock).toHaveBeenCalledWith({
      sv: { [url('B')]: '^1.0.0' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    expect(localMock.addSubmodule).toHaveBeenCalledWith(url('B'));
    expect(localMock.checkout).toHaveBeenCalledWith('B', '1.0.0');
    expect(npmInstallMock).toHaveBeenCalled();
  });

  it('asks onError for each error until one declines', async () => {
    const first = new SVError('ADDON_NOT_FOUND');
    const second = new SVError('VERSION_CONFLICT');

    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue(resolved({}, [first, second]));

    const onError = jest.fn()
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

    const sv = new SV('/project', undefined, { onError });

    await sv.resolve(url('B'));

    expect(onError).toHaveBeenCalledTimes(2);
    expect(writeMock).not.toHaveBeenCalled();
    expect(npmInstallMock).not.toHaveBeenCalled();
  });

  it('blocks the mutation when onError declines', async () => {
    const conflict = new SVError('VERSION_CONFLICT');

    readMock.mockResolvedValue({ sv: {} });
    resolveMock.mockResolvedValue(resolved({}, [conflict]));
    const onError = jest.fn(async () => false);
    const sv = new SV('/project', undefined, { onError });

    await sv.resolve(url('B'));

    expect(writeMock).not.toHaveBeenCalled();
    expect(localMock.addSubmodule).not.toHaveBeenCalled();
    expect(npmInstallMock).not.toHaveBeenCalled();
  });

  it('does not remove modules missing from a forced partial resolution',
    async () => {
      const conflict = new SVError('VERSION_CONFLICT');

      readMock.mockResolvedValue({
        sv: { [url('A')]: '*' },
        workspaces: ['modules/*'],
        'sv-dir': 'modules',
      });
      readFileMock.mockResolvedValue([
        '[submodule "modules/A"]',
        '\tpath = modules/A',
      ].join('\n'));
      resolveMock.mockResolvedValue(resolved({}, [conflict]));

      const sv = new SV('/project', undefined, {
        onError: async () => true,
      });

      await sv.resolve(url('B'), '^2.0.0');

      /* partial-резолюция без A из .gitmodules — сносить его нельзя */
      expect(localMock.rm).not.toHaveBeenCalled();
      expect(writeMock).toHaveBeenCalledWith({
        sv: { [url('A')]: '*', [url('B')]: '^2.0.0' },
        workspaces: ['modules/*'],
        'sv-dir': 'modules',
      });
    });

  it('removes .gitmodules submodules missing from a clean resolution',
    async () => {
      readMock.mockResolvedValue({
        sv: { [url('A')]: '*' },
        workspaces: ['modules/*'],
        'sv-dir': 'modules',
      });
      readFileMock.mockResolvedValue([
        '[submodule "modules/A"]',
        '\tpath = modules/A',
        '[submodule "modules/B"]',
        '\tpath = modules/B',
      ].join('\n'));
      resolveMock.mockResolvedValue(resolved({
        A: entry('A', { '1.0.0': {} }, '1.0.0'),
      }));

      const sv = new SV('/project');

      await sv.resolve();

      expect(localMock.rm).toHaveBeenCalledWith('B');
      expect(localMock.rm).not.toHaveBeenCalledWith('A');
    });
});

describe('SV.resolve delete', () => {
  it('removes a root dependency and uninstalls its module', async () => {
    readMock.mockResolvedValue({
      sv: { [url('A')]: '*' },
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    readFileMock.mockResolvedValue([
      '[submodule "modules/A"]',
      '\tpath = modules/A',
    ].join('\n'));
    resolveMock
      .mockResolvedValueOnce(resolved({
        A: entry('A', { '1.0.0': {} }, '1.0.0'),
      }))
      .mockResolvedValue(resolved({}));

    const sv = new SV('/project');

    await sv.resolve();
    await sv.resolve('A', null);

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
    readMock.mockResolvedValue({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });

    const sv = new SV('/project');

    await expect(sv.resolve('Ghost', null)).rejects.toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'Ghost' },
    });
    expect(resolveMock).not.toHaveBeenCalled();
    expect(localMock.rm).not.toHaveBeenCalled();
  });

  it('removes a dependency from the parent package.json', async () => {
    readMock.mockImplementation(async (module?: string) => (
      module === 'A'
        ? { sv: { [url('B')]: '^1.0.0' } }
        : {
          sv: { [url('A')]: '*' },
          workspaces: ['modules/*'],
          'sv-dir': 'modules',
        }
    ));
    resolveMock.mockResolvedValue(resolved({
      A: entry('A', { '1.0.0': { B: '^1.0.0' } }, '1.0.0'),
    }));

    const sv = new SV('/project');

    await sv.resolve();
    await sv.resolve('B', null, 'A');

    expect(writeMock).toHaveBeenCalledWith({ sv: {} }, 'A');
  });

  it('rejects deleting a module the parent does not depend on', async () => {
    readMock.mockImplementation(async (module?: string) => (
      module === 'A'
        ? { sv: {} }
        : {
          sv: { [url('A')]: '*' },
          workspaces: ['modules/*'],
          'sv-dir': 'modules',
        }
    ));
    resolveMock.mockResolvedValue(resolved({
      A: entry('A', { '1.0.0': {} }, '1.0.0'),
    }));

    const sv = new SV('/project');

    await expect(sv.resolve('B', null, 'A')).rejects.toMatchObject({
      error: 'ADDON_NOT_FOUND',
      details: { name: 'B' },
    });
    expect(localMock.rm).not.toHaveBeenCalled();
  });

  it('keeps a shared module installed when removed from one parent',
    async () => {
      readMock.mockImplementation(async (module?: string) => (
        module === 'A'
          ? { sv: { [url('B')]: '^1.0.0' } }
          : {
            sv: { [url('A')]: '*', [url('B')]: '*' },
            workspaces: ['modules/*'],
            'sv-dir': 'modules',
          }
      ));

      const full = {
        A: entry('A', { '1.0.0': { B: '^1.0.0' } }, '1.0.0'),
        B: entry('B', { '1.0.0': {} }, '1.0.0'),
      };

      resolveMock
        .mockResolvedValueOnce(resolved(full))
        .mockResolvedValue(resolved(full));

      const sv = new SV('/project');

      await sv.resolve();
      await sv.resolve('B', null, 'A');

      /* B остался корневой зависимостью — сабмодуль не удаляется */
      expect(localMock.rm).not.toHaveBeenCalled();
      expect(writeMock).toHaveBeenCalledWith({ sv: {} }, 'A');
    });
});

describe('SV.git', () => {
  it('resolves a module name to its submodule directory', async () => {
    readMock.mockResolvedValue({
      sv: {},
      workspaces: ['modules/*'],
      'sv-dir': 'modules',
    });
    const sv = new SV('/project');

    await sv.git.hasChanges('A');

    expect(localMock.hasChanges).toHaveBeenCalledWith('modules/A');
    expect(localMock.hasUnpushedCommits).toHaveBeenCalledWith('modules/A');
  });

  it('uses the project root without a module', async () => {
    const sv = new SV('/project');

    await sv.git.getRemote();

    expect(localMock.getRemote).toHaveBeenCalledWith('/project');
  });
});

describe('SV.publish', () => {
  it(
    'publishes an old version on the next automatic patch branch',
    async () => {
    const versions = [
      '2.0.0',
      '1.0.2',
      '1.0.2-patch.1',
      '1.0.2-patch.3',
    ];

    localMock.getRemote.mockResolvedValue(url('A'));
    localMock.tagsAtHead.mockResolvedValue(['1.0.2']);
    localMock.listTags.mockResolvedValue(versions);
    localMock.hasChanges.mockResolvedValue(true);
    readMock.mockResolvedValue({ version: '1.0.2', sv: {} });
    const sv = new SV('/project');

    await expect(sv.publish({
      module: 'A',
      /* Старый релиз игнорирует выбранный bump. */
      bump: 'major',
      message: 'backport fix',
    })).resolves.toBe('1.0.2-patch.4');

    expect(localMock.createBranch).toHaveBeenCalledWith(
      'modules/A',
      '1.0.2-patch.4',
    );
    expect(localMock.ensureBranch).not.toHaveBeenCalled();
    expect(writeMock).toHaveBeenCalledWith({
      version: '1.0.2-patch.4',
      sv: {},
    }, 'A');
    expect(localMock.commitAll).toHaveBeenCalledWith(
      'modules/A',
      'backport fix',
    );
    expect(localMock.addTag).toHaveBeenCalledWith(
      'modules/A',
      '1.0.2-patch.4',
    );
    expect(localMock.push).toHaveBeenCalledWith(
      'modules/A',
      '1.0.2-patch.4',
    );
    },
  );

  it(
    'continues a patch line and commits the generated version',
    async () => {
    localMock.getRemote.mockResolvedValue(url('A'));
    localMock.tagsAtHead.mockResolvedValue(['1.0.2-patch.4']);
    localMock.listTags.mockResolvedValue([
      '2.0.0',
      '1.0.2',
      '1.0.2-patch.4',
    ]);
    localMock.hasChanges.mockResolvedValue(true);
    readMock.mockResolvedValue({ version: '1.0.2-patch.4' });
    const sv = new SV('/project');

    await expect(sv.publish({
      module: 'A',
      bump: 'release',
    })).resolves.toBe('1.0.2-patch.5');

    expect(localMock.createBranch).toHaveBeenCalledWith(
      'modules/A',
      '1.0.2-patch.5',
    );
    expect(writeMock).toHaveBeenCalledWith({
      version: '1.0.2-patch.5',
    }, 'A');
    expect(localMock.commitAll).toHaveBeenCalledWith(
      'modules/A',
      'Update',
    );
    },
  );
});
