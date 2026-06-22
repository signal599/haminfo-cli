import Geocodio from "geocodio-library-node";
import { addressType } from "../types.js";

let client: Geocodio;

function getClient() {
  if (!client) {
    client = new Geocodio(process.env.GEOCODIO_API_KEY);
  }

  return client;
}

export async function geocode(address: string) {
  let data = null;

  try {
    const client = getClient();
    data = await client.geocode(address);
  }
  catch {
  }

  return data;
}

export async function geocodeBatch(addresses: addressType[]) {

}
