import { handleBuildGraphError } from './handleBuildGraphError';
import { handleInstallError } from './handleInstallError';
import { handleGitError } from './handleGitError';

export const handleErrors = async (error: Error, gitUrl: string) => {
  await Promise.all([
    handleBuildGraphError(error),
    handleInstallError(error, gitUrl),
    handleGitError(error, gitUrl),
  ]);
};
