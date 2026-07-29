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

  if (errorMessage === 'GIT_REPO_URL_REQUIRED') {
    log.error('Module is not published yet - pass --repo-url for the first publish');
  }

  if (errorMessage === 'GIT_NOT_LATEST_VERSION') {
    log.error('Publish is only possible from the latest version');
  }

  if (errorMessage === 'GIT_SYNC_CONFLICT') {
    log.error('Sync with remote failed - resolve conflicts manually');
  }
};
