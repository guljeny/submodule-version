import fs from 'fs';
import path from 'path';
import { config } from './config';
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

  // First pass of graph creation. Read and validate data w/o networking
  const recursiveBuilder = (dependencies: TSV = {}, parent = '*') => {
    Object.entries(dependencies).forEach(([url, version]) => {
      const { name } = parseGitUrl(url);
      const moduleDir = path.join(process.cwd(), config.dir, name);
      const isInstalled = fs.existsSync(moduleDir);

      if (version && !versionUtil.validate(version, true)) {
        const stV = chalk.bgRed.bold.white(` ${version} `);
        const stName = chalk.red.bold(name);
        const stParent = chalk.green.bold(parent);

        return log.error('Unknown version', stV, 'for', stName, 'in', stParent);
      }

      if (!isInstalled) {
        git.addSumbmodule(url);
      }

      const existEntry = baseTree[name] || null;
      const mJson = existEntry ? null : pkgJsonUtil.read(name);

      const meta = {
        version: existEntry?.meta.version || mJson?.version || version || '*',
        sv: existEntry?.meta.sv || mJson?.sv || {},
      };

      const parents = existEntry?.parents || {};

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

    // No comatible version found and module has version tags
    if (!used.length && versions.length) {
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
      const latest = versionUtil.latest(used);
      if (latest) {
        git.checkout(name, versionUtil.latest(used));
      } else {
        log.message(
          chalk.yellow('⚠️  WARN: Module'),
          chalk.bgYellow.black(` ${name} `),
          chalk.yellow('does not contain any version tag!'),
        );
      }
    }

    return {
      ...acc,
      [name]: { versions, parents, used, version: meta.version },
    };
  }, {});

  return graph;
};
