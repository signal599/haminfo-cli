import { boolean } from "drizzle-orm/gel-core";
import { geocodeAddress, geocodeResult, requestResponse } from "../types.js";
import logger from "../logger.js";

const url = "https://api.geocod.io/v2/geocode";
// Geocodio's precise forward-geocoding accuracy types. The coarse ones
// (place, county, state) are deliberately excluded.
const ACCEPTED_ACCURACY_TYPES = ["rooftop", "point", "range_interpolation", "nearest_rooftop_match", "intersection", "street_center"];
const ACCEPTED_ACCURACY = 0.8;

export async function geocode(addresses: unknown[]): Promise<requestResponse> {
  const result = {
    code: -1,
    data: null,
  } as requestResponse;

  try {
    const response = await fetch(`${url}?api_key=${process.env.GEOCODIO_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(addresses),
    });

    result.data = await response.json();
    result.code = response.status;
  }
  catch {
  }

  if (result.code !== 200) {
    logger.error(`Geocodio response ${result.code}`);
  }

  return result;
}

export async function geocodeBatch(addresses: geocodeAddress[]): Promise<{ code: number | null, results: geocodeResult[] }> {
  const addressStrings: string[] = [];
  const results: geocodeResult[] = [];

  for (const address of addresses) {
    addressStrings.push(address.address);
    results.push({
      id: address.id,
      lat: null,
      lng: null,
    });
  }

  const response = await geocode(addressStrings);

  if (response.code !== 200) {
    // Nothing succeeded.
    return {
      code: response.code,
      results: results,
    }
  }

  response.data.results.forEach((item: any, index: number) => {
    if (!Array.isArray(item.response.results) || item.response.results.length === 0) {
      return;
    }

    // Geocodio says first result is always the most accurate.
    const firstResponseResult = item.response.results[0];

    if (ACCEPTED_ACCURACY_TYPES.includes(firstResponseResult.accuracy_type) && firstResponseResult.accuracy >= ACCEPTED_ACCURACY) {
      // Results are in the same order as the request.
      const result = results[index];
      result.lat = firstResponseResult.location.lat;
      result.lng = firstResponseResult.location.lng;
    }
  });

  return {
    code: response.code,
    results: results,
  }
}

export type zipGeocodeResult = {
  zipcode: string;
  found: boolean;
  lat: number | null;
  lng: number | null;
};

export async function geocodeZipBatch(zipcodes: string[]): Promise<{ code: number | null, results: zipGeocodeResult[] }> {
  // Geocodio batch geocoding takes an array of query objects; a postal_code
  // query returns the zip's place-level centroid.
  const payload = zipcodes.map((zipcode) => ({ postal_code: zipcode }));

  const results: zipGeocodeResult[] = zipcodes.map((zipcode) => ({
    zipcode,
    found: false,
    lat: null,
    lng: null,
  }));

  const response = await geocode(payload);

  if (response.code !== 200) {
    // Nothing succeeded.
    return { code: response.code, results };
  }

  // Batch results come back in request order, so index maps to the zip.
  response.data.results.forEach((item: any, index: number) => {
    if (!Array.isArray(item.response.results) || item.response.results.length === 0) {
      return;
    }

    // Geocodio says the first result is the most accurate. Unlike address
    // geocoding we do no accuracy filtering: place-level is exactly the
    // granularity a zip code should resolve to.
    const location = item.response.results[0].location;
    const result = results[index];
    result.found = true;
    result.lat = location.lat;
    result.lng = location.lng;
  });

  return { code: response.code, results };
}
