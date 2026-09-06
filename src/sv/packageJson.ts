import { IOverride, TDependencies } from '../PubGrub';
import { SVError } from '../errors';
import { git } from '../git';
import { pkgJSONManager } from '../pkgJSONManager';
import { RunOptions } from '../runOptions';

/*
 * Правка package.json родителя (внутри его сабмодуля): parent-level
 * мутации обязаны пережить публикацию родителя, поэтому диапазон
 * пишется в его поле sv.
 */
const applyOverride = (json: any, override: IOverride): any => {
  const sv = { ...((json.sv || {}) as TDependencies) };

  if (override.add) sv[override.add] = override.version || '*';

  if (override.delete) {
    const key = Object.keys(sv)
      .find(depUrl => git.parseUrl(depUrl).name === override.delete);

    if (!key) throw new SVError('ADDON_NOT_FOUND', { name: override.delete });

    delete sv[key];
  }

  return { ...json, sv };
};

/*
 * modulesDir должен быть npm-workspace, иначе сабмодули не попадут
 * в node_modules. Поддерживаем оба формата: workspaces: [] и
 * workspaces: { packages: [] }. Возвращает true, если json изменён.
 */
export const ensureWorkspaces = (baseJson: any): boolean => {
  const entry = `${RunOptions.modulesDir}/*`;

  if (Array.isArray(baseJson.workspaces)) {
    if (baseJson.workspaces.includes(entry)) return false;

    baseJson.workspaces.push(entry);

    return true;
  }

  const packages = baseJson.workspaces?.packages;

  if (Array.isArray(packages)) {
    if (packages.includes(entry)) return false;

    packages.push(entry);

    return true;
  }

  baseJson.workspaces = [entry];

  return true;
};

/*
 * Запись манифеста: override меняет package.json корня или родителя
 * (modulesDir/<parent>/package.json — фича «редактирование deps
 * аддона»). Без override пишется только базовый json (workspaces,
 * sv-dir), если он изменился. Возвращает true, если json изменён.
 */
export const syncPkgJson = async (
  baseJson: any,
  override: IOverride | null,
  baseChanged: boolean,
): Promise<boolean> => {
  if (!override) {
    if (baseChanged) await pkgJSONManager.write(baseJson);

    return baseChanged;
  }

  const targetJson = override.parent
    ? await pkgJSONManager.read(override.parent)
    : baseJson;

  if (!targetJson) {
    throw new SVError('ADDON_NOT_FOUND', { name: override.parent });
  }

  /* Проверяем запись до git-мутации, чтобы неизвестное имя было no-op. */
  const nextTargetJson = applyOverride(targetJson, override);

  if (override.parent) {
    await pkgJSONManager.write(nextTargetJson, override.parent);
    if (baseChanged) await pkgJSONManager.write(baseJson);
  } else {
    await pkgJSONManager.write(nextTargetJson);
  }

  return true;
};
