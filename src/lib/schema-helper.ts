import { MySqlTable, TableConfig } from "drizzle-orm/mysql-core";
import { ImportColumnInfo, ImportSchema } from "./types.js";

export function getImportSchema(
  table: MySqlTable<TableConfig>,
  columns: string[],
): ImportSchema {

  const schema: ImportSchema = {};
  columns.forEach((column, index) => {
    const info = (table as Record<string, any>)[column];

    const properyInfo: ImportColumnInfo = {
      index,
      dbColumn: info.name,
      dataType: info.dataType,
      length: undefined,
    };

    if (info.dataType === "string") {
      properyInfo.length = info.config.length;
    }

    schema[column] = properyInfo;
  });

  return schema;
}
