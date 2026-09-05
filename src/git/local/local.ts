import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { parseGitUrl } from '../parseGitUrl';
import { versionUtil } from '../../versionUtil';
import { RunOptions } from '../../runOptions';
import { GitError } from '../GitError';

const execAsync = promisify(exec);

/* stderr упавшей git-команды — единственный источник настоящей причины */
const stderrOf = (error: unknown): string => (
  (error as { stderr?: string })?.stderr || ''
).trim();

export const local = {
  addSubmodule: async (url: string): Promise<void> => {
    const { name } = parseGitUrl(url);
    const module = path.join(RunOptions.modulesDir, name);

    try {
      await execAsync(
        `git submodule add "${url}" "${module}"`,
        { cwd: RunOptions.cwd },
      );
    } catch (error) {
      throw new GitError('GIT_SUBMODULE_ADD_FAILED', {
        url,
        reason: stderrOf(error),
      });
    }
  },

  checkout: async (name: string, version: string): Promise<void> => {
    const module = path.join(RunOptions.modulesDir, name);

    try {
      await execAsync(
        `git -C "${module}" checkout ${version} -q`,
        { cwd: RunOptions.cwd },
      );
    } catch (error) {
      throw new GitError('GIT_MODULE_CHECKOUT_FAILED', {
        name,
        version,
        reason: stderrOf(error),
      });
    }
  },

  listVersions: async (projectName: string): Promise<string[]> => {
    const module = path.join(RunOptions.modulesDir, projectName);

    return local.listTags(module);
  },

  status: async (dir: string): Promise<string> => {
    const res = await execAsync(
      `git -C "${dir}" status --porcelain`,
      { cwd: RunOptions.cwd },
    );

    return res.stdout.toString();
  },

  hasChanges: async (dir: string): Promise<boolean> => {
    const status = await local.status(dir);

    return status.trim().length > 0;
  },

  hasUnpushedCommits: async (dir: string): Promise<boolean> => {
    await local.fetch(dir);

    const branch = await local.currentBranch(dir);

    if (branch) {
      let upstream: string | null = null;

      try {
        const res = await execAsync(
          `git -C "${dir}" rev-parse --abbrev-ref --symbolic-full-name @{u}`,
          { cwd: RunOptions.cwd },
        );

        upstream = res.stdout.toString().trim() || null;
      } catch {
        upstream = null;
      }

      if (!upstream) {
        try {
          await execAsync(
            `git -C "${dir}" rev-parse --verify --quiet origin/${branch}`,
            { cwd: RunOptions.cwd },
          );
          upstream = `origin/${branch}`;
        } catch {
          upstream = null;
        }
      }

      /* Ветки на remote нет — всё локальное не опубликовано */
      if (!upstream) return true;

      const res = await execAsync(
        `git -C "${dir}" rev-list ${upstream}..HEAD --count`,
        { cwd: RunOptions.cwd },
      );

      return Number(res.stdout.toString().trim()) > 0;
    }

    /*
     * Detached HEAD (checkout на тег): локальные теги не доказывают публикацию
     * (могут быть не запушены) — сверяем HEAD с фактическими рефами remote.
     */
    let remoteOutput = '';

    try {
      const res = await execAsync(
        `git -C "${dir}" ls-remote origin`,
        { cwd: RunOptions.cwd },
      );

      remoteOutput = res.stdout.toString();
    } catch {
      /* Remote недоступен/не настроен — считаем всё неопубликованным */
      return true;
    }

    const remoteShas = remoteOutput.split(/\r?\n/)
      .map(line => line.split(/\s+/)[0])
      .filter(sha => /^[0-9a-f]{40}$/.test(sha));

    for (const sha of remoteShas) {
      try {
        await execAsync(
          `git -C "${dir}" merge-base --is-ancestor HEAD ${sha}`,
          { cwd: RunOptions.cwd },
        );

        /* HEAD достижим из remote-рефа — опубликован */
        return false;
      } catch {
        // HEAD не предок этого рефа — проверяем остальные
      }
    }

    return true;
  },

  isGitRepo: async (dir: string): Promise<boolean> => {
    try {
      await execAsync(
        `git -C "${dir}" rev-parse --is-inside-work-tree`,
        { cwd: RunOptions.cwd },
      );

      return true;
    } catch {
      return false;
    }
  },

  getRemote: async (dir: string): Promise<string | null> => {
    try {
      const res = await execAsync(
        `git -C "${dir}" remote get-url origin`,
        { cwd: RunOptions.cwd },
      );

      return res.stdout.toString().trim() || null;
    } catch {
      return null;
    }
  },

  init: async (dir: string): Promise<void> => {
    await execAsync(
      `git -C "${dir}" init`,
      { cwd: RunOptions.cwd },
    );
  },

  addRemote: async (dir: string, url: string): Promise<void> => {
    const existing = await local.getRemote(dir);

    const command = existing
      ? `git -C "${dir}" remote set-url origin "${url}"`
      : `git -C "${dir}" remote add origin "${url}"`;

    await execAsync(command, { cwd: RunOptions.cwd });
  },

  currentBranch: async (dir: string): Promise<string | null> => {
    try {
      const res = await execAsync(
        `git -C "${dir}" symbolic-ref --short -q HEAD`,
        { cwd: RunOptions.cwd },
      );

      return res.stdout.toString().trim() || null;
    } catch {
      return null;
    }
  },

  defaultRemoteBranch: async (dir: string): Promise<string | null> => {
    try {
      const res = await execAsync(
        `git -C "${dir}" symbolic-ref --short refs/remotes/origin/HEAD`,
        { cwd: RunOptions.cwd },
      );

      return res.stdout.toString().trim().replace(/^origin\//, '') || null;
    } catch {
      // origin/HEAD not set - probe common defaults
    }

    for (const candidate of ['main', 'master']) {
      try {
        await execAsync(
          `git -C "${dir}" rev-parse --verify --quiet origin/${candidate}`,
          { cwd: RunOptions.cwd },
        );

        return candidate;
      } catch {
        // No such remote branch
      }
    }

    return null;
  },

  /*
   * Аддоны checkout'нуты на тег (detached HEAD). Перед коммитом поднимаем
   * локальную ветку на текущем коммите и привязываем её к remote-ветке,
   * чтобы sync/push работали по ветке, а не в оторванной голове.
   */
  ensureBranch: async (dir: string): Promise<void> => {
    const branch = await local.currentBranch(dir);
    if (branch) return;

    await local.fetch(dir);
    const remoteBranch = await local.defaultRemoteBranch(dir);
    const target = remoteBranch || 'main';

    await execAsync(
      `git -C "${dir}" checkout -B ${target}`,
      { cwd: RunOptions.cwd },
    );

    if (remoteBranch) {
      await execAsync(
        // eslint-disable-next-line max-len
        `git -C "${dir}" branch --set-upstream-to=origin/${remoteBranch} ${target}`,
        { cwd: RunOptions.cwd },
      );
    }
  },

  createBranch: async (dir: string, branch: string): Promise<void> => {
    await execAsync(
      `git -C "${dir}" checkout -b ${JSON.stringify(branch)}`,
      { cwd: RunOptions.cwd },
    );
  },

  commitAll: async (dir: string, message: string): Promise<void> => {
    await execAsync(
      `git -C "${dir}" add -A`,
      { cwd: RunOptions.cwd },
    );

    await execAsync(
      `git -C "${dir}" commit -m ${JSON.stringify(message)}`,
      { cwd: RunOptions.cwd },
    );
  },

  addTag: async (dir: string, version: string): Promise<void> => {
    await execAsync(
      `git -C "${dir}" tag ${version}`,
      { cwd: RunOptions.cwd },
    );
  },

  push: async (dir: string, tag?: string): Promise<void> => {
    await execAsync(
      `git -C "${dir}" push -u origin HEAD`,
      { cwd: RunOptions.cwd },
    );

    if (tag) {
      await execAsync(
        `git -C "${dir}" push origin refs/tags/${tag}`,
        { cwd: RunOptions.cwd },
      );
    }
  },

  fetch: async (dir: string): Promise<void> => {
    try {
      await execAsync(
        `git -C "${dir}" fetch origin`,
        { cwd: RunOptions.cwd },
      );
    } catch {
      // Fresh repo without upstream yet - nothing to fetch
    }
  },

  isRemoteAhead: async (dir: string): Promise<boolean> => {
    await local.fetch(dir);

    try {
      const res = await execAsync(
        `git -C "${dir}" rev-list HEAD..@{u} --count`,
        { cwd: RunOptions.cwd },
      );

      return Number(res.stdout.toString().trim()) > 0;
    } catch {
      // No upstream configured - remote is not ahead
      return false;
    }
  },

  pullRebaseAutostash: async (dir: string): Promise<void> => {
    try {
      await execAsync(
        `git -C "${dir}" pull --rebase --autostash`,
        { cwd: RunOptions.cwd },
      );
    } catch {
      try {
        await execAsync(
          `git -C "${dir}" rebase --abort`,
          { cwd: RunOptions.cwd },
        );
      } catch {
        // Best effort - no rebase in progress
      }

      try {
        await execAsync(
          `git -C "${dir}" stash pop`,
          { cwd: RunOptions.cwd },
        );
      } catch {
        // Best effort - nothing stashed
      }

      throw new GitError('GIT_SYNC_CONFLICT');
    }
  },

  tagsAtHead: async (dir: string): Promise<string[]> => {
    try {
      const res = await execAsync(
        `git -C "${dir}" tag --points-at HEAD`,
        { cwd: RunOptions.cwd },
      );

      return res.stdout.toString().split(/\r?\n/)
        .filter(tag => tag && versionUtil.validate(tag));
    } catch {
      return [];
    }
  },

  currentVersion: async (name: string): Promise<string | null> => {
    const module = path.join(RunOptions.modulesDir, name);
    const tags = await local.tagsAtHead(module);

    return versionUtil.sort(tags)[0] || null;
  },

  listTags: async (dir: string): Promise<string[]> => {
    try {
      await execAsync(
        `git -C "${dir}" fetch --tags`,
        { cwd: RunOptions.cwd },
      );
    } catch {
      // Repo without remote - local tags only
    }

    const res = await execAsync(
      `git -C "${dir}" tag -l`,
      { cwd: RunOptions.cwd },
    );

    const tagList = res.stdout.toString().split(/\r?\n/);

    return tagList.filter(tag => {
      if (!tag) return false;

      return versionUtil.validate(tag);
    });
  },

  /*
   * package.json сабмодуля на произвольном рефе (теге), не трогая рабочую
   * копию. Нет файла или рефа — null (ленивое чтение depsByVersion).
   */
  readJSONAtRef: async (name: string, ref: string): Promise<any | null> => {
    const module = path.join(RunOptions.modulesDir, name);

    try {
      const res = await execAsync(
        `git -C "${module}" show ${ref}:package.json`,
        { cwd: RunOptions.cwd },
      );

      return JSON.parse(res.stdout.toString());
    } catch {
      return null;
    }
  },

  rm: async (submoduleName: string) => {
    const modulePath = path.join(RunOptions.modulesDir, submoduleName);

    await execAsync(
      `git rm -rf "${modulePath}"`,
      { cwd: RunOptions.cwd },
    );

    await execAsync(
      `rm -rf "${path.join('.git/modules', modulePath)}"`,
      { cwd: RunOptions.cwd },
    );
  },
};
