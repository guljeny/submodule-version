import { SV } from '../sv';
import { git } from '../git';
import { pkgJSONManager } from '../pkgJSONManager';
import { pubGrub } from '../PubGrub';

jest.mock('../git', () => ({
  git: {
    isGitRepo: jest.fn(async () => true),
  },
  GitError: class GitError extends Error {},
}));

jest.mock('../pkgJSONManager', () => ({
  pkgJSONManager: {
    read: jest.fn(async () => null),
  },
}));

jest.mock('../PubGrub', () => ({
  pubGrub: {
    resolve: jest.fn(async () => ({})),
  },
}));

const readMock = pkgJSONManager.read as jest.Mock;
const resolveMock = pubGrub.resolve as jest.Mock;
const isGitRepoMock = git.isGitRepo as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  isGitRepoMock.mockResolvedValue(true);
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
    isGitRepoMock.mockResolvedValue(false);
    const sv = new SV('/project');

    await expect(sv.init()).rejects.toMatchObject({
      error: 'NOT_A_GIT_REPO',
    });
    expect(resolveMock).not.toHaveBeenCalled();
  });

  it('passes rootDeps to PubGrub and stores its result', async () => {
    const rootDeps = { 'git@git:repo/A.git': '^1.0.0' };

    const result = {
      A: {
        name: 'A',
        url: 'git@git:repo/A.git',
        versions: { '1.2.0': {} },
        version: '1.2.0',
        dependencies: {},
      },
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
});
