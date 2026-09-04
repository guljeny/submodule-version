import { readFileSync } from 'fs';
import path from 'path';
import { ERR, SVError } from './errors';
import { GitError, GithubError } from './git';
import { RunOptions } from './runOptions';
import { versionUtil } from './versionUtil';

const ROOT = '<root>';

const asList = (value: unknown): string[] => (
  Array.isArray(value) ? value.map(String) : []
);

/* Имя проекта из корневого package.json для отображения вместо <root> */
const projectRootName = (): string => {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(RunOptions.cwd, 'package.json'), 'utf-8'),
    );

    return pkg.name || 'the project root';
  } catch {
    return 'the project root';
  }
};

const printVersionConflict = (
  details: Record<string, unknown>,
): string => {
  const parents = (details.parents || {}) as Record<string, string>;
  const versions = asList(details.versions);

  const constraints = (
    Array.isArray(details.constraints) ? details.constraints : []
  ) as Array<{
    range: string,
    positive: boolean,
    requiredBy: string,
  }>;

  /*
   * Ни одна доступная версия не подходит под одно из требований —
   * это не конфликт между родителями, а запрос несуществующей версии.
   */
  const unsatisfiable = constraints.find(requirement => (
    requirement.positive
    && !versions.some(version => (
      versionUtil.satisfies(version, requirement.range)
    ))
  ));

  if (unsatisfiable) {
    const from = unsatisfiable.requiredBy === ROOT
      ? projectRootName()
      : unsatisfiable.requiredBy;

    return `Package ${String(details.name)} does not contain a version`
      + ` matching ${unsatisfiable.range} required by ${from}`
      + `. Use one of [${versions.join(', ')}]`;
  }

  const chain = asList(details.chain)
    .map(name => (name === ROOT ? projectRootName() : name));

  const lines = [
    `Version conflict for ${String(details.name)}:`,
    ...Object.entries(parents).map(([parent, range]) => {
      const from = parent === ROOT ? projectRootName() : parent;

      return `  - ${range} required by ${from}`;
    }),
  ];

  if (chain.length) lines.push(`  chain: ${chain.join(' -> ')}`);

  if (versions.length) {
    lines.push(`  available versions: ${versions.join(', ')}`);
  }

  return lines.join('\n');
};

const printSVError = (error: SVError): string => {
  const { error: code, details } = error;

  switch (code) {
    case ERR.NOT_A_NPM:
      return 'Not an npm project (package.json not found)';
    case ERR.NOT_A_GIT_REPO:
      return 'Not a git repository';
    case ERR.NOT_A_GIT_URL:
      return `${String(details.url || '')} - is not a git url!`;
    case ERR.NOT_INITIALIZED:
      return 'SV is not initialized - call init() first';
    case ERR.NOT_IMPLEMENTED:
      return 'This command is not implemented yet';
    case ERR.PATH_NOT_FOUND:
      return `Path ${String(details.path)} is not found`;
    case ERR.ADDON_NOT_FOUND: {
      const urls = asList(details.urls);

      const suffix = urls.length
        ? ` (conflicting urls: ${urls.join(', ')})`
        : '';

      return `Module ${String(details.name)} is not found${suffix}`;
    }
    case ERR.REQUESTED_VERSION_NOT_EXISTS: {
      const versions = asList(details.versions).join(', ');

      return `Package ${String(details.name)} does not contain version`
        + ` ${String(details.requestedVersion)}. Use one of [${versions}]`;
    }
    case ERR.VERSION_CONFLICT:
      return printVersionConflict(details);
    case ERR.CIRCULAR_DEPENDENCY:
      return `Circular dependency: ${asList(details.chain).join(' -> ')}`;
    case ERR.UNKNOWN_VERSION:
      return `Unknown version ${String(details.version)}`
        + ` for ${String(details.name)} in ${String(details.parent)}`;
    case ERR.GIT_DIRTY_SWITCH_CONFLICT:
      return 'Checkout failed: uncommitted changes cannot be carried over'
        + ' - move them manually';
    case ERR.NPM_INSTALL_FAILED:
      return `npm install failed${details.reason
        ? `: ${String(details.reason)}`
        : ''}`;
    default:
      return code;
  }
};

const printGitError = (error: GitError): string => {
  const reason = error.details.reason
    ? `: ${String(error.details.reason)}`
    : '';

  switch (error.message) {
    case 'GIT_NOT_A_REPO':
      return 'Not a git repository';
    case 'GIT_SUBMODULE_ADD_FAILED':
      return `Failed to add submodule ${String(error.details.url)}${reason}`;
    case 'GIT_MODULE_CHECKOUT_FAILED':
      return `Checkout ${String(error.details.version || '')}`
        + ` failed${reason}`;
    case 'GIT_REPO_URL_REQUIRED':
      return 'Module is not published yet'
        + ' - pass --repo-url for the first publish';
    case 'GIT_NOT_LATEST_VERSION':
      return 'Publish is only possible from the latest version';
    case 'GIT_SYNC_CONFLICT':
      return 'Sync with remote failed - resolve conflicts manually';
    default:
      return error.message;
  }
};

const printGithubError = (error: GithubError): string => {
  const { message, details } = error;

  switch (message) {
    case 'GITHUB_NOT_A_REPO_URL':
      return `Not a GitHub repo url: ${String(details.url)}`;
    case 'GITHUB_TOKEN_REQUIRED':
      return 'GitHub GraphQL API requires a token: set GITHUB_TOKEN'
        + ' or pass { githubToken } to new SV()';
    case 'GITHUB_API_FAILED': {
      const hints: Record<number, string> = {
        404: 'repo not found or private (set GITHUB_TOKEN)',
        403: 'rate limit or forbidden (set GITHUB_TOKEN)',
      };

      const status = details.status as number;
      const hint = hints[status];
      const target = details.url ? ` for ${String(details.url)}` : '';
      const errors = asList(details.errors).join('; ');

      return `GitHub API failed (${status})${target}`
        + `${errors ? `: ${errors}` : ''}${hint ? `: ${hint}` : ''}`;
    }
    default:
      return message;
  }
};

/* Человекочитаемый текст ошибок SV/PubGrub, git-слоя и GitHub API */
export const printError = (error: Error): string => {
  if (error instanceof SVError) return printSVError(error);
  if (error instanceof GitError) return printGitError(error);
  if (error instanceof GithubError) return printGithubError(error);

  return `Unhandled error: ${error.message}`;
};
