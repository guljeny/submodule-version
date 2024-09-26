#!/usr/bin/env ts-node

import chalk from 'chalk';

console.log(chalk.bgRed.white.bold(' RUNNED IN DEV MODE '));
import './src/submoduleVersion';
