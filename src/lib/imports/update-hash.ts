import { closeDb, getDb } from "../db-helper.js";
import { sql } from "drizzle-orm";

export async function updateHash() {
  const db = await getDb();

  const rawSql = `
    UPDATE fcc_license_hd hd
    INNER JOIN fcc_license_en en ON en.unique_system_identifier = hd.unique_system_identifier
    INNER JOIN fcc_license_am am ON am.unique_system_identifier = hd.unique_system_identifier
    SET hd.total_hash = SHA1(CONCAT(hd.row_hash, en.row_hash, am.row_hash))`;

  const result = await db.execute(sql.raw(rawSql));

  console.log(`${result[0].affectedRows} hashes updated`);

  closeDb();
}
