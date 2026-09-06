import type { TDependencies } from './types';

export interface IResolutionPreference {
  depPath: string;
  name: string;
  range: string;
}

/*
 * Метаданные текущей мутации не являются частью публичного API PubGrub.
 * WeakMap связывает их с эффективным rootDeps только на время одного resolve.
 */
const preferences = new WeakMap<TDependencies, IResolutionPreference>();

export const setResolutionPreference = (
  rootDependencies: TDependencies,
  preference: IResolutionPreference,
): void => {
  preferences.set(rootDependencies, preference);
};

export const getResolutionPreference = (
  rootDependencies: TDependencies,
): IResolutionPreference | undefined => preferences.get(rootDependencies);
