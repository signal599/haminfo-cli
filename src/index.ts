#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { importHd } from './lib/imports/import-hd.js';
import { importAm } from './lib/imports/import-am.js';
import { importEn } from './lib/imports/import-en.js';

const program = new Command();

program
  .name('import-raw')
  .description('Import FCC data into temporary tables')
  .version('1.0.0');

program
  .command('import-hd')
  .description('Import hd file into table')
  .action(async () => {
    await importHd();
  });

program
  .command('import-en')
  .description('Import en file into table')
  .action(async () => {
    await importEn();
  });

program
  .command('import-am')
  .description('Import am file into table')
  .action(async () => {
    await importAm();
  });

program.parse();
