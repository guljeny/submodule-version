#!/usr/bin/env ts-node

import chalk from 'chalk';
import { log } from './src/log';

log.message(chalk.bgRed.white.bold(' RUNNED IN DEV MODE '));
import './src/submoduleVersion';
