import { and, eq, inArray, SQL } from "drizzle-orm";
import { MySqlColumn } from "drizzle-orm/mysql-core";
import { hamAddress, hamLocation } from "../../db/schema.js";
import { closeDb, getDb } from "../db-helper.js";
import { GEOCODE_STATUS_NOT_FOUND, GEOCODE_STATUS_NOT_FOUND_RAW_ADDRESS, GEOCODE_STATUS_PENDING, GEOCODE_STATUS_SUCCESS } from "../constants.js";
import logger from "../logger.js";
import { isEnvEnabled, stripPoBox } from "../utils.js";
import { geocodeAddress, geocodeResult } from "../types.js";
import * as geocodio from "./geocodio.js";
import * as google from "./google.js";
import { revalidateCache } from "../revalidate-cache.js";
import { deleteInactiveLocations } from "../imports/sql-updates.js";

export async function geocodeBatch() {
  if (!isEnvEnabled("BATCH_GEOCODING_ENABLED")) {
    // Logged rather than returning silently: this runs hourly from cron, so a
    // misconfigured value would otherwise stop geocoding with no trace.
    logger.warn("Batch geocoding skipped: BATCH_GEOCODING_ENABLED is not set to a value such as 'true' or '1'");
    return;
  }

  let result

  try {
    result = await doBatch();
  }
  finally {
    await closeDb();
  }

  if (result && result.total) {
    revalidateCache();
  }

  return result;
}

// Matches the scale of ham_location.latitude/longitude, DECIMAL(10,7).
const LOCATION_DECIMALS = 7;

type batchResult = {
  success: number;
  total: number;
}

async function doBatch(): Promise<batchResult> {
  const batchResult = {
    success: 0,
    total: 0,
  };

  const addressesMap = await getAddresses();
  batchResult.total = addressesMap.size;
  logger.info(`${batchResult.total} addresses to geocode`);

  if (!batchResult.total) {
    return batchResult;
  }

  let someResults = await geocodeSomeAddresses([...addressesMap.values()], addressesMap);

  if (someResults.code !== 200) {
    // Request failed. Probably exceeded daily limit so no point in retrying.
    // Do not update database.
    return batchResult;
  }

  logger.info(`${someResults.success.length} out of ${batchResult.total} addresses successfully geocoded`);

  // Collect the successful responses.
  let successResults: geocodeResult[] = someResults.success;

  // Google address cleanup is optional. When enabled, failed Geocodio lookups are sent
  // to Google for a cleaned-up address and retried at Geocodio. When disabled, failures
  // are recorded (see updateDatabase) so they can be retried once cleanup is turned back on.
  const cleanupEnabled = isEnvEnabled("GEOCODE_ADDRESS_CLEANUP_ENABLED");

  if (cleanupEnabled && someResults.failed.length) {
    logger.info(`Trying Google for ${someResults.failed.length} addresses`);

    // Some failed so see if we can get a better formatted address from Google.
    // We can't store location results from Google because of terms and conditions but
    // sometimes it can provide a cleaner address.
    const formattedAddresses = await google.batchGetFormattedAddresses(someResults.failed);
    const retryAddresses: geocodeAddress[] = [];

    for (const address of formattedAddresses) {
      const formatted = address.address;
      const original = getGeocodeAddress(address.id, addressesMap).address;

      if (formatted.toLowerCase() !== original.toLowerCase()) {
        // We have a different address to we'll retry.
        retryAddresses.push({
          id: address.id,
          address: formatted,
          originalStatus: undefined,
        })
      }
    }

    logger.info(`Found ${retryAddresses.length} different addresses. Retrying Geocodio`);

    if (retryAddresses.length) {
      // Retry with better addresses.
      someResults = await geocodeSomeAddresses(retryAddresses, addressesMap);

      if (someResults.success.length) {
        logger.info(`${someResults.success.length} more successfully geocoded`);
        // Add to success results.
        successResults = [...successResults, ...someResults.success];
        logger.info(`${successResults.length} out of ${batchResult.total} addresses successfully geocoded`);
      }
      else {
        logger.info("No more successes");
      }
    }
  }

  await updateDatabase(addressesMap, successResults, cleanupEnabled);
  await deleteInactiveLocations();
  batchResult.success = successResults.length;
  return batchResult;
}

async function updateDatabase(addressMap: Map<number, geocodeAddress>, successResults: geocodeResult[], cleanupEnabled: boolean) {
  const successMap = new Map<number, geocodeResult>();
  let successCount = 0;
  let preservedCount = 0;
  let notFound = 0;

  for (const address of successResults) {
    successMap.set(address.id, address);
  }

  for (const [id, address] of addressMap) {
    const successResult = successMap.get(id);

    if (successResult) {
      await updateOneAddress(id, GEOCODE_STATUS_SUCCESS, successResult.lat!, successResult.lng!)
      successCount++;
      continue;
    }

    if (address.originalStatus === GEOCODE_STATUS_SUCCESS) {
      // Never downgrade a previous success (e.g. a re-geocode that now fails). Keep the
      // coordinates and status, but bump geocode_time so the row rolls to the back of the
      // re-geocode cycle instead of being reselected every run.
      await touchGeocodeTime(id);
      preservedCount++;
      continue;
    }

    // A genuine failure. When cleanup was off, a fresh (PENDING) address is only a
    // raw-address failure worth retrying once cleanup is back on; anything else has been
    // fully exhausted.
    const status = (!cleanupEnabled && address.originalStatus === GEOCODE_STATUS_PENDING)
      ? GEOCODE_STATUS_NOT_FOUND_RAW_ADDRESS
      : GEOCODE_STATUS_NOT_FOUND;

    await updateOneAddress(id, status, null, null)
    notFound++;
  }

  logger.info(`${successCount} success | ${preservedCount} preserved | ${notFound} not found written to database`);
}

async function updateOneAddress(id: number, status: number, lat: number | null, lng: number | null) {
  const db = await getDb();
  let locationId = null;
  let provider: string | null = null;

  if ((status === GEOCODE_STATUS_SUCCESS) && lat && lng) {
    locationId = await getLocationId(lat, lng);
    // 'gc' marks a Geocodio result. Informational only, used for the odd manual query.
    provider = "gc";
  }

  const now = Math.floor(Date.now() / 1000);

  await db.update(hamAddress).set({
    locationId: locationId,
    geocodeProvider: provider,
    geocodeStatus: status,
    geocodeTime: now,
  })
    .where(eq(hamAddress.id, id));
}

// Bump geocode_time without touching the result, so a preserved row moves to the back of
// the re-geocode cycle. Used when a re-geocode fails but we keep the previous success.
async function touchGeocodeTime(id: number) {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);

  await db.update(hamAddress).set({ geocodeTime: now })
    .where(eq(hamAddress.id, id));
}

async function getLocationId(lat: number, lng: number): Promise<number | null> {
  const db = await getDb();

  // Round to the column's scale before both the lookup and the insert. MySQL
  // rounds a longer value on insert, so searching with the unrounded one misses
  // the row it would round into, and the insert that follows then trips the
  // unique key on (latitude, longitude) and aborts the batch.
  const latitude = lat.toFixed(LOCATION_DECIMALS);
  const longitude = lng.toFixed(LOCATION_DECIMALS);

  const rows = await db.select({ id: hamLocation.id })
    .from(hamLocation)
    .where(and(
      eq(hamLocation.latitude, latitude),
      eq(hamLocation.longitude, longitude),
    ));

  if (rows.length) {
    return rows[0].id;
  }

  const now = Math.floor(Date.now() / 1000);

  const result = await db.insert(hamLocation).values({
    latitude,
    longitude,
    created: now,
    changed: now,
  });

  return result[0].insertId;
}

type resultType = {
  code: number | null,
  success: geocodeResult[],
  failed: geocodeAddress[],
}

async function geocodeSomeAddresses(addresses: geocodeAddress[], addressesMap: Map<number, geocodeAddress>): Promise<resultType> {
  const response = await geocodio.geocodeBatch(addresses);

  const results = {
    code: response.code,
    success: [],
    failed: [],
  } as resultType;

  if (response.code !== 200) {
    return results;
  }

  for (const result of response.results) {
    if (result.lat) {
      results.success.push(result);
    }
    else {
      results.failed.push({
        id: result.id,
        address: getGeocodeAddress(result.id, addressesMap).address,
        originalStatus: undefined
      });
    }
  }

  return results;
}

function getGeocodeAddress(id: number, addressMap: Map<number, geocodeAddress>): geocodeAddress {
  return addressMap.get(id)!;
}

type addressRow = {
  id: number;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  geocodeStatus: number | null;
}

async function getAddresses(): Promise<Map<number, geocodeAddress>> {
  const batchSize = parseInt(process.env.GEOCODE_BATCH_SIZE!);
  const cleanupEnabled = isEnvEnabled("GEOCODE_ADDRESS_CLEANUP_ENABLED");

  // Query 1: forward geocoding. New (PENDING) addresses always; when cleanup is on, also
  // the raw-address failures parked while it was off. geocode_status ascending keeps
  // PENDING (0) ahead of NOT_FOUND_RAW_ADDRESS (2), so fresh imports take priority over
  // the retry backlog; state is secondary so progress can be watched by state.
  const forwardStatuses = cleanupEnabled
    ? [GEOCODE_STATUS_PENDING, GEOCODE_STATUS_NOT_FOUND_RAW_ADDRESS]
    : [GEOCODE_STATUS_PENDING];

  const forwardRows = await selectAddresses(
    and(
      eq(hamAddress.noGeocode, 0),
      inArray(hamAddress.geocodeStatus, forwardStatuses),
    ),
    [hamAddress.geocodeStatus, hamAddress.addressAdministrativeArea, hamAddress.id],
    batchSize,
  );

  const result = buildAddressMap(forwardRows);

  // Query 2: fill any remaining batch capacity with the rolling re-geocode of already
  // completed rows, oldest first. Its statuses are disjoint from query 1, so no overlap.
  const remaining = batchSize - forwardRows.length;

  if (remaining > 0 && isEnvEnabled("GEOCODE_REGEOCODE_ENABLED")) {
    const regeocodeRows = await selectAddresses(
      and(
        eq(hamAddress.noGeocode, 0),
        inArray(hamAddress.geocodeStatus, [GEOCODE_STATUS_SUCCESS, GEOCODE_STATUS_NOT_FOUND]),
      ),
      [hamAddress.geocodeTime, hamAddress.id],
      remaining,
    );

    for (const [id, address] of buildAddressMap(regeocodeRows)) {
      result.set(id, address);
    }
  }

  return result;
}

async function selectAddresses(where: SQL | undefined, orderBy: (SQL | MySqlColumn)[], limit: number): Promise<addressRow[]> {
  const db = await getDb();

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
    .where(where)
    .orderBy(...orderBy)
    .limit(limit);
}

function buildAddressMap(rows: addressRow[]): Map<number, geocodeAddress> {
  const result = new Map<number, geocodeAddress>();

  rows.forEach(address => {
    const parts: string[] = [];
    parts.push(stripPoBox(address.street || ""));
    parts.push(address.city || "");
    const zip = (address.zip || "").substring(0, 5);
    parts.push(`${address.state || ""} ${zip}`);
    parts.push('USA');

    result.set(address.id, {
      id: address.id,
      address: parts.join(", "),
      originalStatus: address.geocodeStatus ?? GEOCODE_STATUS_PENDING,
    });
  });

  return result;
}
