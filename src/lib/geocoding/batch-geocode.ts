import { eq } from "drizzle-orm";
import { hamAddress } from "../../db/schema.js";
import { getDb } from "../db-helper.js";
import { GEOCODE_STATUS_PENDING } from "../constants.js";
import { MySql2Database } from "drizzle-orm/mysql2";

async function processBatch() {

  if (!process.env.BATCH_GEOCODING_ENABLED) {
    return;
  }

  const db = await getDb();
  getAdddresses(db)
}

async function getAdddresses(db: MySql2Database) {
  return db
    .select({
      id: hamAddress.id,
      street: hamAddress.addressAddressLine1,
      city: hamAddress.addressLocality,
      state: hamAddress.addressAdministrativeArea,
      zip: hamAddress.addressPostalCode,
      status: hamAddress.geocodeStatus
    })
    .from(hamAddress)
    .where(eq(hamAddress.geocodeStatus, GEOCODE_STATUS_PENDING))
    .orderBy(hamAddress.addressAdministrativeArea, hamAddress.id)
    .limit(parseInt(process.env.GEOCODE_BATCH_SIZE!));
}
