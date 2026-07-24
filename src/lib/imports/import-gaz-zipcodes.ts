import * as fs from "fs/promises";
import * as readline from "readline/promises";
import { resolve } from "path";
import { sql } from "drizzle-orm";
import { zipcodes } from "../../db/schema.js";
import { closeDb, getDb } from "../db-helper.js";
import logger from "../logger.js";

type zipcodeRow = {
  zipcode: string;
  lat: string;
  lng: string;
};

// Census Gazetteer ZCTA file columns we care about. The Census pads header
// names and fields with spaces in some years, so everything is trimmed and the
// columns are located by name rather than by position.
const zipcodeColumn = "GEOID";
const latColumn = "INTPTLAT";
const lngColumn = "INTPTLONG";

const batchSize = 1000;

export async function importGazZipcodes(filePath: string) {
  console.time("import");

  const fullPath = resolve(process.cwd(), filePath);

  // Connect before the file is streaming. readline starts emitting lines as
  // soon as the interface is created, so any await between createInterface and
  // the loop below would silently drop the lines read in the meantime.
  const db = await getDb();

  const fd = await fs.open(fullPath);
  const fileStream = fd.createReadStream();

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let indexes: Record<string, number> | null = null;
  let batch: zipcodeRow[] = [];
  let imported = 0;
  let skipped = 0;

  try {
    for await (const line of rl) {
      const fields = line.split("|").map((field) => field.trim());

      if (!indexes) {
        indexes = getColumnIndexes(fields);
        continue;
      }

      const row = buildRow(fields, indexes);

      if (!row) {
        skipped++;
        continue;
      }

      batch.push(row);

      if (batch.length >= batchSize) {
        await insertBatch(db, batch);
        imported += batch.length;
        batch = [];
        console.log(imported);
      }
    }

    if (batch.length) {
      await insertBatch(db, batch);
      imported += batch.length;
      console.log(imported);
    }
  } finally {
    rl.close();
    fileStream.close();
    await fd.close();
    await closeDb();
  }

  logger.info(`${imported} imported into zipcodes`, { skipped, file: fullPath });
  console.log(`${imported} imported, ${skipped} skipped`);
  console.timeEnd("import");
}

function getColumnIndexes(header: string[]) {
  const indexes: Record<string, number> = {};

  [zipcodeColumn, latColumn, lngColumn].forEach((column) => {
    const index = header.indexOf(column);

    if (index === -1) {
      throw new Error(`Column ${column} not found in header: ${header.join("|")}`);
    }

    indexes[column] = index;
  });

  return indexes;
}

function buildRow(fields: string[], indexes: Record<string, number>): zipcodeRow | null {
  const zipcode = fields[indexes[zipcodeColumn]] ?? "";
  // East longitudes carry an explicit "+" in the file (Guam, the Northern
  // Marianas), which MySQL will not accept in a decimal literal.
  const lat = stripPlus(fields[indexes[latColumn]] ?? "");
  const lng = stripPlus(fields[indexes[lngColumn]] ?? "");

  if (!/^\d{5}$/.test(zipcode) || !isDecimal(lat) || !isDecimal(lng)) {
    return null;
  }

  // The columns are decimal(10,7), so pass the values through as strings and
  // let MySQL do the conversion rather than round tripping through a float.
  return { zipcode, lat, lng };
}

function stripPlus(value: string) {
  return value.startsWith("+") ? value.slice(1) : value;
}

function isDecimal(value: string) {
  return /^-?\d+(\.\d+)?$/.test(value);
}

async function insertBatch(db: Awaited<ReturnType<typeof getDb>>, batch: zipcodeRow[]) {
  // The table is normally truncated first, but updating on a duplicate key
  // keeps a re-run against a populated table from failing part way through.
  await db
    .insert(zipcodes)
    .values(batch)
    .onDuplicateKeyUpdate({
      set: {
        lat: sql`values(${zipcodes.lat})`,
        lng: sql`values(${zipcodes.lng})`,
      },
    });
}
