export type ImportColumnInfo = {
  index: number;
  dbColumn: string;
  dataType: string;
  length: number | undefined;
}

export type ImportSchema = Record<string, ImportColumnInfo>;

export type addressType = {
  id: number;
  street: string;
  city: string;
  state: string;
  zip: string;
  origGeocodeStatus: number;
  newGeocodeStatus: number;
}
