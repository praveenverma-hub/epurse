import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

export const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
