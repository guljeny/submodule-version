import { execFileSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { SV } from '../sv';

const git = (cwd: string, args: string[]): string => execFileSync(
  'git',
  args,
  { cwd, encoding: 'utf8' },
).trim();

const writePackage = (dir: string, version: string): void => {
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    `${JSON.stringify({ name: 'fixture', version }, null, 2)}\n`,
  );
};

describe('SV.publish git integration', () => {
  it(
    'pushes an automatic patch.4 branch and tag from an old version',
    async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'sv-publish-'));
    const remote = path.join(fixture, 'remote.git');
    const project = path.join(fixture, 'project');

    try {
      fs.mkdirSync(project);
      git(fixture, ['init', '--bare', remote]);
      git(project, ['init', '-b', 'main']);
      git(project, ['config', 'user.name', 'SV Test']);
      git(project, ['config', 'user.email', 'sv@example.test']);
      git(project, ['remote', 'add', 'origin', remote]);

      writePackage(project, '1.0.2');
      git(project, ['add', 'package.json']);
      git(project, ['commit', '-m', 'version 1.0.2']);
      git(project, ['tag', '1.0.2']);
      git(project, ['tag', '1.0.2-patch.1']);
      git(project, ['tag', '1.0.2-patch.2']);
      git(project, ['tag', '1.0.2-patch.3']);

      writePackage(project, '2.0.0');
      git(project, ['add', 'package.json']);
      git(project, ['commit', '-m', 'version 2.0.0']);
      git(project, ['tag', '2.0.0']);
      git(project, ['push', '-u', 'origin', 'main']);
      git(project, ['push', 'origin', '--tags']);

      git(project, ['checkout', '--detach', '1.0.2']);
      fs.writeFileSync(path.join(project, 'fix.txt'), 'backport\n');

      const version = await new SV(project).publish({
        /* bump игнорируется, потому что HEAD находится на старом теге. */
        bump: 'major',
        message: 'backport fix',
      });

      expect(version).toBe('1.0.2-patch.4');
      expect(git(project, ['branch', '--show-current']))
        .toBe('1.0.2-patch.4');
      expect(git(project, ['tag', '--points-at', 'HEAD']))
        .toContain('1.0.2-patch.4');
      expect(JSON.parse(
        fs.readFileSync(path.join(project, 'package.json'), 'utf8'),
      ).version).toBe('1.0.2-patch.4');
      expect(git(project, [
        'ls-remote',
        '--heads',
        'origin',
        '1.0.2-patch.4',
      ])).toContain('refs/heads/1.0.2-patch.4');
      expect(git(project, [
        'ls-remote',
        '--tags',
        'origin',
        '1.0.2-patch.4',
      ])).toContain('refs/tags/1.0.2-patch.4');
    } finally {
      fs.rmSync(fixture, { recursive: true, force: true });
    }
    },
    20000,
  );
});
