import { handleBuildGraphError } from './handleBuildGraphError';
import { handleInstallError } from './handleInstallError';

export const handleErrors = async (error: Error, gitUrl: string) => {
  await Promise.all([
    handleBuildGraphError(error),
    handleInstallError(error, gitUrl),
  ]);
};
