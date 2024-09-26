import yargs from 'yargs';

const message = (...args: string[]) => {
  // eslint-disable-next-line no-console
  console.log(...args);
};

const error = (...args: string[]) => {
  message(...args);
  yargs.exit(1, new Error(args.join(' ')));
};

export const log = {
  message,
  error,
};
