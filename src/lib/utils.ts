import logger from "./logger.js";

export function isNumeric(value: string): boolean {
  return !isNaN(Number(value)) && value.trim() !== '';
}

// Write a log message for testing New Relic.
export function writeLog(message: string, level: string) {
  logger.log(level, message);
}
