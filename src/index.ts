#!/usr/bin/env node

import "dotenv/config";
import { Command } from "commander";
import { importHd } from "./lib/imports/import-hd.js";
import { importAm } from "./lib/imports/import-am.js";
import { importEn } from "./lib/imports/import-en.js";
import {
  deleteInactiveAddresses,
  deleteInactiveLocations,
  deleteInactiveStations,
  importNewAddresses,
  importNewLicenses,
  setPoBox,
  truncateTable,
  updateHash,
  updateLicenses,
} from "./lib/imports/sql-updates.js";
import { writeLog } from "./lib/utils.js";
import { geocode as geocodeByGeocodio } from "./lib/geocoding/geocodio.js";

const program = new Command();

program
  .name("haminfo-cli")
  .description("CLI commands for ham map")
  .version("1.0.0");

program
  .command("import-hd")
  .description("Import hd file into table")
  .action(async () => {
    await importHd();
  });

program
  .command("import-en")
  .description("Import en file into table")
  .action(async () => {
    await importEn();
  });

program
  .command("import-am")
  .description("Import am file into table")
  .action(async () => {
    await importAm();
  });

program
  .command("update-hash")
  .description("Update hash")
  .action(async () => {
    await updateHash();
  });

program
  .command("truncate-table")
  .description("Truncate suffix")
  .argument("<string>", "table suffix")
  .action(async (tableSuffix) => {
    await truncateTable(`fcc_license_${tableSuffix}`);
  });

program
  .command("import-fcc-update")
  .description("Update licenses")
  .action(async () => {
    await updateLicenses();
  });

program
  .command("import-fcc-new")
  .description("Import new licenses")
  .action(async () => {
    await importNewLicenses();
  });

program
  .command("import-fcc-new-addresses")
  .description("Import newaddresses")
  .action(async () => {
    await importNewAddresses();
  });

program
  .command("delete-fcc-inactive")
  .description("Delete inactive stations")
  .action(async () => {
    await deleteInactiveStations();
  });

program
  .command("delete-fcc-inactive-addresses")
  .description("Delete inactive addresses")
  .action(async () => {
    await deleteInactiveAddresses();
  });

program
  .command("delete-fcc-inactive-locations")
  .description("Delete inactive locations")
  .action(async () => {
    await deleteInactiveLocations();
  });

program
  .command("set-po-box")
  .description("Set PO Box")
  .action(async () => {
    await setPoBox();
  });

  program
  .command("write-log")
  .description("Write log")
  .argument("<string>", "message")
  .argument("[string]", "level", "info")
  .action(writeLog);

program
  .command("geocode-by-geocodio")
  .description("Geocode by geocodio")
  .argument("<string>", "address")
  .action(async (address) => {
    console.log(await geocodeByGeocodio(address));
  });

program.parse();
