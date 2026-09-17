import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { TPubGrubResult } from '../PubGrub';
import { local } from '../git/local';
import { RunOptions } from '../runOptions';
import { syncModules } from '../sv/modules';

const runGit = (cwd: string, args: string[]): string => (
  execFileSync('git', ['-C', cwd, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()
);

const makeRemote = (root: string, name: string): string => {
  const remote = path.join(root, `${name}.git`);

  fs.mkdirSync(remote);
  runGit(remote, ['init', '-q']);
  runGit(remote, ['config', 'user.email', 'integration@example.invalid']);
  runGit(remote, ['config', 'user.name', 'Integration']);
  runGit(remote, ['commit', '--allow-empty', '-qm', 'initial']);
  runGit(remote, ['tag', '1.0.0']);

  return path.relative(RunOptions.cwd, remote);
};

const resolved = (remotes: Record<string, string>): TPubGrubResult => (
  Object.fromEntries(Object.entries(remotes).map(([name, url]) => [name, {
    name,
    url,
    version: '1.0.0',
    versions: { '1.0.0': {} },
    dependencies: {},
    requestedVersion: { '<root>': '^1.0.0' },
  }]))
);

describe('module synchronization integration', () => {
  let root: string;
  let previousProtocol: string | undefined;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-modules-'));
    previousProtocol = process.env.GIT_ALLOW_PROTOCOL;
    process.env.GIT_ALLOW_PROTOCOL = 'file';

    const project = path.join(root, 'project');

    fs.mkdirSync(project);
    runGit(project, ['init', '-q']);
    runGit(project, ['config', 'user.email', 'integration@example.invalid']);
    runGit(project, ['config', 'user.name', 'Integration']);
    runGit(project, ['commit', '--allow-empty', '-qm', 'initial']);
    RunOptions.cwd = project;
    RunOptions.modulesDir = 'addons';
  });

  afterEach(() => {
    if (previousProtocol === undefined) {
      delete process.env.GIT_ALLOW_PROTOCOL;
    } else {
      process.env.GIT_ALLOW_PROTOCOL = previousProtocol;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('registers prepared modules and preserves commits above the selected tag',
    async () => {
      const resolution = resolved({
        A: makeRemote(root, 'A'),
        B: makeRemote(root, 'B'),
        C: makeRemote(root, 'C'),
      });

      await expect(syncModules(resolution, false)).resolves.toBe(true);

      const registered = runGit(RunOptions.cwd, ['submodule', 'status'])
        .split(/\r?\n/)
        .filter(Boolean);

      expect(registered).toHaveLength(3);

      const addonA = path.join(RunOptions.cwd, 'addons', 'A');

      runGit(addonA, ['config', 'user.email', 'integration@example.invalid']);
      runGit(addonA, ['config', 'user.name', 'Integration']);
      runGit(addonA, ['commit', '--allow-empty', '-qm', 'local change']);
      const localHead = runGit(addonA, ['rev-parse', 'HEAD']);

      await expect(local.currentVersion('A')).resolves.toBe('1.0.0');
      await expect(syncModules(resolution, false)).resolves.toBe(false);
      expect(runGit(addonA, ['rev-parse', 'HEAD'])).toBe(localHead);
    });

  it('retries registration while an external process holds index.lock',
    async () => {
      const remote = makeRemote(root, 'Locked');

      await local.prepareSubmodule(remote);

      const indexLock = path.join(RunOptions.cwd, '.git', 'index.lock');

      fs.writeFileSync(indexLock, '');
      const releaseLock = setTimeout(() => fs.unlinkSync(indexLock), 80);

      try {
        await local.addSubmodule(remote);
      } finally {
        clearTimeout(releaseLock);
        if (fs.existsSync(indexLock)) fs.unlinkSync(indexLock);
      }

      expect(await local.isSubmoduleRegistered('Locked')).toBe(true);
    });
});
