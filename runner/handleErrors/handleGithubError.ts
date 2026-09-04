import { GithubError } from '../../src';
import { log } from '../log';

export const handleGithubError = (error: Error) => {
  if (!(error instanceof GithubError)) return;

  const { message, details } = error;

  if (message === 'GITHUB_NOT_A_REPO_URL') {
    log.error(`Not a GitHub repo url: ${details.url}`);

    return;
  }

  if (message === 'GITHUB_TOKEN_REQUIRED') {
    log.error(
      'GitHub GraphQL API requires a token: set GITHUB_TOKEN'
      + ' or pass { githubToken } to new SV()',
    );

    return;
  }

  if (message === 'GITHUB_API_FAILED') {
    const hints: Record<number, string> = {
      404: 'repo not found or private (set GITHUB_TOKEN)',
      403: 'rate limit or forbidden (set GITHUB_TOKEN)',
    };

    const hint = hints[details.status as number];
    const target = details.url ? ` for ${details.url}` : '';

    const errors = Array.isArray(details.errors)
      ? `: ${(details.errors as string[]).join('; ')}`
      : '';

    log.error(
      `GitHub API failed (${details.status})${target}${errors}`
      + (hint ? `: ${hint}` : ''),
    );
  }
};
