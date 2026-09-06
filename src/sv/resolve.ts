import path from 'path';
import {
  IOverride,
  PubGrub,
  TDependencies,
  TPubGrubResult,
  TResolveError,
  TResolveResult,
} from '../PubGrub';
import { EntryStore } from '../entryStore';
import { SVError } from '../errors';
import { git } from '../git';
import { npm } from '../npm';
import { pkgJSONManager } from '../pkgJSONManager';
import { RunOptions } from '../runOptions';
import { versionUtil } from '../versionUtil';
import { setResolutionPreference } from '../PubGrub/resolutionPreference';
import { syncModules, syncModulesDir } from './modules';
import { ensureWorkspaces, syncPkgJson } from './packageJson';
import { IResolveContext } from './types';

const parsePutArgs = (
  versionOrParent?: string | null,
  parentName?: string,
): { range: string, parent?: string, defaultRange: boolean } => {
  const isVersion = !!versionOrParent
    && versionUtil.validate(versionOrParent, true);

  return {
    range: (isVersion ? versionOrParent : undefined) || '*',
    parent: (isVersion ? parentName : versionOrParent) || undefined,
    defaultRange: !isVersion,
  };
};

const pinDefaultRange = (
  override: IOverride | null,
  resolution: TPubGrubResult,
  defaultRange: boolean,
): void => {
  if (!defaultRange || !override?.add) return;

  const name = git.parseUrl(override.add).name;
  const version = name && resolution[name]?.version;

  if (version) override.version = `^${version}`;
};

/*
 * onError вызывается последовательно для каждой ошибки; true —
 * продолжить мутацию. Без коллбэка любые ошибки блокируют изменения.
 */
const confirmErrors = async (
  errors: TResolveError[],
  onError?: (error: TResolveError) => Promise<boolean>,
): Promise<boolean> => {
  if (!onError) return false;

  for (const error of errors) {
    if (!await onError(error)) return false;
  }

  return true;
};

/*
 * Вместо url можно передать имя уже установленного модуля: url берём
 * из корневого package.json#sv, затем из remote локального сабмодуля.
 * package.json родителей не читается — их зависимости живут только
 * в remote-каталоге.
 */
const findModuleUrl = async (
  urlOrName: string,
  baseJson: any,
): Promise<string> => {
  if (git.parseUrl(urlOrName).name) return urlOrName;

  const existing = Object.keys((baseJson.sv || {}) as TDependencies)
    .find(depUrl => git.parseUrl(depUrl).name === urlOrName);

  if (existing) return existing;

  const remote = await git.local.getRemote(
    path.join(RunOptions.modulesDir, urlOrName),
  );

  if (remote && git.parseUrl(remote).name) return remote;

  throw new SVError('NOT_A_GIT_URL', { url: urlOrName });
};

/*
 * Единая атомарная операция: резолюция дерева зависимостей и (при
 * отсутствии ошибок или разрешении onError) синхронизация манифестов,
 * сабмодулей и node_modules.
 *
 * Без аргументов — валидация/синхронизация текущего дерева.
 * url (или имя установленного модуля) — установка/смена версии;
 * versionOrParent — semver-диапазон или имя родителя, null — удаление.
 * Ошибки окружения (NOT_A_NPM, NOT_A_GIT_REPO, сбои git/npm) — throw,
 * ошибки резолюции возвращаются в errors.
 */
export const resolve = async (
  context: IResolveContext,
  url?: string,
  versionOrParent?: string | null,
  parentName?: string,
): Promise<TResolveResult> => {
  /* null — удаление: третий аргумент всегда имя родителя. */
  const { range, parent, defaultRange } = versionOrParent === null
    ? { range: '*', parent: parentName, defaultRange: false }
    : parsePutArgs(versionOrParent, parentName);

  /* package.json читается только у корня проекта. */
  const baseJson = await pkgJSONManager.read();

  if (!baseJson) throw new SVError('NOT_A_NPM');

  if (!await git.local.isGitRepo(RunOptions.cwd)) {
    throw new SVError('NOT_A_GIT_REPO');
  }

  const dirChanged = await syncModulesDir(
    baseJson,
    context.explicitModulesDir,
  );

  const baseChanged = ensureWorkspaces(baseJson) || dirChanged;
  let override: IOverride | null = null;

  if (url) {
    override = versionOrParent === null
      ? { parent, delete: git.parseUrl(url).name || url }
      : {
        parent,
        add: await findModuleUrl(url, baseJson),
        version: range,
      };
  }

  /* Каждый вызов резолвит свежие данные git api: EntryStore одноразовый. */
  const store = new EntryStore();

  const { resolution, errors } = await store.simulate(
    override ? [override] : [],
    (baseJson.sv || {}) as TDependencies,
    deps => {
      if (override?.add) {
        const name = git.parseUrl(override.add).name;

        if (name) {
          setResolutionPreference(deps, {
            depPath: override.add,
            name,
            range: override.version || '*',
          });
        }
      }

      return new PubGrub(store, context.isCandidateCompatible).resolve(deps);
    },
  );

  /* check-only возвращает рассчитанное дерево и все ошибки до любых
   * записей package.json, Git-переходов и npm install. onError здесь не
   * вызывается: разрешать мутацию в режиме без мутации бессмысленно. */
  if (context.checkOnly) return { resolution, errors };

  /* SV не хранит resolution: при отказе onError рабочая копия не тронута,
   * полный fallback-результат просто возвращается вызывающему. */
  if (errors.length && !await confirmErrors(errors, context.onError)) {
    return { resolution, errors };
  }

  pinDefaultRange(override, resolution, defaultRange);

  const jsonChanged = await syncPkgJson(baseJson, override, baseChanged);
  const modulesChanged = await syncModules(resolution, !errors.length);

  /*
   * npm install запускается только когда реально что-то изменилось —
   * иначе каждый CLI-вызов платил бы за полный прогон npm.
   */
  if (jsonChanged || modulesChanged) {
    try {
      await npm.install();
    } catch (error) {
      /* Мутация манифестов и модулей уже применена: отдаём post-mutation
       * resolution в details, чтобы вызывающий мог показать новое дерево. */
      if (error instanceof SVError && error.error === 'NPM_INSTALL_FAILED') {
        throw new SVError('NPM_INSTALL_FAILED', {
          ...error.details,
          resolution,
        });
      }

      throw error;
    }
  }

  return { resolution, errors };
};
