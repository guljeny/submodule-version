export const ERR = {
  NOT_A_NPM: 'NOT_A_NPM',
  NOT_A_GIT_REPO: 'NOT_A_GIT_REPO',
  NOT_A_GIT_URL: 'NOT_A_GIT_URL',
  NOT_INITIALIZED: 'NOT_INITIALIZED',
  PATH_NOT_FOUND: 'PATH_NOT_FOUND',
  ADDON_NOT_FOUND: 'ADDON_NOT_FOUND',
  REQUESTED_VERSION_NOT_EXISTS: 'REQUESTED_VERSION_NOT_EXISTS',
  VERSION_CONFLICT: 'VERSION_CONFLICT',
  CIRCULAR_DEPENDENCY: 'CIRCULAR_DEPENDENCY',
  UNKNOWN_VERSION: 'UNKNOWN_VERSION',
  GIT_DIRTY_SWITCH_CONFLICT: 'GIT_DIRTY_SWITCH_CONFLICT',
} as const;

export type TSVErrorCode = keyof typeof ERR;

export type TSVErrorDetails = {
  /* Путь от корня проекта до блокирующего аддона (имена узлов) */
  chain?: string[];
  requestedVersion?: string;
  installedVersion?: string;
  parents?: Record<string, string>;
  versions?: string[];
  [k: string]: unknown;
};

/*
 * Единственный тип ошибки, который уходит наружу из методов SV.
 * GitError остаётся во внутреннем git-слое.
 */
export class SVError extends Error {
  constructor (
    public error: TSVErrorCode,
    public details: TSVErrorDetails = {},
  ) {
    super(error);
  }
}
