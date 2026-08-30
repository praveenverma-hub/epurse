// =============================================================================
// PARSE GATE — every source file must actually compile.
// -----------------------------------------------------------------------------
//   npm run test:parse
//
// This exists because the project had NO working syntax check, and a duplicate
// `const budget` shipped in DashboardScreen for two turns without anything
// catching it.
//
// Why the two obvious gates both missed it:
//   • `tsc --noEmit` runs with `allowJs` and WITHOUT `checkJs`, so it parses .js
//     files but performs no semantic analysis on them. A redeclared binding is an
//     early *semantic* error, not a parse error, so tsc reported a clean run.
//   • `npx babel --config-file ./babel.config.js <file>` fails on optional
//     chaining and TS syntax in this repo, so it "failed" on untouched files too
//     — which trained the eye to treat its output as noise. It was the wrong
//     invocation, not a broken codebase.
//
// The working recipe is `babel.parseSync` with `babel-preset-expo` and
// `configFile: false` (the project config adds the reanimated plugin, which is a
// transform and irrelevant to whether the file is valid).
//
// Keep this in `npm test`. It is the only thing standing between a typo and a
// red screen on device, and it is ~2s for the whole tree.
// =============================================================================
import { parseSync } from '@babel/core';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const C = { red: '\x1b[31m', green: '\x1b[32m', reset: '\x1b[0m' };
let pass = 0;
const failures = [];

const SOURCE = /\.(js|jsx|ts|tsx)$/;
const walk = (dir, out = []) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) {
      // Test files are run directly by node, so a syntax error in one is loud
      // and immediate — they don't need this gate.
      if (e.name !== 'node_modules' && e.name !== '__tests__') walk(p, out);
    } else if (SOURCE.test(e.name)) out.push(p);
  }
  return out;
};

const files = [...walk('src'), 'App.js'];

console.log(`\n── parsing ${files.length} source files ──\n`);
for (const f of files) {
  try {
    parseSync(readFileSync(f, 'utf8'), {
      filename: f,
      presets: [['babel-preset-expo', {}]],
      babelrc: false,
      configFile: false,
    });
    pass++;
  } catch (e) {
    failures.push({ f, msg: e.message.split('\n')[0].replace(`${process.cwd()}/`, '') });
  }
}

for (const { f, msg } of failures) console.log(`  ${C.red}✗ ${f}${C.reset}\n      ${msg}`);
if (!failures.length) console.log(`  ${C.green}✓ every source file compiles${C.reset}`);

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${failures.length === 0 ? C.green : C.red}${pass}/${files.length} passed${C.reset}`);
process.exit(failures.length === 0 ? 0 : 1);
