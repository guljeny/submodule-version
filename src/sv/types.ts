import { TIsCandidateCompatible, TResolveError } from '../PubGrub';

export interface IResolveContext {
  explicitModulesDir?: string;
  isCandidateCompatible?: TIsCandidateCompatible;
  onError?: (error: TResolveError) => Promise<boolean>;
  checkOnly?: boolean;
}

export interface IPublishOptions {
  module?: string;
  repoUrl?: string;
  message?: string;
  bump: 'release' | 'minor' | 'major';
}
