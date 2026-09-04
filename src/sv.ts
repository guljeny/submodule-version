import path from 'path';
import { pkgJSONManager } from './pkgJSONManager';
import { pubGrub, TDependencies, TPubGrubResult } from './PubGrub';
import { github } from './github';
import { RunOptions } from './runOptions';
import { versionUtil } from './versionUtil';
import { git, GitError } from './git';
import { SVError } from './errors';

export class SV {
  private resolution: TPubGrubResult | null = null;

  constructor (
    projectDir: string,
    modulesDir: string = 'addons',
    options: { githubToken?: string } = {},
  ) {
    RunOptions.cwd = projectDir;
    RunOptions.modulesDir = modulesDir;
    github.setToken(options.githubToken);
  }

  public init = async (): Promise<void> => {
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) throw new SVError('NOT_A_NPM');

    if (!await git.isGitRepo(RunOptions.cwd)) {
      throw new SVError('NOT_A_GIT_REPO');
    }

    const rootDeps = (baseJson.sv || {}) as TDependencies;

    this.resolution = await pubGrub.resolve(rootDeps);

    // eslint-disable-next-line no-console
    console.log('R', JSON.stringify(this.resolution, null, 2));
  };

  public getResolution = (): TPubGrubResult => {
    if (!this.resolution) throw new SVError('NOT_INITIALIZED');

    return this.resolution;
  };

  public listVersions = (): Record<string, string[]> => Object.fromEntries(
    Object.entries(this.getResolution()).map(([name, entry]) => [
      name,
      versionUtil.sort(Object.keys(entry.versions)),
    ]),
  );

  /* Мутации будут переведены на повторный PubGrub-resolve отдельным этапом. */
  // eslint-disable-next-line class-methods-use-this
  public add = async (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    gitUrl: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    parentOrVersion?: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    version?: string,
  ): Promise<never> => {
    throw new SVError('NOT_IMPLEMENTED');
  };

  // eslint-disable-next-line class-methods-use-this
  public setVersion = async (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    entryPath: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    version?: string,
  ): Promise<never> => {
    throw new SVError('NOT_IMPLEMENTED');
  };

  // eslint-disable-next-line class-methods-use-this
  public remove = async (
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    entryPath: string,
  ): Promise<never> => {
    throw new SVError('NOT_IMPLEMENTED');
  };

  // eslint-disable-next-line class-methods-use-this
  public hasChanges = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (await git.hasChanges(dir)) return true;

    return git.hasUnpushedCommits(dir);
  };

  // eslint-disable-next-line class-methods-use-this
  public hasUncommittedChanges = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    return git.hasChanges(dir);
  };

  // eslint-disable-next-line class-methods-use-this
  public currentVersion = async (module?: string): Promise<string | null> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    const tags = await git.tagsAtHead(dir);

    return versionUtil.latest(tags) || null;
  };

  // eslint-disable-next-line class-methods-use-this
  public latestVersion = async (module?: string): Promise<string> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    const versions = await git.listTags(dir);

    return versionUtil.latest(versions) || '0.0.0';
  };

  // eslint-disable-next-line class-methods-use-this
  public getRemote = async (module?: string): Promise<string | null> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    return git.getRemote(dir);
  };

  public isPublished = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (!await git.isGitRepo(dir)) return false;

    return !!(await this.getRemote(module));
  };

  // eslint-disable-next-line class-methods-use-this
  public isRemoteAhead = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (!await git.isGitRepo(dir)) return false;

    return git.isRemoteAhead(dir);
  };

  // eslint-disable-next-line class-methods-use-this
  public pullRebaseAutostash = async (module?: string): Promise<void> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    return git.pullRebaseAutostash(dir);
  };

  public publish = async (opts: {
    module?: string,
    repoUrl?: string,
    message?: string,
    bump: 'release' | 'minor' | 'major',
  }): Promise<string> => {
    const { module, repoUrl, message, bump } = opts;

    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (!await this.isPublished(module)) {
      if (!repoUrl) throw new GitError('GIT_REPO_URL_REQUIRED');

      if (!await git.isGitRepo(dir)) await git.init(dir);

      await git.addRemote(dir, repoUrl);
    }

    const currentTag = await this.currentVersion(module);
    const latestKnown = await this.latestVersion(module);

    if (currentTag && latestKnown && currentTag !== latestKnown) {
      throw new GitError('GIT_NOT_LATEST_VERSION');
    }

    await git.ensureBranch(dir);

    if (await git.isRemoteAhead(dir)) await git.pullRebaseAutostash(dir);

    const dirty = await git.hasChanges(dir);
    const headTag = await this.currentVersion(module);

    if (!dirty && headTag) {
      await git.push(dir, headTag);

      return headTag;
    }

    const next = versionUtil.bump(await this.latestVersion(module), bump);
    const pkg = await pkgJSONManager.read(module);

    if (pkg) {
      pkg.version = next;
      await pkgJSONManager.write(pkg, module);
    }

    if (await git.hasChanges(dir)) {
      await git.commitAll(dir, message || 'Update');
    }

    await git.addTag(dir, next);
    await git.push(dir, next);

    return next;
  };
}
