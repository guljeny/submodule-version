import { GitError, git } from '../git';
import { managedGit } from '../git/managed';
import { pkgJSONManager } from '../pkgJSONManager';
import { versionUtil } from '../versionUtil';
import { moduleDir } from './modules';
import { IPublishOptions } from './types';

const currentVersion = async (module?: string): Promise<string | null> => {
  const dir = moduleDir(module);
  const tags = await git.local.tagsAtHead(dir);

  return versionUtil.sort(tags)[0] || null;
};

export const publish = async (
  opts: IPublishOptions,
  gitFacade: typeof managedGit,
): Promise<string> => {
  const { module, repoUrl, message, bump } = opts;
  const dir = moduleDir(module);

  if (!await gitFacade.isPublished(module)) {
    if (!repoUrl) throw new GitError('GIT_REPO_URL_REQUIRED');

    if (!await git.local.isGitRepo(dir)) await git.local.init(dir);

    await git.local.addRemote(dir, repoUrl);
  }

  const versions = await git.local.listTags(dir);
  const currentTag = await currentVersion(module);
  const latestKnown = versionUtil.latest(versions) || '0.0.0';
  const fromOldVersion = !!currentTag && currentTag !== latestKnown;

  const next = fromOldVersion
    ? versionUtil.nextPatchVersion(currentTag, versions)
    : versionUtil.bump(latestKnown, bump);

  if (fromOldVersion) {
    /* Старую стабильную линию не смешиваем с основной веткой: имя ветки
     * совпадает с автоматически рассчитанной prerelease-версией. */
    await git.local.createBranch(dir, next);
  } else {
    await git.local.ensureBranch(dir);

    if (await git.local.isRemoteAhead(dir)) {
      await git.local.pullRebaseAutostash(dir);
    }

    const dirty = await git.local.hasChanges(dir);
    const headTag = await currentVersion(module);

    if (!dirty && headTag) {
      await git.local.push(dir, headTag);

      return headTag;
    }
  }

  const pkg = await pkgJSONManager.read(module);

  if (pkg) {
    pkg.version = next;
    await pkgJSONManager.write(pkg, module);
  }

  if (await git.local.hasChanges(dir)) {
    await git.local.commitAll(dir, message || 'Update');
  }

  await git.local.addTag(dir, next);
  await git.local.push(dir, next);

  return next;
};
