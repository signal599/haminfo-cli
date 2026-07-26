import { eq, sql } from "drizzle-orm";
import { hamAddress, zipcodes } from "../../db/schema.js";
import { closeDb, getDb } from "../db-helper.js";
import { GEOCODE_STATUS_PENDING } from "../constants.js";
import { isEnvEnabled } from "../utils.js";
import logger from "../logger.js";
import * as geocodio from "./geocodio.js";

// Matches the scale of zipcodes.lat/lng, DECIMAL(10,7).
const COORD_DECIMALS = 7;

// Geocodio batch response codes we persist per zip: 200 = located,
// 422 = valid request but no match (not worth retrying).
const RESPONSE_CODE_SUCCESS = 200;
const RESPONSE_CODE_NOT_FOUND = 422;

export async function zipGeocodeBatch() {
  // An expected off-switch during rollout, so unlike BATCH_GEOCODING_ENABLED
  // this returns silently rather than warning.
  if (!isEnvEnabled("ZIP_GEOCODE_ENABLED")) {
    return;
  }

  const batchSize = parseInt(process.env.ZIP_GEOCODE_BATCH_SIZE ?? "", 10);

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    logger.error(`Zip geocoding skipped: ZIP_GEOCODE_BATCH_SIZE is not a positive integer (got '${process.env.ZIP_GEOCODE_BATCH_SIZE}')`);
    return;
  }

  let result;

  try {
    result = await doBatch(batchSize);
  }
  finally {
    await closeDb();
  }

  return result;
}

async function doBatch(batchSize: number): Promise<string | undefined> {
  const db = await getDb();

  // Station geocoding (the ham_address batch) has priority on the shared
  // Geocodio quota. Only defer to it when it is actually enabled.
  if (isEnvEnabled("BATCH_GEOCODING_ENABLED")) {
    const pending = await db
      .select({ id: hamAddress.id })
      .from(hamAddress)
      .where(eq(hamAddress.geocodeStatus, GEOCODE_STATUS_PENDING))
      .limit(1);

    if (pending.length) {
      logger.info("Zip geocoding deferred: ham_address stations are still pending");
      return;
    }
  }

  // Eligible = never attempted, or attempted but not a keeper. The leading
  // IS NULL is essential: without it MySQL three-valued logic makes NOT(...)
  // evaluate to NULL for fresh rows (response_code NULL), which would exclude
  // exactly the un-geocoded zips we want to process.
  const rows = await db
    .select({ zipcode: zipcodes.zipcode })
    .from(zipcodes)
    .where(sql`${zipcodes.responseCode} IS NULL OR NOT (
      (${zipcodes.responseCode} = ${RESPONSE_CODE_SUCCESS} AND ${zipcodes.lat} IS NOT NULL AND ${zipcodes.lng} IS NOT NULL)
      OR ${zipcodes.responseCode} = ${RESPONSE_CODE_NOT_FOUND}
    )`)
    .orderBy(zipcodes.zipcode)
    .limit(batchSize);

  if (!rows.length) {
    const summary = "Zip geocode: Total: 0 | Success: 0 | Not found: 0";
    logger.info(summary);
    return summary;
  }

  const zipList = rows.map((row) => row.zipcode);
  const response = await geocodio.geocodeZipBatch(zipList);

  if (response.code !== 200) {
    // Most likely 403: the daily free allocation is used up. No point retrying,
    // and we must not touch the table.
    logger.warn(`Zip geocoding stopped: Geocodio batch returned ${response.code}`);
    return;
  }

  let success = 0;
  let notFound = 0;

  for (const result of response.results) {
    if (result.found && result.lat !== null && result.lng !== null) {
      await db
        .update(zipcodes)
        .set({
          lat: result.lat.toFixed(COORD_DECIMALS),
          lng: result.lng.toFixed(COORD_DECIMALS),
          responseCode: RESPONSE_CODE_SUCCESS,
        })
        .where(eq(zipcodes.zipcode, result.zipcode));
      success++;
    }
    else {
      await db
        .update(zipcodes)
        .set({ responseCode: RESPONSE_CODE_NOT_FOUND })
        .where(eq(zipcodes.zipcode, result.zipcode));
      notFound++;
    }
  }

  const summary = `Zip geocode: Total: ${response.results.length} | Success: ${success} | Not found: ${notFound}`;
  logger.info(summary);
  return summary;
}
