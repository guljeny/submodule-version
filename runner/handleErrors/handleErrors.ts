import { printError } from '../../src';
import { log } from '../log';

export const handleErrors = async (error: Error) => {
  log.error(printError(error));
};
