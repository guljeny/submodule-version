import { GitError } from '../../src/git';
import { GithubError, SVError } from '../../src';
import { handleSVError } from './handleSVError';
import { handleGitError } from './handleGitError';
import { handleGithubError } from './handleGithubError';
import { log } from '../log';

export const handleErrors = async (error: Error) => {
  handleSVError(error);
  handleGitError(error);
  handleGithubError(error);

  if (
    !(error instanceof SVError)
    && !(error instanceof GitError)
    && !(error instanceof GithubError)
  ) {
    log.error('unhandled error', error.message);
  }
};
