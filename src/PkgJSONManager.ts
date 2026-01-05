import fs from 'fs';
import { promisify } from 'util';
import path from 'path';
import { RunOptions } from './runOptions';

const existsAsync = promisify(fs.exists);
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);
const JSON_NAME = 'package.json';

type TJSONPath = string | null;

const getJsonPath = async (submoduleName?: string): Promise<TJSONPath> => {
  const folder = submoduleName ? [RunOptions.modulesDir, submoduleName] : [];
  const jsonPath = path.join(RunOptions.cwd, ...folder, JSON_NAME);
  const isJsonExists = await existsAsync(jsonPath);
  if (!isJsonExists) return null;

  return jsonPath;
};

export class PkgJSONManager {
  private cache: Map<string, any> = new Map();

  /* Reads package.json in project folder or in submodule */
  public read = async (submoduleName?: string) => {
    const jsonPath = await getJsonPath(submoduleName);

    if (!jsonPath) return null;

    if (this.cache.has(jsonPath)) {
      return this.cache.get(jsonPath);
    }

    const jsonString = await readFileAsync(jsonPath, 'utf-8');
    const parsed = JSON.parse(jsonString);

    this.cache.set(jsonPath, parsed);

    return parsed;
  };

  /* Writes package.json in project folder or in submodule */
  public write = async (data: Object, submoduleName?: string) => {
    const jsonPath = await getJsonPath(submoduleName);

    if (!jsonPath) return;

    this.cache.set(jsonPath, data);

    await writeFileAsync(jsonPath, JSON.stringify(data, null, 2));
  };

  public clearCache (): void {
    this.cache.clear();
  }
}
