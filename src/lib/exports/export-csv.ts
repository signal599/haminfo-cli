import { createWriteStream } from "fs";
import { pipeline } from "stream/promises";
import { Transform } from "stream";
import { stringify } from "csv-stringify";
import mysql from "mysql2";
import { exportJob } from "../types.js";

const CSV_COLUMNS = [
  "callsign",
  "first_name",
  "last_name",
  "address",
  "city",
  "state",
  "zip",
  "operator_class",
  "is_club",
  "latitude",
  "longitude",
];

export async function writeExportCsv(job: exportJob, filePath: string): Promise<void> {
  const { where, params } = buildWhereClause(job);

  const query = `
    SELECT hs.callsign, hs.first_name, hs.last_name, hs.organization, hs.operator_class,
    ha.address__address_line1 AS address, ha.address__locality AS city,
    ha.address__administrative_area AS state, ha.address__postal_code AS zip,
    hl.latitude, hl.longitude
    FROM ham_station hs
    INNER JOIN ham_address ha ON ha.hash = hs.address_hash
    INNER JOIN ham_location hl ON hl.id = ha.location_id
    ${where}
    ORDER BY ha.address__administrative_area, hs.callsign
  `;

  const connection = mysql.createConnection(process.env.DATABASE_URL!);

  try {
    const rowStream = connection.query(query, params).stream();

    const toCsvRow = new Transform({
      objectMode: true,
      transform(row, _encoding, callback) {
        callback(null, {
          callsign: row.callsign,
          first_name: row.first_name,
          last_name: row.organization || row.last_name,
          address: row.address,
          city: row.city,
          state: row.state,
          zip: row.zip,
          operator_class: row.operator_class,
          is_club: row.organization ? 1 : 0,
          latitude: row.latitude,
          longitude: row.longitude,
        });
      },
    });

    const stringifier = stringify({
      header: true,
      columns: CSV_COLUMNS,
      delimiter: job.delimiter,
      quote: job.enclosure,
    });

    await pipeline(rowStream, toCsvRow, stringifier, createWriteStream(filePath));
  } finally {
    connection.end();
  }
}

function buildWhereClause(job: exportJob): { where: string; params: string[] } {
  const conditions: string[] = [];
  const params: string[] = [];

  if (job.state && job.state !== "**") {
    conditions.push("ha.address__administrative_area = ?");
    params.push(job.state);
  }

  if (job.zip) {
    conditions.push("ha.address__postal_code LIKE CONCAT(?, '%')");
    params.push(job.zip);
  }

  return {
    where: conditions.length ? `WHERE ${conditions.join(" AND ")}` : "",
    params,
  };
}
