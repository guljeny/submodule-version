import { exec } from 'child_process';
import { promisify } from 'util';
import { RunOptions } from './runOptions';
import { SVError } from './errors';

const execAsync = promisify(exec);

/* stderr упавшей npm-команды — единственный источник настоящей причины */
const stderrOf = (error: unknown): string => (
  (error as { stderr?: string })?.stderr || ''
).trim();

export const npm = {
  /*
   * Линкует сабмодули в node_modules и ставит их зависимости.
   * Запускается в корне проекта после любой синхронизации модулей.
   */
  install: async (): Promise<void> => {
    try {
      await execAsync('npm install', { cwd: RunOptions.cwd });
    } catch (error) {
      throw new SVError('NPM_INSTALL_FAILED', { reason: stderrOf(error) });
    }
  },
};
