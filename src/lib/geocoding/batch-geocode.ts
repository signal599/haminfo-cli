import { eq } from "drizzle-orm";
import { hamAddress } from "../../db/schema.js";
import { closeDb, getDb } from "../db-helper.js";
import { GEOCODE_STATUS_PENDING } from "../constants.js";
import { MySql2Database } from "drizzle-orm/mysql2";
import logger from "../logger.js";
import { stripPoBox } from "../utils.js";
import { geocodeAddress, geocodeResult } from "../types.js";
import * as geocodio from "./geocodio.js";
import * as google from "./google.js";

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
  const batchResult = {
    success: 0,
    total: 0,
  };

  const addressesMap = await getAdddresses(db);
  batchResult.total = addressesMap.size;
  logger.info(`${batchResult.total} to geocode`);

  if (!batchResult.total) {
    return batchResult;
  }

  let someResults = await geocodeSomeAddresses([...addressesMap.values()], addressesMap);
  let successResults: geocodeResult[] = someResults.success;

  if (someResults.failed.length) {
    const formattedAddresses = await google.batchGetFormattedAddresses(someResults.failed);
    const retryAddresses: geocodeAddress[] = [];

    for (const address of formattedAddresses) {
      const formatted = address.address;
      const original = addressesMap.get(address.id)!.address;

      if (formatted.toLowerCase() !== original.toLowerCase()) {
        retryAddresses.push({
          id: address.id,
          address: formatted,
        })
      }
    }

    someResults = await geocodeSomeAddresses(retryAddresses, addressesMap);
    successResults = [...successResults, ...someResults.success];
  }

  console.log(successResults);
  batchResult.success = successResults.length;
  return batchResult;
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
    logger.error(`Geocodio response ${response.code}`)
    return results;
  }

  for (const result of response.results) {
    if (result.lat) {
      results.success.push(result);
    }
    else {
      results.failed.push({
        id: result.id,
        address: addressesMap.get(result.id)!.address,
      });
    }
  }

  return results;
}

async function getAdddresses(db: MySql2Database): Promise<Map<number, geocodeAddress>> {
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
    });
  });

  return result;
}
