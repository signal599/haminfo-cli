import { createLogger, format, transports } from 'winston';
import { join } from 'path';
import { mkdirSync } from 'fs';
import { projectRoot } from './dir-helper.js';

const logDir = `${projectRoot}/logs`;
mkdirSync(logDir, { recursive: true });
const logFile = join(logDir, 'app.log');

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.File({ filename: logFile }),
  ],
});

// Also log to console if --verbose flag is set
if (process.env.VERBOSE) {
  logger.add(new transports.Console({
    format: format.combine(
      format.colorize(),
      format.simple()
    )
  }));
}

export default logger;
