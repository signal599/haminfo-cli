import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// If this file is at src/commands/import-raw.ts
// go up two levels to get project root
export const projectRoot = resolve(__dirname, '..', '..');
