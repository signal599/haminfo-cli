import Geocodio from "geocodio-library-node";

let client: Geocodio;

function getClient() {
  if (!client) {
    client = new Geocodio(process.env.GEOCODIO_API_KEY);
  }

  return client;
}

export async function geocode(address: string) {
  const client = getClient();
  return await client.geocode(address);
}
