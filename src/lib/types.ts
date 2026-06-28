export type ImportColumnInfo = {
  index: number;
  dbColumn: string;
  dataType: string;
  length: number | undefined;
}

export type ImportSchema = Record<string, ImportColumnInfo>;

export type geocodeAddress = {
  id: number;
  address: string;
}

export type geocodeResult = {
  id: number;
  lat: number | null;
  lng: number | null;
}
