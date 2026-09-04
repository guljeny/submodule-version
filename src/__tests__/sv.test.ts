import { SV } from '../sv';
import { Graph, IGraphEntry } from '../graph';
import { git } from '../git';
import { pkgJSONManager } from '../pkgJSONManager';

jest.mock('../git', () => {
  const { parseGitUrl } = jest.requireActual('../git/parseGitUrl');
  const { GitError } = jest.requireActual('../git/GitError');

  return {
    git: {
      parseUrl: parseGitUrl,
      isGitRepo: jest.fn(async () => true),
      addSumbmodule: jest.fn(async () => {}),
      listVersions: jest.fn(async () => []),
      currentVersion: jest.fn(async () => null),
      checkout: jest.fn(async () => {}),
      rm: jest.fn(async () => {}),
      hasChanges: jest.fn(async () => false),
      hasUnpushedCommits: jest.fn(async () => false),
      readJSONAtRef: jest.fn(async () => null),
    },
    GitError,
  };
});

jest.mock('../pkgJSONManager', () => ({
  pkgJSONManager: {
    read: jest.fn(async () => null),
    write: jest.fn(async () => {}),
  },
}));

type TPkg = {
  name: string;
  version?: string;
  sv?: Record<string, string>;
};

const ROOT = '__root__';
const url = (name: string) => `git@git:repo/${name}.git`;

const gitMock = git as unknown as {
  isGitRepo: jest.Mock;
  addSumbmodule: jest.Mock;
  listVersions: jest.Mock;
  currentVersion: jest.Mock;
  checkout: jest.Mock;
  rm: jest.Mock;
  hasChanges: jest.Mock;
};

const readMock = pkgJSONManager.read as jest.Mock;
const writeMock = pkgJSONManager.write as jest.Mock;

const makeEntry = (partial: Partial<IGraphEntry>): IGraphEntry => ({
  name: 'A',
  versions: [],
  parents: {},
  used: [],
  allowedVersions: [],
  version: '',
  depsByVersion: {},
  ...partial,
});

const pkgC = (svDeps?: Record<string, string>): TPkg => ({
  name: 'C',
  version: '1.0.0',
  ...(svDeps ? { sv: svDeps } : {}),
});

let sv: SV;
let packages: Record<string, TPkg>;
let addedPackages: Record<string, TPkg>;
let tags: Record<string, string[]>;
let heads: Record<string, string | null>;
let writes: TPkg[];
let buildSpy: jest.SpyInstance;

const makeGraphFixture = (entries: Record<string, Partial<IGraphEntry>>) => {
  const graph = new Graph();
  graph.projectName = 'myProject';
  graph.entries = Object.fromEntries(
    Object.entries(entries).map(([name, partial]) => [
      name,
      makeEntry({ name, ...partial }),
    ]),
  );

  return graph;
};

beforeEach(() => {
  sv = new SV('/fake', 'addons');

  packages = {
    [ROOT]: { name: 'myProject', sv: { [url('A')]: '^1.0.0' } },
  };
  addedPackages = {};
  tags = {};
  heads = {};
  writes = [];

  jest.clearAllMocks();

  readMock.mockImplementation(async (name?: string) => (
    packages[name || ROOT] || null
  ));
  writeMock.mockImplementation(async (data: TPkg) => {
    writes.push(JSON.parse(JSON.stringify(data)));
  });
  gitMock.addSumbmodule.mockImplementation(async (u: string) => {
    const { name } = git.parseUrl(u);
    packages[name] = addedPackages[name];
  });
  gitMock.listVersions.mockImplementation(
    async (name: string) => tags[name] || [],
  );
  gitMock.currentVersion.mockImplementation(
    async (name: string) => heads[name] || null,
  );
  gitMock.isGitRepo.mockImplementation(async () => true);

  buildSpy = jest.spyOn(Graph, 'build').mockImplementation(
    async () => makeGraphFixture({
      A: {
        versions: ['1.0.0', '2.0.0'],
        parents: { myProject: '^1.0.0' },
        used: ['1.0.0'],
        version: '1.0.0',
      },
    }),
  );
});

afterEach(() => {
  buildSpy.mockRestore();
});

describe('init', () => {
  it('Нет package.json: NOT_A_NPM', async () => {
    packages = {};

    await expect(sv.init()).rejects.toMatchObject({ error: 'NOT_A_NPM' });
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('Не git-репозиторий: NOT_A_GIT_REPO', async () => {
    gitMock.isGitRepo.mockImplementationOnce(async () => false);

    await expect(sv.init()).rejects.toMatchObject({ error: 'NOT_A_GIT_REPO' });
    expect(buildSpy).not.toHaveBeenCalled();
  });

  it('Строит граф один раз', async () => {
    await sv.init();

    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(sv.listVersions()).toEqual({ A: ['1.0.0', '2.0.0'] });
  });
});

describe('NOT_INITIALIZED guard', () => {
  it('Graph-методы до init кидают NOT_INITIALIZED', async () => {
    expect(() => sv.listVersions()).toThrow(
      expect.objectContaining({ error: 'NOT_INITIALIZED' }),
    );
    await expect(sv.setVersion('A')).rejects.toMatchObject({
      error: 'NOT_INITIALIZED',
    });
    await expect(sv.add(url('C'))).rejects.toMatchObject({
      error: 'NOT_INITIALIZED',
    });
    await expect(sv.remove('A')).rejects.toMatchObject({
      error: 'NOT_INITIALIZED',
    });
  });
});

describe('add', () => {
  it('Новый аддон без sv: запись ^latest, узел в графе, checkout', async () => {
    addedPackages.C = pkgC();
    tags.C = ['1.0.0'];

    await sv.init();
    await sv.add(url('C'));

    expect(gitMock.addSumbmodule).toHaveBeenCalledWith(url('C'));
    expect(gitMock.checkout).toHaveBeenCalledWith('C', '1.0.0');
    expect(writes).toHaveLength(1);
    expect(writes[0].sv?.[url('C')]).toBe('^1.0.0');
    expect(sv.listVersions()).toEqual({
      A: ['1.0.0', '2.0.0'],
      C: ['1.0.0'],
    });
  });

  it('add(url, version): второй аргумент читаем как версию', async () => {
    addedPackages.C = { name: 'C', version: '1.2.0' };
    tags.C = ['1.0.0', '1.2.0'];

    await sv.init();
    await sv.add(url('C'), '1.2.0');

    expect(gitMock.checkout).toHaveBeenCalledWith('C', '1.2.0');
    expect(writes[0].sv?.[url('C')]).toBe('^1.2.0');
  });

  it('add(url, parentPath): пишем в package.json родителя', async () => {
    packages.A = { name: 'A', version: '1.0.0' };
    addedPackages.C = pkgC();
    tags.C = ['1.0.0'];

    await sv.init();
    await sv.add(url('C'), 'A');

    expect(writes).toHaveLength(1);
    expect(writes[0].name).toBe('A');
    expect(writes[0].sv?.[url('C')]).toBe('^1.0.0');
    expect(sv.getGraph().entries.C.parents).toEqual({ A: '^1.0.0' });
  });

  it('REQUESTED_VERSION_NOT_EXISTS: откат через git.rm', async () => {
    addedPackages.C = pkgC();
    tags.C = ['1.0.0'];

    await sv.init();

    await expect(sv.add(url('C'), '9.9.9')).rejects.toMatchObject({
      error: 'REQUESTED_VERSION_NOT_EXISTS',
      details: expect.objectContaining({ requestedVersion: '9.9.9' }),
    });

    expect(gitMock.rm).toHaveBeenCalledWith('C');
    expect(writes).toHaveLength(0);
  });

  it('Relax: ослабленный корень пишется ДО targetPkg', async () => {
    addedPackages.C = pkgC({ [url('A')]: '^2.0.0' });
    tags.C = ['1.0.0'];

    await sv.init();
    await sv.add(url('C'));

    expect(writes).toHaveLength(2);
    /* Первая запись — ослабленный корень без C, вторая — targetPkg с C */
    expect(writes[0].sv?.[url('A')]).toBe('^2.0.0');
    expect(writes[0].sv?.[url('C')]).toBeUndefined();
    expect(writes[1].sv?.[url('A')]).toBe('^2.0.0');
    expect(writes[1].sv?.[url('C')]).toBe('^1.0.0');
    /* Граф обновлён инкрементально, без перестроения */
    expect(buildSpy).toHaveBeenCalledTimes(1);
    expect(sv.getGraph().entries.A.parents).toEqual({
      myProject: '^2.0.0',
      C: '^2.0.0',
    });
    expect(sv.getGraph().entries.A.used).toEqual(['2.0.0']);
  });

  it('Pinned: PINNED_VERSION_CONFLICT, откат через git.rm', async () => {
    addedPackages.C = pkgC({ [url('A')]: '^2.0.0' });
    tags.C = ['1.0.0'];
    buildSpy.mockImplementation(async () => makeGraphFixture({
      A: {
        versions: ['1.0.0', '2.0.0'],
        parents: { myProject: '1.0.0' },
        used: ['1.0.0'],
        version: '1.0.0',
      },
    }));
    packages[ROOT] = { name: 'myProject', sv: { [url('A')]: '1.0.0' } };

    await sv.init();

    await expect(sv.add(url('C'))).rejects.toMatchObject({
      error: 'PINNED_VERSION_CONFLICT',
      details: expect.objectContaining({
        name: 'A',
        requiredBy: 'C',
        required: '^2.0.0',
        pinned: '1.0.0',
      }),
    });

    expect(gitMock.rm).toHaveBeenCalledWith('C');
    expect(writes).toHaveLength(0);
  });

  it('Pinned при существующем сабмодуле: git.rm НЕ вызван', async () => {
    packages.C = pkgC({ [url('A')]: '^2.0.0' });
    tags.C = ['1.0.0'];
    buildSpy.mockImplementation(async () => makeGraphFixture({
      A: {
        versions: ['1.0.0', '2.0.0'],
        parents: { myProject: '1.0.0' },
        used: ['1.0.0'],
        version: '1.0.0',
      },
    }));
    packages[ROOT] = { name: 'myProject', sv: { [url('A')]: '1.0.0' } };

    await sv.init();

    await expect(sv.add(url('C'))).rejects.toMatchObject({
      error: 'PINNED_VERSION_CONFLICT',
    });

    expect(gitMock.addSumbmodule).not.toHaveBeenCalled();
    expect(gitMock.rm).not.toHaveBeenCalled();
    expect(writes).toHaveLength(0);
  });

  it('Несуществующий parentPath: PATH_NOT_FOUND', async () => {
    await sv.init();

    await expect(sv.add(url('C'), 'X.Y')).rejects.toMatchObject({
      error: 'PATH_NOT_FOUND',
    });

    expect(gitMock.addSumbmodule).not.toHaveBeenCalled();
  });
});

describe('setVersion', () => {
  it('Явная версия: checkout + пин в package.json родителя', async () => {
    await sv.init();
    await sv.setVersion('A', '2.0.0');

    expect(gitMock.checkout).toHaveBeenCalledWith('A', '2.0.0');
    expect(writes).toHaveLength(1);
    expect(writes[0].sv?.[url('A')]).toBe('2.0.0');

    const entry = sv.getGraph().entries.A;
    expect(entry.version).toBe('2.0.0');
    expect(entry.parents).toEqual({ myProject: '2.0.0' });
    expect(entry.used).toEqual(['2.0.0']);
  });

  it('Без версии: последняя допустимая, constraint не трогаем', async () => {
    buildSpy.mockImplementation(async () => makeGraphFixture({
      A: {
        versions: ['1.0.0', '2.0.0'],
        parents: { myProject: '^1.0.0' },
        used: ['1.0.0', '2.0.0'],
        version: '1.0.0',
      },
    }));

    await sv.init();
    await sv.setVersion('A');

    expect(gitMock.checkout).toHaveBeenCalledWith('A', '2.0.0');
    expect(writeMock).not.toHaveBeenCalled();
    expect(sv.getGraph().entries.A.version).toBe('2.0.0');
  });

  it('Несовместимая версия: VERSION_CONFLICT, без checkout', async () => {
    buildSpy.mockImplementation(async () => makeGraphFixture({
      A: {
        versions: ['1.0.0', '2.0.0'],
        parents: { myProject: '^1.0.0', B: '^1.0.0' },
        used: ['1.0.0'],
        version: '1.0.0',
      },
    }));

    await sv.init();

    await expect(sv.setVersion('A', '2.0.0')).rejects.toMatchObject({
      error: 'VERSION_CONFLICT',
      details: expect.objectContaining({
        name: 'A',
        parents: { myProject: '2.0.0', B: '^1.0.0' },
      }),
    });

    expect(gitMock.checkout).not.toHaveBeenCalled();
    expect(writeMock).not.toHaveBeenCalled();
  });

  it('REQUESTED_VERSION_NOT_EXISTS: без checkout', async () => {
    await sv.init();

    await expect(sv.setVersion('A', '9.9.9')).rejects.toMatchObject({
      error: 'REQUESTED_VERSION_NOT_EXISTS',
    });

    expect(gitMock.checkout).not.toHaveBeenCalled();
  });

  it('Несуществующий path: PATH_NOT_FOUND', async () => {
    await sv.init();

    await expect(sv.setVersion('X', '1.0.0')).rejects.toMatchObject({
      error: 'PATH_NOT_FOUND',
    });
  });
});

describe('remove', () => {
  it('Единственный родитель: git.rm + узел снесён из графа', async () => {
    await sv.init();
    await sv.remove('A');

    expect(gitMock.rm).toHaveBeenCalledWith('A');
    expect(writes).toHaveLength(1);
    expect(writes[0].sv).toEqual({});
    expect(sv.getGraph().entries.A).toBeUndefined();
  });

  it('Несколько родителей: удаляется только edge', async () => {
    packages.A = { name: 'A', version: '1.0.0', sv: { [url('C')]: '^1.0.0' } };
    buildSpy.mockImplementation(async () => makeGraphFixture({
      A: {
        versions: ['1.0.0'],
        parents: { myProject: '^1.0.0' },
        used: ['1.0.0'],
        version: '1.0.0',
      },
      C: {
        versions: ['1.0.0', '1.2.0'],
        parents: { myProject: '^1.0.0', A: '^1.0.0' },
        used: ['1.0.0'],
        version: '1.0.0',
      },
    }));

    await sv.init();
    await sv.remove('A.C');

    expect(gitMock.rm).not.toHaveBeenCalled();
    expect(writes).toHaveLength(1);
    expect(writes[0].name).toBe('A');
    expect(writes[0].sv).toEqual({});
    expect(sv.getGraph().entries.C.parents).toEqual({ myProject: '^1.0.0' });
  });

  it('Несуществующий path: PATH_NOT_FOUND', async () => {
    await sv.init();

    await expect(sv.remove('X')).rejects.toMatchObject({
      error: 'PATH_NOT_FOUND',
    });

    expect(gitMock.rm).not.toHaveBeenCalled();
  });
});
