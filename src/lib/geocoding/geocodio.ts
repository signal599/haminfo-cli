import { boolean } from "drizzle-orm/gel-core";
import { geocodeAddress, geocodeResult, requestResponse } from "../types.js";
import logger from "../logger.js";

const url = "https://api.geocod.io/v2/geocode";
const ACCEPTED_ACCURACY_TYPES = ["rooftop", "point", "range_interpolation", "nearest_rooftop_match", "intersectio", "street_center"];
const ACCEPTED_ACCURACY = 0.8;

export async function geocode(addresses: string[]): Promise<requestResponse> {
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
