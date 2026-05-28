export type ImportColumnInfo = {
  index: number;
  dbColumn: string;
  dataType: string;
  length: number | undefined;
}

export type ImportSchema = Record<string, ImportColumnInfo>;
