import { count } from "drizzle-orm";
import { MySqlTable, TableConfig, getTableConfig } from "drizzle-orm/mysql-core";
import { fccLicenseAm, fccLicenseEn, fccLicenseHd } from "../../db/schema.js";
import { closeDb, getDb } from "../db-helper.js";
import { MIN_IMPORT_ROWS } from "../constants.js";
import logger from "../logger.js";

const IMPORT_TABLES: MySqlTable<TableConfig>[] = [
  fccLicenseHd,
  fccLicenseEn,
  fccLicenseAm,
];

// Verify the freshly imported FCC tables are fully populated.
//
// The update and delete steps that follow an import treat these tables as the
// complete picture of active licenses, so an empty or partial table would have
// them delete most of ham_station and cascade into ham_address and
// ham_location. Returns true only if every table is above the floor.
export async function checkImportCounts(): Promise<boolean> {
  const db = await getDb();
  let allOk = true;

  try {
    for (const table of IMPORT_TABLES) {
      const { name: tableName } = getTableConfig(table);
      const rows = await db.select({ value: count() }).from(table);
      const rowCount = rows[0].value;

      if (rowCount < MIN_IMPORT_ROWS) {
        allOk = false;
        const msg = `${tableName} has ${rowCount} rows, below the minimum of ${MIN_IMPORT_ROWS}`;
        console.error(msg);
        logger.error(msg);
        continue;
      }

      const msg = `${tableName} has ${rowCount} rows`;
      console.log(msg);
      logger.info(msg);
    }
  } finally {
    await closeDb();
  }

  if (!allOk) {
    const msg = "FCC import row counts failed the sanity check";
    console.error(msg);
    logger.error(msg);
  }

  return allOk;
}
