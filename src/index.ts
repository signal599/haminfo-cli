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
import { geocode as geocodeByGoogle, getFormattedAddress } from "./lib/geocoding/google.js";
import { revalidateCache } from "./lib/revalidate-cache.js";
import { geocodeBatch } from "./lib/geocoding/batch-geocode.js";
import { zipGeocodeBatch } from "./lib/geocoding/zip-geocode.js";
import { processExportQueue } from "./lib/exports/export-queue.js";
import { checkImportCounts } from "./lib/imports/check-import.js";
import logger from "./lib/logger.js";

// Commander does not handle a rejected action promise, so without this a failed
// step would leave the exit code at 0 and let the next command in
// update-fcc-data.sh run against a half-imported table.
function run(action: (...args: any[]) => unknown) {
  return async (...args: any[]) => {
    try {
      await action(...args);
    } catch (err) {
      const reason = err instanceof Error ? (err.stack ?? err.message) : String(err);
      console.error(reason);
      logger.error(`Command ${process.argv[2]} failed`, { reason });
      process.exitCode = 1;
    }
  };
}

const program = new Command();

program
  .name("haminfo-cli")
  .description("CLI commands for ham map")
  .version("1.0.0");

program
  .command("import-hd")
  .description("Import hd file into table")
  .action(run(async () => {
    await importHd();
  }));

program
  .command("import-en")
  .description("Import en file into table")
  .action(run(async () => {
    await importEn();
  }));

program
  .command("import-am")
  .description("Import am file into table")
  .action(run(async () => {
    await importAm();
  }));

program
  .command("update-hash")
  .description("Update hash")
  .action(run(async () => {
    await updateHash();
  }));

program
  .command("truncate-table")
  .description("Truncate suffix")
  .argument("<string>", "table suffix")
  .action(run(async (tableSuffix) => {
    await truncateTable(`fcc_license_${tableSuffix}`);
  }));

program
  .command("check-import-counts")
  .description("Verify the imported FCC tables are fully populated")
  .action(run(async () => {
    if (!(await checkImportCounts())) {
      process.exitCode = 1;
    }
  }));

program
  .command("import-fcc-update")
  .description("Update licenses")
  .action(run(async () => {
    await updateLicenses();
  }));

program
  .command("import-fcc-new")
  .description("Import new licenses")
  .action(run(async () => {
    await importNewLicenses();
  }));

program
  .command("import-fcc-new-addresses")
  .description("Import newaddresses")
  .action(run(async () => {
    await importNewAddresses();
  }));

program
  .command("delete-fcc-inactive")
  .description("Delete inactive stations")
  .action(run(async () => {
    await deleteInactiveStations();
  }));

program
  .command("delete-fcc-inactive-addresses")
  .description("Delete inactive addresses")
  .action(run(async () => {
    await deleteInactiveAddresses();
  }));

program
  .command("delete-fcc-inactive-locations")
  .description("Delete inactive locations")
  .action(run(async () => {
    await deleteInactiveLocations();
  }));

program
  .command("set-po-box")
  .description("Set PO Box")
  .action(run(async () => {
    await setPoBox();
  }));

  program
  .command("write-log")
  .description("Write log")
  .argument("<string>", "message")
  .argument("[string]", "level", "info")
  .action(run(writeLog));

program
  .command("geocode-batch")
  .description("Geocode batch")
  .action(run(async () => {
    console.log(await geocodeBatch());
  }));

program
  .command("zip-geocode-batch")
  .description("Batch geocode zip codes in the zipcodes table")
  .action(run(async () => {
    await zipGeocodeBatch();
  }));

program
  .command("geocode-by-geocodio")
  .description("Geocode by Geocodio")
  .argument("<string>", "address")
  .action(run(async (address) => {
    const response = await geocodeByGeocodio([address]);
    console.log(response.code, response.data);
  }));

program
  .command("google-formatted-address")
  .description("Google formatted address")
  .argument("<string>", "address")
  .action(run(async (address) => {
    console.log(await getFormattedAddress(address));
  }));

program
  .command("revalidate-cache")
  .description("Revalidate cache")
  .action(run(async () => {
    await revalidateCache();
    console.log("Cache revalidated");
  }));

program
  .command("process-exports")
  .description("Process pending export queue jobs")
  .action(run(async () => {
    await processExportQueue();
  }));

program.parse();
