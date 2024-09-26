import fs from 'fs';
import path from 'path';
import { config } from './config';

const JSON_NAME = 'package.json';

const getPkgJsonPath = (name?: string) => {
  const folder = name ? [config.dir, name] : [];
  const jsonPath = path.join(process.cwd(), ...folder, JSON_NAME);
  const isJsonExists = fs.existsSync(jsonPath);
  if (!isJsonExists) return null;

  return jsonPath;
};

const read = (name?: string) => {
  const jsonPath = getPkgJsonPath(name);
  if (!jsonPath) return null;
  const jsonString = fs.readFileSync(jsonPath, 'utf-8');

  return JSON.parse(jsonString);
};

const write = (data: Object, name?: string) => {
  const jsonPath = getPkgJsonPath(name);
  if (!jsonPath) return null;
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2));
};

export const pkgJsonUtil = {
  getPkgJsonPath,
  read,
  write,
};

module.exports = { pkgJsonUtil };
