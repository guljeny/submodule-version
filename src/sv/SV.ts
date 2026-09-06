import {
  TIsCandidateCompatible,
  TResolveError,
  TResolveResult,
} from '../PubGrub';
import { git } from '../git';
import { managedGit } from '../git/managed';
import { RunOptions } from '../runOptions';
import { publish } from './publish';
import { resolve } from './resolve';
import { DEFAULT_MODULES_DIR } from './modules';

export class SV {
  private explicitModulesDir?: string;

  private isCandidateCompatible?: TIsCandidateCompatible;

  private onError?: (error: TResolveError) => Promise<boolean>;

  constructor (
    projectDir: string,
    modulesDir?: string,
    options: {
      githubToken?: string,
      isCandidateCompatible?: TIsCandidateCompatible,
      /* true — продолжить мутацию несмотря на ошибки резолюции */
      onError?: (error: TResolveError) => Promise<boolean>,
    } = {},
  ) {
    RunOptions.cwd = projectDir;
    RunOptions.modulesDir = modulesDir || DEFAULT_MODULES_DIR;
    this.explicitModulesDir = modulesDir;
    this.isCandidateCompatible = options.isCandidateCompatible;
    this.onError = options.onError;
    git.api.setToken(options.githubToken);
  }

  /*
   * Git-операции с проектом и его сабмодулями — фасад из src/git:
   * module резолвится в каталог сабмодуля (modulesDir/<module>),
   * без module — корень проекта.
   */
  public readonly git = managedGit;

  public resolve = async (
    url?: string,
    versionOrParent?: string | null,
    parentName?: string,
  ): Promise<TResolveResult> => resolve(
    {
      explicitModulesDir: this.explicitModulesDir,
      isCandidateCompatible: this.isCandidateCompatible,
      onError: this.onError,
    },
    url,
    versionOrParent,
    parentName,
  );

  public publish = async (opts: {
    module?: string,
    repoUrl?: string,
    message?: string,
    bump: 'release' | 'minor' | 'major',
  }): Promise<string> => (
    publish(opts, this.git)
  );
}
