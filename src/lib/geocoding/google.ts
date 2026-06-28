import logger from "../logger.js";
import { geocodeAddress, requestResponse } from "../types.js";
import { getSingleLineAddress } from "../utils.js";

export async function geocode(address: string): Promise<requestResponse> {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';

  const query = new URLSearchParams({
    address: address,
    key: process.env.GOOGLE_GEOCODE_API_KEY!
  });

  const result = {
    code: -1,
    data: null,
  } as requestResponse;

  try {
    const response = await fetch(`${url}?${query}`);
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

function getFormattedAddressFromResponse(response: requestResponse): string | null {
  if (response.code !== 200) {
    return null;
  }

  const r = response.data as Record<string, unknown>;

  if (
    !Array.isArray(r.results) ||
    r.results.length === 0
  ) {
    return null;
  }

  const firstResult = r.results[0];

  if (
    typeof firstResult !== "object" ||
    firstResult === null ||
    typeof (firstResult as Record<string, unknown>).formatted_address !== "string"
  ) {
    return null;
  }

  return (firstResult as Record<string, unknown>).formatted_address as string;
}

export async function getFormattedAddress(address: string): Promise<{ code: number, address: string }> {
  const response = await geocode(address);

  return {
    code: response.code,
    address: getFormattedAddressFromResponse(response) || ""
  }
}

export async function batchGetFormattedAddresses(addresses: geocodeAddress[]): Promise<geocodeAddress[]> {
  if (!addresses.length) {
    return [];
  }

  const formattedAddresses: geocodeAddress[] = [];

  for (const address of addresses) {
    const result = await getFormattedAddress(address.address);
    if (result.code === 200) {
      formattedAddresses.push({
        id: address.id,
        address: result.address,
      });
    }
  }

  return formattedAddresses;
}
