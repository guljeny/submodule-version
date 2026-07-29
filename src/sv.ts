import path from 'path';
import { pkgJSONManager } from "./pkgJSONManager";
import { buildGraph } from "./buildGraph";
import { RunOptions } from "./runOptions";
import { versionUtil } from "./versionUtil";
import { git, GitError } from "./git";

export class SV {
  constructor (
    projectDir: string,
    modulesDir: string = 'addons',
  ) {
    RunOptions.cwd = projectDir;
    RunOptions.modulesDir = modulesDir;
  }

  public buildGraph = buildGraph;

  // eslint-disable-next-line class-methods-use-this
  public install = async (gitUrl: string, parentModule?: string) => {
    const { url, version, name } = git.parseUrl(gitUrl);

    if (!name) {
      throw new Error('NOT_A_GIT_URL');
    }

    const targetPkg = await pkgJSONManager.read(parentModule);
    const installedPkg = await pkgJSONManager.read(name);

    if (!installedPkg) {
      await git.addSumbmodule(url);
    }

    const versions = await git.listVersions(name);
    const latestVersion = versionUtil.latest(versions);
    const requestedVersion = version || latestVersion;

    if (!versions.includes(requestedVersion) && versions.length) {
      throw new Error('REQUESTED_VERSION_NOT_EXISTS');
    }

    if (!targetPkg.sv) {
      targetPkg.sv = {};
    }

    targetPkg.sv[url] = requestedVersion ? `^${requestedVersion}` : '*';
    await pkgJSONManager.write(targetPkg, parentModule);
    await buildGraph();
  };

  // eslint-disable-next-line class-methods-use-this
  public update = async () => {
    const graph = await buildGraph();
    if (!graph) return;
    await Promise.all(Object.entries(graph).map(async ([name, data]) => {
      const { version, used } = data;
      const latestVersion = versionUtil.latest(used);
      if (latestVersion !== version) {
        await git.checkout(name, latestVersion);
      }
    }));
  };

  /*
   * Устанавливает конкретную версию аддона: checkout на тег + запись constraint'а
   * в package.json проекта (иначе buildGraph вернёт latest(used)).
   * constraint по умолчанию — точный пин выбранной версии; при обновлении до
   * последней имеет смысл передать `^<version>`, чтобы новые версии продолжали приходить.
   */
  // eslint-disable-next-line class-methods-use-this
  public setVersion = async (name: string, version: string, constraint?: string) => {
    const versions = await git.listVersions(name);

    if (!versions.includes(version)) {
      throw new Error('REQUESTED_VERSION_NOT_EXISTS');
    }

    const dir = path.join(RunOptions.modulesDir, name);
    const dirty = await git.hasChanges(dir);

    /*
     * checkout с локальными изменениями транзакционен: git переносит их на
     * новую версию, а если перенести нельзя — отказывается, НЕ трогая дерево.
     * Значит при ошибке мы гарантированно остаёмся на исходной версии с теми
     * же изменениями — сообщаем, что перенос нужно сделать вручную.
     */
    try {
      await git.checkout(name, version);
    } catch (e) {
      if (dirty) {
        throw new GitError('GIT_DIRTY_SWITCH_CONFLICT');
      }

      throw e;
    }

    const json = await pkgJSONManager.read();
    if (!json?.sv) return;

    const key = Object.keys(json.sv).find(k => k.endsWith(`${name}.git`));
    const nextConstraint = constraint || version;
    if (key && json.sv[key] !== nextConstraint) {
      json.sv[key] = nextConstraint;
      await pkgJSONManager.write(json);
    }
  };

  /*
   * Constraint корневого проекта на аддон (ключ в sv ищем по имени, как в remove).
   */
  // eslint-disable-next-line class-methods-use-this
  public getConstraint = async (name: string): Promise<string | null> => {
    const json = await pkgJSONManager.read();
    if (!json?.sv) return null;

    const key = Object.keys(json.sv).find(k => k.endsWith(`${name}.git`));

    return key ? json.sv[key] : null;
  };

  // eslint-disable-next-line class-methods-use-this
  public setConstraint = async (name: string, constraint: string): Promise<void> => {
    const json = await pkgJSONManager.read();
    if (!json?.sv) return;

    const key = Object.keys(json.sv).find(k => k.endsWith(`${name}.git`));

    if (key && json.sv[key] !== constraint) {
      json.sv[key] = constraint;
      await pkgJSONManager.write(json);
    }
  };

  // eslint-disable-next-line class-methods-use-this
  public remove = async (submoduleName: string, parentModule?: string) => {
    await git.rm(submoduleName);
    const json = await pkgJSONManager.read(parentModule);

    if (!json.sv) return;

    json.sv = Object.keys(json.sv).reduce((acc, k) => {
      if (k.endsWith(`${submoduleName}.git`)) {
        return acc;
      }

      return { ...acc, [k]: json.sv[k] };
    }, {});

    await pkgJSONManager.write(json, parentModule);
    await buildGraph();
  };

  // eslint-disable-next-line class-methods-use-this
  public hasChanges = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    /* Сначала дешёвая проверка рабочей копии; если чисто — смотрим,
     * нет ли незапушенных коммитов (идёт fetch в remote) */
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
      if (!repoUrl) {
        throw new GitError('GIT_REPO_URL_REQUIRED');
      }

      if (!await git.isGitRepo(dir)) {
        await git.init(dir);
      }

      await git.addRemote(dir, repoUrl);
    }

    /* Публикация не последней версии запрещена: HEAD на теге, отличном
     * от последнего, — обновлять такую базу можно только вручную */
    const currentTag = await this.currentVersion(module);
    const latestKnown = await this.latestVersion(module);

    if (currentTag && latestKnown && currentTag !== latestKnown) {
      throw new GitError('GIT_NOT_LATEST_VERSION');
    }

    /* Аддоны checkout'нуты на тег: поднимаем ветку до sync/commit,
     * иначе коммиты и push уйдут в detached HEAD */
    await git.ensureBranch(dir);

    if (await git.isRemoteAhead(dir)) {
      await git.pullRebaseAutostash(dir);
    }

    const dirty = await git.hasChanges(dir);
    const headTag = await this.currentVersion(module);

    /* Дерево чистое и HEAD уже отмечен версионным тегом:
     * коммитить и бампить нечего — просто доставляем ветку и тег на remote */
    if (!dirty && headTag) {
      await git.push(dir, headTag);

      return headTag;
    }

    const next = versionUtil.bump(await this.latestVersion(module), bump);

    /* Фиксируем версию и в package.json, чтобы она не расходилась с git-тегом */
    const pkg = await pkgJSONManager.read(module);
    if (pkg) {
      pkg.version = next;
      await pkgJSONManager.write(pkg, module);
    }

    /* Перечитываем: запись версии в package.json сама по себе даёт изменения */
    if (await git.hasChanges(dir)) {
      await git.commitAll(dir, message || 'Update');
    }

    await git.addTag(dir, next);
    await git.push(dir, next);

    return next;
  };
}
