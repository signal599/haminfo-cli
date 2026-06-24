import { eq } from "drizzle-orm";
import { hamAddress } from "../../db/schema.js";
import { closeDb, getDb } from "../db-helper.js";
import { GEOCODE_STATUS_PENDING } from "../constants.js";
import { MySql2Database } from "drizzle-orm/mysql2";
import logger from "../logger.js";
import { stripPoBox } from "../utils.js";
import { addressType } from "../types.js";
import * as geocodio from "./geocodio.js";

export async function geocodeBatch() {
  if (!process.env.BATCH_GEOCODING_ENABLED) {
    return;
  }

  const db = await getDb();
  const result = await doBatch(db);
  await closeDb();
}

type batchResult = {
  success: number;
  total: number;
}

async function doBatch(db: MySql2Database): Promise<batchResult> {
  const result = {
      success: 0,
      total: 0,
    };

  const rawAddresses = await getAdddresses(db);
  result.total = rawAddresses.length;
  logger.info(`${result.total} to geocode`);

  if (!result.total) {
    return result;
  }

  const addresses: addressType[] = [];

  for (const rawAddress of rawAddresses) {
    addresses.push({
      id: rawAddress.id,
      street: stripPoBox(rawAddress.street || ""),
      city: rawAddress.city || "",
      state: rawAddress.state || "",
      zip: rawAddress.zip || "",
      origGeocodeStatus: rawAddress.geocodeStatus || GEOCODE_STATUS_PENDING,
      newGeocodeStatus: rawAddress.geocodeStatus || GEOCODE_STATUS_PENDING,
    });
  }

  geocodio.geocodeBatch(addresses);

  return result;
}

async function getAdddresses(db: MySql2Database): Promise<{
  id: number;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  geocodeStatus: number | null;
}[]> {
  return await db
    .select({
      id: hamAddress.id,
      street: hamAddress.addressAddressLine1,
      city: hamAddress.addressLocality,
      state: hamAddress.addressAdministrativeArea,
      zip: hamAddress.addressPostalCode,
      geocodeStatus: hamAddress.geocodeStatus,
    })
    .from(hamAddress)
    .where(eq(hamAddress.geocodeStatus, GEOCODE_STATUS_PENDING))
    .orderBy(hamAddress.addressAdministrativeArea, hamAddress.id)
    .limit(parseInt(process.env.GEOCODE_BATCH_SIZE!));
}
