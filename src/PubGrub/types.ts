import type { SVError } from '../errors';
import type { GithubError } from '../git';

export type TDependencies = Record<string, string>;

export interface ICandidate {
  name: string;
  url: string;
  version: string;
  packageJson: unknown | null;
}

export type TIsCandidateCompatible = (candidate: ICandidate) => boolean;

export interface IPackageEntry {
  name: string;
  url: string;
  versions: Record<string, TDependencies>;
  manifests?: Record<string, unknown | null>;
}

export interface IResolvedPackage extends IPackageEntry {
  version: string;
  dependencies: TDependencies;
  /*
   * Кто какой диапазон запросил: '<root>' — корневой package.json,
   * имя родителя — манифест версии родителя (resolution плоский,
   * поэтому 'Parent@version' сворачивается до имени).
   */
  requestedVersion: Record<string, string>;
}

export type TPubGrubResult = Record<string, IResolvedPackage>;

/* Ошибки резолюции: конфликты солвера и сбои загрузки данных модулей. */
export type TResolveError = SVError | GithubError;

export type TResolveResult = {
  resolution: TPubGrubResult;
  errors: TResolveError[];
};

export interface IEntrySource {
  fetch(depPath: string): Promise<IPackageEntry>;
}

/*
 * Потенциальное изменение дерева зависимостей на время entryStore.simulate.
 * Без parent — root (применяется к rootDependencies самим вызывающим кодом).
 */
export interface IOverride {
  parent?: string;
  add?: string;
  version?: string;
  delete?: string;
}

export interface IRequirement {
  range: string;
  positive: boolean;
  requiredBy: string;
  chain: string[];
}

export interface ITerm {
  module: string;
  range: string;
  positive: boolean;
}

export type TIncompatibilityCause = {
  type: 'dependency' | 'root';
  requirement: IRequirement;
} | {
  type: 'learned';
  conflict: TConflict;
};

export interface IIncompatibility {
  terms: ITerm[];
  cause: TIncompatibilityCause;
}

export interface IVersionConflict {
  type: 'version';
  name: string;
  requirements: IRequirement[];
  /* Все semver-теги пакета, включая отклонённые хостом кандидаты. */
  versions: string[];
  /* Есть только когда подходящие по semver кандидаты отклонены callback'ом. */
  rejectedCandidates?: ICandidate[];
  packages: Set<string>;
}

export interface ICircularConflict {
  type: 'circular';
  name: string;
  chain: string[];
  packages: Set<string>;
}

export type TConflict = IVersionConflict | ICircularConflict;
