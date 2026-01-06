import { GitError } from '../../src/git';
import { log } from '../log';

export const handleGitError = (error: Error) => {
  if (!(error instanceof GitError)) return;

  const { message: errorMessage } = error;

  if (errorMessage === 'GIT_NOT_A_REPO') {
    log.error('Is not a git repo');
  }

  if (errorMessage === 'GIT_MODULE_CHECKOUT_FAILED') {
    log.error('Checkout failded');
  }
};
