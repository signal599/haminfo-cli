// It seems like this should work and is simpler than the version in use
// but it throws this error with the am.dat file.
// Claude says this is a bug in Node 24. I haven't found that anywhere else.
//
// node:internal/readline/interface:564
//       throw new ERR_USE_AFTER_CLOSE('readline');
//             ^

// Error [ERR_USE_AFTER_CLOSE]: readline was closed
//     at Interface.pause (node:internal/readline/interface:564:13)
//     at importFile (/Users/ross/sites/haminfo-cli/src/lib/imports/import-helper.ts:60:12)
//     at process.processTicksAndRejections (node:internal/process/task_queues:104:5) {
//   code: 'ERR_USE_AFTER_CLOSE'
// }

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

  const db = await getDb();
  await db.execute(sql.raw(`TRUNCATE TABLE ${tableName}`));

  const fd = await fs.open(filePath);
  const fileStream = fd.createReadStream();

  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  const batchSize = 1000;
  let batch = [];

  let lineNum = 0;

  try {
    for await (const row of rl) {
      lineNum++;

      const dataRow = row.split("|").map((item) => item.trim());
      const values = buildValues(importSchema, columns, dataRow);

      if (alterValues) {
        alterValues(row, dataRow, values);
      }

      batch.push(values);

      if (batch.length === batchSize) {
        await db.insert(table).values(batch);
        console.log(lineNum);
        batch = [];
      }
    }

    if (batch.length > 0) {
      await db.insert(table).values(batch);
      console.log(`Last: ${lineNum}`);
    }
  } finally {
    rl.close();
    fileStream.close();
    await fd.close();
  }

  await closeDb();
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
  values.rowHash = createHash("sha1").update(`${row}\r\n`).digest("hex");
}
