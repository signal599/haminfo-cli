import { addressType, geocodeAddress } from "../types.js";
import { getSingleLineAddress } from "../utils.js";

export async function geocode(address: string) {
  const url = 'https://maps.googleapis.com/maps/api/geocode/json';

  const query = new URLSearchParams({
    address: address,
    key: process.env.GOOGLE_GEOCODE_API_KEY!
  });

  let data = null;

  try {
    const response = await fetch(`${url}?${query}`);
    data = await response.json();
  }
  catch {
  }

  return data;
}

function getFormattedAddressFromResponse(response: unknown): string | null {
  if (
    response === undefined ||
    response === null ||
    typeof response !== "object"
  ) {
    return null;
  }

  const r = response as Record<string, unknown>;

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

async function getFormattedAddress(address: string) {
  const response = await geocode(address);
  return getFormattedAddressFromResponse(response);
}

export async function batchGetFormattedAddresses(addresses: geocodeAddress[]): Promise<geocodeAddress[]> {
  if (!addresses.length) {
    return [];
  }
  
  const formattedAddresses: geocodeAddress[] = [];

  for (const address of addresses) {
    const formatted = await getFormattedAddress(address.address);
    formattedAddresses.push({
      id: address.id,
      address: formatted || "",
    });
  }

  return formattedAddresses;
}
