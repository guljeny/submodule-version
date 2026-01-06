import fs from 'fs';
import path from 'path';
import { pkgJSONManager } from '../pkgJSONManager';
import { versionUtil } from '../versionUtil';
import { git } from '../git';
import { RunOptions } from '../runOptions';
import { GraphError } from './GraphError';

type TSV = Record<string, string>;

interface ITreeEntry {
  meta: {
    version: string;
    sv: TSV;
  };
  parents: Record<string, string>;
}

type TBaseTree = Record<string, ITreeEntry>;

export interface IGraphEntry {
  versions: string[];
  parents: Record<string, string>;
  used: string[];
  version: string;
}

export const buildGraph = async (): Promise<Record<string, IGraphEntry>> => {
  const baseJson = await pkgJSONManager.read();
  const baseTree: TBaseTree = {};

  if (!baseJson) {
    throw new Error('NOT_A_NPM');
  }

  if (!baseJson.sv) {
    /** There is no dependencies, graph is empty */
    return {};
  }

  const recursiveBuilder = async (dependencies: TSV = {}, parent = '*') => {
    await Promise.all(
      Object.entries(dependencies).map(async ([url, version]) => {
        const { name } = git.parseUrl(url);
        const { cwd, modulesDir } = RunOptions;
        const moduleDir = path.join(cwd, modulesDir, name);
        const isInstalled = fs.existsSync(moduleDir);

        if (version && !versionUtil.validate(version, true)) {
          throw new GraphError('UNKNOWN_VERSION', { name, version, parent });
        }

        if (!isInstalled) {
          await git.addSumbmodule(url);
        }

        const existEntry = baseTree[name] || null;

        const mJson = existEntry
          ? null
          : await pkgJSONManager.read(name);

        const meta = {
          version: existEntry?.meta.version
                    || mJson?.version
                    || version
                    || '*',
          sv: existEntry?.meta.sv || mJson?.sv || {},
        };

        const parents = existEntry?.parents || {};

        baseTree[name] = {
          meta,
          parents: { ...parents, [parent]: version },
        };

        await recursiveBuilder(meta.sv, name);
      }),
    );
  };

  await recursiveBuilder(baseJson.sv, baseJson.name);

  const graph = await Promise.all(
    Object.entries(baseTree).map(async ([name, data]) => {
      const versions = await git.listVersions(name);
      const { parents, meta } = data;

      const used = Object.entries(parents).reduce((selective, [, v]) => (
        versionUtil.pick(selective, v)
      ), versions);

      // No compatible version found and module has version tags
      if (!used.length && versions.length) {
        throw new GraphError('VERSION_CONFLICT', { parents, name });
      }

      if (!used.includes(meta.version)) {
        const latest = versionUtil.latest(used);
        if (latest) {
          await git.checkout(name, latest);
        }
      }

      return {
        name,
        data: { versions, parents, used, version: meta.version },
      };
    }),
  );

  return graph.reduce((acc, { name, data }) => ({
    ...acc,
    [name]: data,
  }), {} as Record<string, IGraphEntry>);
};
