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

// ── Rules of Hooks: never behind a short-circuit ────────────────────────────
// A hook inside `a && useThing()` is SKIPPED whenever `a` is falsy, so the hook
// COUNT changes between renders and React throws "rendered fewer hooks than
// expected" — the whole screen white-screens. This shipped (Sep-13-26) in
// `MonthlyRecapModal`/`WeeklyRecapModal` as
// `const visible = pending && show && useAutoModalQueue() === 'x';`
//
// Nothing else here catches it: it compiles, it type-checks, and every unit test
// passes, because the fault only exists at RENDER time with a particular value.
// Parsing every file already happens above, so the scan is nearly free.
const hookConditional = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  src.split('\n').forEach((line, i) => {
    // a hook call appearing AFTER a && / || / ? on the same line
    if (/(&&|\|\||\?)[^;\n]*\buse[A-Z]\w*\s*\(/.test(line)) {
      hookConditional.push(`${f}:${i + 1}  ${line.trim().slice(0, 76)}`);
    }
  });
}
if (hookConditional.length) {
  failures.push({ f: 'rules-of-hooks', msg: 'hook behind a short-circuit — see below' });
  hookConditional.forEach((l) => console.log(`  ${C.red}✗ hook behind a conditional${C.reset}\n      ${l}`));
} else {
  console.log(`  ${C.green}✓ no hook sits behind a short-circuit${C.reset}`);
  pass++;
}

// ── zustand selectors must never ALLOCATE ──────────────────────────────────
// zustand v5 reads through a plain `useSyncExternalStore`, which compares
// snapshots BY REFERENCE. A selector that builds a fresh array or object each
// call never equals itself, so React re-renders, re-reads and loops:
// "The result of getSnapshot should be cached" then "Maximum update depth
// exceeded". v4 memoised the selector and hid this entirely, so the whole class
// arrived at once with the SDK-57 upgrade (Sep-19-26) and white-screened the
// Dashboard.
//
// Nothing else catches it: it compiles, it type-checks, and all 2144 tests pass,
// because the fault only exists at RENDER time against a live store.
//
// Fix by defaulting OUTSIDE the selector (`?? EMPTY_ARRAY` from constants/empty),
// by wrapping the call in `useShallow`, or — when the result is a derived object
// — by selecting raw state and computing in a `useMemo`.
const allocatingSelector = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hook = /use[A-Z]\w*Store\s*\(/g;
  let m;
  while ((m = hook.exec(src))) {
    let i = hook.lastIndex, depth = 1;
    while (i < src.length && depth) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')') depth--;
      i++;
    }
    const body = src.slice(hook.lastIndex, i - 1);
    if (body.includes('useShallow')) continue;
    if (/\?\?\s*[[{]|\|\|\s*[[{]|=>\s*[[{]|\.(filter|map|sort|slice|concat|flatMap)\s*\(|Object\.(keys|values|entries)\s*\(/.test(body)) {
      const line = src.slice(0, m.index).split('\n').length;
      allocatingSelector.push(`${f}:${line}  ${body.replace(/\s+/g, ' ').slice(0, 70)}`);
    }
  }
}
if (allocatingSelector.length) {
  failures.push({ f: 'zustand-selectors', msg: 'selector allocates — see below' });
  allocatingSelector.forEach((l) => console.log(`  ${C.red}✗ selector returns a NEW reference${C.reset}\n      ${l}`));
} else {
  console.log(`  ${C.green}✓ no zustand selector allocates${C.reset}`);
  pass++;
}

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${failures.length === 0 ? C.green : C.red}${pass}/${files.length + 2} passed${C.reset}`);
process.exit(failures.length === 0 ? 0 : 1);
