import { addressType, geocodeAddress, geocodeResult } from "../types.js";
import { getSingleLineAddress } from "../utils.js";
import { GEOCODE_STATUS_NOT_FOUND, GEOCODE_STATUS_SUCCESS } from "../constants.js";

const url = "https://api.geocod.io/v2/geocode";
const ACCEPTED_ACCURACY_TYPES = ["rooftop", "point", "range_interpolation", "nearest_rooftop_match", "intersectio", "street_center"];
const ACCEPTED_ACCURACY = 0.8;

export async function geocode(addresses: string[]): Promise<{ code: number | null, data: any }> {
  let data = null;
  let code = null;

  try {
    const response = await fetch(`${url}?api_key=${process.env.GEOCODIO_API_KEY}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(addresses),
    });

    data = await response.json();
    code = response.status;
  }
  catch {
  }

  return { code, data };
}

export async function geocodeBatch(addresses: geocodeAddress[]): Promise<{
  code: number | null,
  results: geocodeResult[]
}> {

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
    return {
      code: response.code,
      results: results,
    }
  }

  response.data.results.forEach((item, index: number) => {
    const firstResponseResult = item.response.results[0];

    if (ACCEPTED_ACCURACY_TYPES.includes(firstResponseResult.accuracy_type) && firstResponseResult.accuracy >= ACCEPTED_ACCURACY) {
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
