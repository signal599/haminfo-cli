export const GEOCODE_STATUS_PENDING = 0;
export const GEOCODE_STATUS_SUCCESS = 1;
export const GEOCODE_STATUS_NOT_FOUND_RAW_ADDRESS = 2;
export const GEOCODE_STATUS_NOT_FOUND = 3;

export const EXPORT_STATUS_PENDING = 0;
export const EXPORT_STATUS_RUNNING = 1;
export const EXPORT_STATUS_COMPLETE = 2;
export const EXPORT_STATUS_FAILED = 3;

export const EXPORT_STALE_TIMEOUT_MINUTES = 30;

// Each FCC file holds around 1.6 million rows and is not expected to shrink.
// A count below this means the download or import went wrong, and the
// destructive updates that follow must not run against it.
export const MIN_IMPORT_ROWS = 1_500_000;
