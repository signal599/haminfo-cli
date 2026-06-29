import { and, eq, sql } from "drizzle-orm";
import { hamAddress, hamLocation } from "../../db/schema.js";
import { closeDb, getDb } from "../db-helper.js";
import { GEOCODE_STATUS_NOT_FOUND, GEOCODE_STATUS_PENDING, GEOCODE_STATUS_SUCCESS } from "../constants.js";
import logger from "../logger.js";
import { stripPoBox } from "../utils.js";
import { geocodeAddress, geocodeResult } from "../types.js";
import * as geocodio from "./geocodio.js";
import * as google from "./google.js";
import { randomUUID } from "crypto";
import { revalidateCache } from "../revalidate-cache.js";
import { deleteInactiveLocations } from "../imports/sql-updates.js";

export async function geocodeBatch() {
  if (!process.env.BATCH_GEOCODING_ENABLED) {
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

type batchResult = {
  success: number;
  total: number;
}

async function doBatch(): Promise<batchResult> {
  const batchResult = {
    success: 0,
    total: 0,
  };

  const addressesMap = await getAdddresses();
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

  if (someResults.failed.length) {
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

  await updateDatabase(addressesMap, successResults);
  await deleteInactiveLocations();
  batchResult.success = successResults.length;
  return batchResult;
}

async function updateDatabase(addressMap: Map<number, geocodeAddress>, successResults: geocodeResult[]) {
  const successMap = new Map<number, geocodeResult>();
  let successCount = 0;
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
      // Don't remove previous successful geocode. This might happen if we are re-processing
      // old records hoping to improve accuracy.
      continue;
    }

    await updateOneAddress(id, GEOCODE_STATUS_NOT_FOUND, null, null)
    notFound++;
  }

  logger.info(`${successCount} success | ${notFound} not found written to database`);
}

async function updateOneAddress(id: number, status: number, lat: number | null, lng: number | null) {
  const db = await getDb();
  let locationId = null;

  if ((status === GEOCODE_STATUS_SUCCESS) && lat && lng) {
    locationId = await getLocationId(lat, lng);
  }

  const now = Math.floor(Date.now() / 1000);

  await db.update(hamAddress).set({
    locationId: locationId,
    geocodeStatus: status,
    changed: now,
  })
    .where(eq(hamAddress.id, id));
}

export async function getLocationId(lat: number, lng: number): Promise<number | null> {
  const db = await getDb();

  const rows = await db.select({ id: hamLocation.id })
    .from(hamLocation)
    .where(sql`latitude = ${lat} AND longitude = ${lng}`);

  if (rows.length) {
    return rows[0].id;
  }

  const now = Math.floor(Date.now() / 1000);

  const result = await db.insert(hamLocation).values({
    uuid: randomUUID(),
    langcode: "en",
    userId: 1,
    latitude: lat.toString(),
    longitude: lng.toString(),
    status: 1,
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

async function getAdddresses(): Promise<Map<number, geocodeAddress>> {
  const db = await getDb();

  const rows = await db
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
      originalStatus: address.geocodeStatus || GEOCODE_STATUS_PENDING,
    });
  });

  return result;
}
