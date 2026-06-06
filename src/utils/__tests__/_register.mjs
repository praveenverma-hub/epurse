// Test bootstrap: register the extensionless-import resolve hook, then hand off
// to the parser test. Used via `node --import ./src/utils/__tests__/_register.mjs`.
import { register } from 'node:module';
register('./_resolve-hook.mjs', import.meta.url);
