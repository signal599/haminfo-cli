import { getTableConfig } from "drizzle-orm/mysql-core";
import { getImportSchema } from "../schema-helper.js";
import { ImportColumnInfo } from "../types.js";
import { isNumeric } from "../utils.js";
import * as fs from "fs";
import * as readline from "readline";
import { closeDb, getDb } from "../db-helper.js";
import { sql } from "drizzle-orm";
import { MySqlTable, TableConfig } from "drizzle-orm/mysql-core";
import { createHash } from "crypto";

export type alterValuesType = (
  row: string,
  dataRow: string[],
  values: valuesType,
) => void;
export type valueType = string | number | null;
export type valuesType = Record<string, valueType>;

async function readLines(
  filePath: string,
  onLine: (line: string) => Promise<void>,
) {
  return new Promise<void>((resolve, reject) => {
    const fileStream = fs.createReadStream(filePath);
    const rl = readline.createInterface({
      input: fileStream,
      crlfDelay: Infinity,
    });

    let pending = Promise.resolve();

    rl.on("line", (line) => {
      pending = pending.then(() => onLine(line)).catch(reject);
    });

    rl.on("close", () => {
      pending.then(resolve).catch(reject);
    });

    rl.on("error", reject);
    fileStream.on("error", reject);
  });
}

export async function importFile(
  table: MySqlTable<TableConfig>,
  columns: string[],
  filePath: string,
  alterValues: alterValuesType | undefined,
) {
  const startTime = Date.now();

  try {
    const importSchema = getImportSchema(table, columns);
    const { name: tableName } = getTableConfig(table);

    const db = await getDb();
    await db.execute(sql.raw(`TRUNCATE TABLE ${tableName}`));

    let count = 0;
    const batchSize = 1000;
    let batchValues: valuesType[] = [];

    await readLines(filePath, async (row) => {
      const dataRow = row.split("|").map(item => item.trim());
      const values = buildValues(importSchema, columns, dataRow);

      if (alterValues) {
        alterValues(row, dataRow, values);
      }

      batchValues.push(values);
      count++;

      if (batchValues.length === batchSize) {
        await db.insert(table).values(batchValues as []);
        batchValues = [];
        console.log(count);
      }
    });

    if (batchValues.length > 0) {
      await db.insert(table).values(batchValues as []);
      console.log(count);
    }
  } finally {
    await closeDb();
  }

  const elapsed = Date.now() - startTime;
  console.log(`Elapsed: ${elapsed}ms`);
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
  values.rowHash = createHash("sha1").update(`${row}\r\n`).digest("hex");
}