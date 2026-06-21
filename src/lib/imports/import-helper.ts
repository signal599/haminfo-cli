import { createHash } from "crypto";
import { MySqlTable, TableConfig } from "drizzle-orm/mysql-core";
import * as fs from "fs/promises";
import * as readline from "readline/promises";
import { isNumeric } from "../utils.js";
import { ImportColumnInfo } from "../types.js";
import { getImportSchema } from "../schema-helper.js";
import { getTableConfig } from "drizzle-orm/mysql-core";
import { closeDb, getDb } from "../db-helper.js";
import { sql } from "drizzle-orm";
import logger from "../logger.js";
import { truncateTable } from "./sql-updates.js";

export type alterValuesType = (
  row: string,
  dataRow: string[],
  values: valuesType,
) => void;
export type valueType = string | number | null;
export type valuesType = Record<string, valueType>;

export async function importFile(
  table: MySqlTable<TableConfig>,
  columns: string[],
  filePath: string,
  alterValues: alterValuesType | undefined,
) {
  console.time("import");

  const importSchema = getImportSchema(table, columns);
  const { name: tableName } = getTableConfig(table);
  await truncateTable(tableName);

  const db = await getDb();

  const fd = await fs.open(filePath);
  const fileStream = fd.createReadStream();

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const batchSize = 1000;
  let buffer: valuesType[] = [];
  let paused = false;
  let done = false;
  let totalLines = 0;

  // Called by the consumer to process one batch
  let notifyConsumer: (() => void) | null = null;

  function waitForLines(): Promise<void> {
    return new Promise((resolve) => {
      notifyConsumer = resolve;
    });
  }

  rl.on("line", (row) => {
    const dataRow = row.split("|").map((item) => item.trim());
    const values = buildValues(importSchema, columns, dataRow);

    if (alterValues) {
      alterValues(row, dataRow, values);
    }

    buffer.push(values);

    if (buffer.length >= batchSize) {
      // We have at least enough for a batch.
      if (!paused) {
        paused = true;
        rl.pause();
      }

      if (notifyConsumer) {
        // The consumer is waiting. Wake it up.
        const notify = notifyConsumer;
        notifyConsumer = null;
        notify();
      }
    }
  });

  rl.on("close", () => {
    done = true;
    if (notifyConsumer) {
      // Wake consumer so it can drain the final partial batch
      const notify = notifyConsumer;
      notifyConsumer = null;
      notify();
    }
  });

  // Consumer loop
  while (!done || buffer.length > 0) {
    // Wait for a full batch unless we're at EOF
    if (buffer.length < batchSize && !done) {
      await waitForLines();
      continue;
    }

    // Take up to batchSize lines from the front of the buffer
    const batch = buffer.splice(0, batchSize);

    await db.insert(table).values(batch);

    totalLines += batch.length;
    console.log(totalLines);

    // Resume readline if we paused it
    if (paused && !done) {
      paused = false;
      rl.resume();
    }
  }

  fileStream.close();
  await fd.close();
  await closeDb();

  logger.info(`${totalLines} imported into ${tableName}`);
  console.timeEnd("import");
}

function buildValues(
  schema: Record<string, ImportColumnInfo>,
  columns: string[],
  dataRow: string[],
) {
  const values: valuesType = {};

  columns.forEach((column) => {
    const columnInfo = schema[column];
    let value: valueType = dataRow[columnInfo.index];

    if (columnInfo.dataType === "string") {
      value = value.substring(0, columnInfo.length);
    } else if (columnInfo.dataType === "number") {
      value = isNumeric(value) ? parseInt(value) : null;
    }

    values[column] = value;
  });

  return values;
}

export function addRowHash(row: string, dataRow: string[], values: valuesType) {
  values.rowHash = createHash("sha1").update(row).digest("hex");
}
