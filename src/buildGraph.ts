import chalk from 'chalk';
import { pkgJsonUtil } from './pkgJsonUtil';
import { log } from './log';
import { git } from './git';
import { parseGitUrl } from './parseGitUrl';
import { versionUtil } from './versionUtil';

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

export const buildGraph = (): Record<string, IGraphEntry> | void => {
  const baseJson = pkgJsonUtil.read();
  const baseTree: TBaseTree = {};

  if (!baseJson) return log.error('Not a npm project');
  if (!baseJson.sv) return log.message('There is no dependencies');

  const recursiveBuilder = (dependencies: TSV = {}, parent = '*') => {
    Object.entries(dependencies).forEach(([url, version]) => {
      const { name } = parseGitUrl(url);
      const jsonPath = pkgJsonUtil.getPkgJsonPath(name);
      if (!versionUtil.validate(version, true)) {
        const em = `<${version}> for [${name}] in [${parent}]`;

        return log.error('Unknown version', em);
      }
      if (!jsonPath) {
        git.addSumbmodule(url);
      }

      const exists = baseTree[name] || null;
      const mJson = exists ? null : pkgJsonUtil.read(name);

      if (!version) return log.error('Module', name, 'not installed');

      const meta = exists?.meta || { version: mJson.version, sv: mJson.sv };
      const parents = exists?.parents || {};

      baseTree[name] = {
        meta,
        parents: { ...parents, [parent]: version },
      };

      recursiveBuilder(meta.sv, name);
    });
  };

  recursiveBuilder(baseJson.sv, baseJson.name);

  const graph = Object.entries(baseTree).reduce((acc, [name, data]) => {
    const versions = git.listVersions(name);
    const { parents, meta } = data;

    const used = Object.entries(parents).reduce((selective, [, v]) => (
      versionUtil.pick(selective, v)
    ), versions);

    if (!used.length) {
      const longestVersion = Object.values(parents).reduce((len, v) => (
        v.length > len ? v.length : len
      ), 0);

      const formattedName = chalk.green.bold(name);
      const baseMsg = `${chalk.red('Confilict')} for ${formattedName}:`;

      const conflictMsg = Object.entries(parents).reduce((msg, [pName, v]) => {
        const formatedV = chalk.bold.red(String(v).padEnd(longestVersion, ' '));

        return [
          ...msg,
          `  - Version ${formatedV} used in ${chalk.green.bold(pName)}`,
        ];
      }, [baseMsg]);

      log.error(conflictMsg.join('\n'));
    }

    if (!used.includes(meta.version)) {
      git.checkout(name, versionUtil.latest(used));
    }

    return {
      ...acc,
      [name]: { versions, parents, used, version: meta.version },
    };
  }, {});

  return graph;
};
