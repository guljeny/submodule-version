import { parseGitUrl } from './parseGitUrl';
import { local } from './local';
import { api } from './api';

/*
 * Единая точка доступа к git: local — операции локального git CLI,
 * api — удалённый GitHub GraphQL API (без клонирования).
 */
export const git = {
  parseUrl: parseGitUrl,
  local,
  api,
};
