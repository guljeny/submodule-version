import { printError } from '../printError';
import { SVError } from '../errors';
import { GitError, GithubError } from '../git';
import { readFileSync } from 'fs';

jest.mock('fs', () => ({
  readFileSync: jest.fn(() => {
    throw new Error('ENOENT');
  }),
}));

const readFileSyncMock = readFileSync as jest.Mock;

beforeEach(() => {
  readFileSyncMock.mockImplementation(() => {
    throw new Error('ENOENT');
  });
});

describe('printError', () => {
  it('reports a requested version that does not exist', () => {
    const error = new SVError('VERSION_CONFLICT', {
      name: 'Medusa',
      parents: { '<root>': '^0.5.4' },
      constraints: [{ range: '^0.5.4', positive: true, requiredBy: '<root>' }],
      versions: ['0.5.2', '0.5.1'],
      chain: ['<root>', 'Medusa'],
    });

    expect(printError(error)).toBe(
      'Package Medusa does not contain a version matching ^0.5.4'
      + ' required by the project root. Use one of [0.5.2, 0.5.1]',
    );
  });
  it('formats a version conflict with parents, chain and versions', () => {
    const error = new SVError('VERSION_CONFLICT', {
      name: 'C',
      parents: { '<root>': '^1.3.2', 'B@1.2.0': 'not ^1.4.2' },
      chain: ['A', 'B', 'C'],
      versions: ['1.4.2', '1.3.2'],
    });

    expect(printError(error)).toBe([
      'Version conflict for C:',
      '  - ^1.3.2 required by the project root',
      '  - not ^1.4.2 required by B@1.2.0',
      '  chain: A -> B -> C',
      '  available versions: 1.4.2, 1.3.2',
    ].join('\n'));
  });

  it('shows the project name from package.json instead of <root>', () => {
    readFileSyncMock.mockReturnValue(JSON.stringify({ name: 'ewa' }));

    const error = new SVError('VERSION_CONFLICT', {
      name: 'Medusa',
      parents: { '<root>': '0.2.8' },
      chain: ['<root>', 'Medusa'],
    });

    expect(printError(error)).toBe([
      'Version conflict for Medusa:',
      '  - 0.2.8 required by ewa',
      '  chain: ewa -> Medusa',
    ].join('\n'));
  });

  it('formats a circular dependency chain', () => {
    const error = new SVError('CIRCULAR_DEPENDENCY', {
      name: 'A',
      chain: ['A', 'B', 'A'],
    });

    expect(printError(error)).toBe('Circular dependency: A -> B -> A');
  });

  it('formats an unknown version with module and parent', () => {
    const error = new SVError('UNKNOWN_VERSION', {
      name: 'B',
      parent: 'A@1.0.0',
      version: '^2.x',
    });

    expect(printError(error)).toBe('Unknown version ^2.x for B in A@1.0.0');
  });

  it('formats conflicting urls of a missing addon', () => {
    const error = new SVError('ADDON_NOT_FOUND', {
      name: 'B',
      urls: ['git@git:one/B.git', 'git@git:two/B.git'],
    });

    expect(printError(error)).toBe(
      'Module B is not found'
      + ' (conflicting urls: git@git:one/B.git, git@git:two/B.git)',
    );
  });

  it('formats a missing requested version with available versions', () => {
    const error = new SVError('REQUESTED_VERSION_NOT_EXISTS', {
      name: 'A',
      requestedVersion: '2.0.0',
      versions: ['1.2.0', '1.0.0'],
    });

    expect(printError(error)).toBe(
      'Package A does not contain version 2.0.0. Use one of [1.2.0, 1.0.0]',
    );
  });

  it('formats git layer errors', () => {
    expect(printError(new GitError('GIT_SYNC_CONFLICT'))).toBe(
      'Sync with remote failed - resolve conflicts manually',
    );
    expect(printError(new GitError('GIT_REPO_URL_REQUIRED'))).toBe(
      'Module is not published yet - pass --repo-url for the first publish',
    );
  });

  it('includes the real git stderr of a failed submodule add', () => {
    const error = new GitError('GIT_SUBMODULE_ADD_FAILED', {
      url: 'git@git:repo/B.git',
      reason: 'fatal: repository not found',
    });

    expect(printError(error)).toBe(
      'Failed to add submodule git@git:repo/B.git'
      + ': fatal: repository not found',
    );
  });

  it('formats GitHub API errors with a status hint', () => {
    const error = new GithubError('GITHUB_API_FAILED', {
      status: 404,
      url: 'org/repo',
      errors: ['NOT_FOUND'],
    });

    expect(printError(error)).toBe(
      'GitHub API failed (404) for org/repo: NOT_FOUND'
      + ': repo not found or private (set GITHUB_TOKEN)',
    );
  });

  it('falls back to the message of unhandled errors', () => {
    expect(printError(new Error('boom'))).toBe('Unhandled error: boom');
  });
});
