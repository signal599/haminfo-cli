export type ImportColumnInfo = {
  index: number;
  dbColumn: string;
  dataType: string;
  length: number | undefined;
}

export type ImportSchema = Record<string, ImportColumnInfo>;

export type requestResponse = { 
  code: number;
  data: any;
}

export type geocodeAddress = {
  id: number;
  address: string;
  originalStatus: number | undefined;
}

export type geocodeResult = {
  id: number;
  lat: number | null;
  lng: number | null;
}
