import logger from "./logger.js";

export function isNumeric(value: string): boolean {
  return !isNaN(Number(value)) && value.trim() !== '';
}

// Environment variables are always strings, so a plain truthiness check treats
// "false" and "0" as enabled. Only explicit affirmative values count.
export function isEnvEnabled(name: string): boolean {
  const value = (process.env[name] ?? "").trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
}

// Write a log message for testing New Relic.
export function writeLog(message: string, level: string) {
  logger.log(level, message);
}

export function stripPoBox(street: string): string {
  // Some addresses are like 123 ABC St, PO Box 100. Remove the PO Box.
  const match = street.match(/,\s*?((po)|(p\.o\.))\s+?box\s.*$/i);
  return match ? street.replace(match[0], '').trim() : street;
}
