import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../db-helper.js";

export async function truncateTable(tableSuffix: string) {
  const tableName = `fcc_license_${tableSuffix.toLowerCase()}`;

  const db = await getDb();
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableName}`));
  await closeDb();
}
