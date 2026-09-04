import fs from 'fs';
import path from 'path';
import { pkgJSONManager } from './pkgJSONManager';
import { Graph, graphDiff, IGraphDiffEntry, IGraphEntry, TSV } from './graph';
import { entryStore } from './entryStore';
import { github } from './github';
import { RunOptions } from './runOptions';
import { versionUtil } from './versionUtil';
import { git, GitError } from './git';
import { SVError } from './errors';

export class SV {
  private graph: Graph | null = null;

  constructor (
    projectDir: string,
    modulesDir: string = 'addons',
    options: { githubToken?: string } = {},
  ) {
    RunOptions.cwd = projectDir;
    RunOptions.modulesDir = modulesDir;

    /* Токен через JS API опционален: без него github-клиент берёт env */
    github.setToken(options.githubToken);
  }

  /*
   * Проверяем окружение (npm + git), грузим рутовые зависимости и
   * рекурсивно все их подзависимости из GitHub API в entryStore,
   * затем строим минимальный граф и приводим сабмодули на диске
   * к выбранным версиям.
   */
  public init = async () => {
    const baseJson = await pkgJSONManager.read();

    if (!baseJson) {
      throw new SVError('NOT_A_NPM');
    }

    if (!await git.isGitRepo(RunOptions.cwd)) {
      throw new SVError('NOT_A_GIT_REPO');
    }

    const rootDeps = (baseJson.sv || {}) as TSV;

    /* Сначала данные: граф ещё не построен */
    await Promise.all(
      Object.keys(rootDeps).map(url => entryStore.fetch(url)),
    );

    /* Минимальный граф: рутовые зависимости + резолв их версий */
    this.graph = await new Graph().init(rootDeps);

    /*
     * Временно: версии на диске не меняем, просто печатаем граф
     * (до появления реальной логики terraform/applyDiff)
     */
    // await Promise.all(
    //   Object.values(this.graph.entries).map(entry => this.syncEntry(entry)),
    // );
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(this.graph.entries, null, 2));
  };

  /* Все graph-зависимые методы требуют init() */
  private ctx = (): Graph => {
    if (!this.graph) {
      throw new SVError('NOT_INITIALIZED');
    }

    return this.graph;
  };

  public getGraph = (): Graph => this.ctx();

  public listVersions = (): Record<string, string[]> => {
    const graph = this.ctx();

    return Object.fromEntries(
      Object.values(graph.entries)
        .map(entry => [entry.name, Object.keys(entry.versions)]),
    );
  };

  /*
   * Базовая git-синхронизация одной записи с диском: сабмодуль
   * отсутствует — добавляем (url из entryStore), HEAD на другом
   * теге — checkout на выбранную версию.
   */
  // eslint-disable-next-line class-methods-use-this
  private syncEntry = async (entry: IGraphEntry): Promise<void> => {
    const dir = path.join(RunOptions.cwd, RunOptions.modulesDir, entry.name);

    if (!fs.existsSync(dir)) {
      const url = entryStore.urlOf(entry.name);

      if (!url) {
        throw new SVError('ADDON_NOT_FOUND', { name: entry.name });
      }

      await git.addSumbmodule(url);
    }

    if (!entry.version) return;

    const current = await git.currentVersion(entry.name);

    if (current !== entry.version) {
      await git.checkout(entry.name, entry.version);
    }
  };

  /*
   * Применение diff'а к диску — пока только базовый git: PUT — сабмодуль
   * на диске и на нужной версии, DELETE — сабмодуль снесён. Запись
   * constraint'ов в package.json и npm-команды — следующий этап.
   */
  private applyDiff = async (diff: IGraphDiffEntry[]): Promise<void> => {
    await Promise.all(diff.map(({ method, entry }) => (
      method === 'DELETE' ? git.rm(entry.name) : this.syncEntry(entry)
    )));
  };

  /*
   * Общий конвейер действия: terraform (новый граф) -> diff ->
   * применить diff гит-командами -> подменить граф.
   */
  private apply = async (next: Graph): Promise<IGraphDiffEntry[]> => {
    const graph = this.ctx();
    const diff = graphDiff(graph.entries, next.entries);

    await this.applyDiff(diff);

    this.graph = next;

    return diff;
  };

  /*
   * Добавляет зависимость по git-url. Второй аргумент разбирается по
   * semver-форме: '1.2.0' — версия, 'A.B' — path родителя. Данные о
   * зависимости и всех её подзависимостях грузятся из GitHub API
   * до трансформации графа.
   */
  public add = async (
    gitUrl: string,
    parentOrVersion?: string,
    version?: string,
  ) => {
    const graph = this.ctx();
    const { url, version: urlVersion, name } = git.parseUrl(gitUrl);

    if (!name) {
      throw new SVError('NOT_A_GIT_URL', { url: gitUrl });
    }

    let parentPath: string | undefined;
    let requested = urlVersion || '*';

    if (parentOrVersion) {
      if (versionUtil.validate(parentOrVersion)) {
        requested = parentOrVersion;
      } else {
        parentPath = parentOrVersion;
      }
    }

    if (version) {
      requested = version;
    }

    /* Грузим новую зависимость и все её подзависимости рекурсивно */
    await entryStore.fetch(url);

    const entryPath = parentPath ? `${parentPath}.${name}` : name;
    const next = graph.terraform(entryPath, requested);

    return this.apply(next);
  };

  /*
   * Переводит зависимость по path ('A.B.C') на версию/constraint.
   * Без version — '*' (последняя допустимая).
   */
  public setVersion = async (entryPath: string, version?: string) => {
    const graph = this.ctx();
    const next = graph.terraform(entryPath, version || '*');

    return this.apply(next);
  };

  /* Удаляет зависимость по path ('A.B.C' — C из B, 'A' — из корня) */
  public remove = async (entryPath: string) => {
    const graph = this.ctx();
    const next = graph.terraform(entryPath, null);

    return this.apply(next);
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

  /*
   * Remote-ветка впереди локальной (fetch + rev-list HEAD..@{u}).
   * Нет репозитория/remote/upstream — обновлений нет.
   */
  // eslint-disable-next-line class-methods-use-this
  public isRemoteAhead = async (module?: string): Promise<boolean> => {
    const dir = module
      ? path.join(RunOptions.modulesDir, module)
      : RunOptions.cwd;

    if (!await git.isGitRepo(dir)) return false;

    return git.isRemoteAhead(dir);
  };

  /*
   * Догоняем remote: pull --rebase --autostash. При конфликте всё
   * восстанавливается как было (rebase --abort + stash pop) и кидается
   * GIT_SYNC_CONFLICT — дальше возможен только ручной ребейз.
   */
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
    /*
     * Фиксируем версию и в package.json,
     * чтобы она не расходилась с git-тегом
     */
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

    /* Живой граф: после бампа версия появляется у entry без перестроения */
    const entry = module ? this.graph?.entries[module] : undefined;

    if (entry && !(next in entry.versions)) {
      entry.versions[next] = {};
      entry.version = next;
    }

    return next;
  };
}
