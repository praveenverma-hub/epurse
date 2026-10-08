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
// Store getters VERIFIED to reduce to a primitive, so they are safe to call
// inside a selector. Add here only after checking the getter's return.
const PRIMITIVE_STORE_GETTERS = new Set([
  'getMonthlySpend', 'getMonthlyIncome', 'getMonthlyRefunds',
  'getTotalLent', 'getTotalBorrowed',
]);
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
    // A selector that CALLS a store method is only safe if that method returns a
    // primitive — `s.getCategoryBreakdown(date)` builds a fresh collection and
    // looped the whole Insights tab. The call is opaque here, so known-primitive
    // getters are allowlisted and anything new must be checked and added.
    const methodCall = body.match(/=>\s*\w+\.(\w+)\s*\(/);
    if (methodCall && !PRIMITIVE_STORE_GETTERS.has(methodCall[1])) {
      const line = src.slice(0, m.index).split('\n').length;
      allocatingSelector.push(`${f}:${line}  s.${methodCall[1]}() — returns a collection? use useMemo, or allowlist it`);
      continue;
    }
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

// ── APIs removed by an RN upgrade ──────────────────────────────────────────
// `StyleSheet.absoluteFillObject` was REMOVED in React Native 0.86 (only
// `absoluteFill` remains). Reading it yields `undefined`, and React Native
// silently ignores `undefined` in a style array — `{...undefined}` is `{}` too.
// So every overlay using it quietly lost `position: 'absolute'` and dropped into
// normal flow: on the SDK-57 upgrade (Sep-19-26) that pushed the tab bar to 75%
// height, exposed LoginGate below it, and un-filled ProfileScreen's hero
// gradient. 38 usages, 27 files, and NOT ONE error or warning anywhere.
//
// Entries here are exact member expressions that no longer exist. Add to this
// list whenever an upgrade removes one — a removed API that fails silently is
// far more expensive than one that throws.
const REMOVED_APIS = [
  ['StyleSheet.absoluteFillObject', 'use StyleSheet.absoluteFill (removed in RN 0.86)'],
  // Not removed, but banned: dividers take their thickness from `DIVIDER_W` (theme.js)
  // so one token controls every separator. A raw hairline is ~1 device pixel and
  // disappears on the light `colors.divider` tint.
  ['StyleSheet.hairlineWidth', "use DIVIDER_W from constants/theme"],
];
const removedUsage = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  src.split('\n').forEach((line, i) => {
    for (const [api, advice] of REMOVED_APIS) {
      if (f.endsWith('constants/theme.js')) continue;
      if (line.includes(api)) removedUsage.push(`${f}:${i + 1}  ${api} — ${advice}`);
    }
  });
}
if (removedUsage.length) {
  failures.push({ f: 'removed-apis', msg: 'removed RN API still referenced — see below' });
  removedUsage.forEach((l) => console.log(`  ${C.red}✗ removed API${C.reset}\n      ${l}`));
} else {
  console.log(`  ${C.green}✓ no removed RN APIs referenced${C.reset}`);
  pass++;
}

// ── withSpring configs must be COMPLETE ────────────────────────────────────
// Reanimated 4 changed withSpring's defaults from mass 1 / stiffness 100 to
// mass 4 / stiffness 900 (SDK-57 upgrade). A PARTIAL config silently inherits
// them: the review-queue card's `{ damping: 16 }` went from a smooth settle
// (damping ratio ~0.8) to a wobble (~0.13), and five more animations drifted
// with it (Oct-9-26). Every config must name `mass` — inline, or in a same-file
// `const` it's passed by name. No config at all is the new defaults, so also flagged.
const partialSpring = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const call = /\bwithSpring\s*\(/g;
  let m;
  while ((m = call.exec(src))) {
    let i = call.lastIndex, depth = 1;
    while (i < src.length && depth) {
      if ('([{'.includes(src[i])) depth++;
      else if (')]}'.includes(src[i])) depth--;
      i++;
    }
    const args = src.slice(call.lastIndex, i - 1);
    // Second top-level argument = the config.
    let d = 0, cut = -1;
    for (let k = 0; k < args.length; k++) {
      if ('([{'.includes(args[k])) d++;
      else if (')]}'.includes(args[k])) d--;
      else if (args[k] === ',' && d === 0) { cut = k; break; }
    }
    let config = cut < 0 ? '' : args.slice(cut + 1).trim();
    const named = config.match(/^([A-Za-z_$][\w$]*)\s*(,|$)/);
    if (named) {
      const decl = src.match(new RegExp(`\\b${named[1]}\\s*=\\s*\\{[^}]*\\}`));
      config = decl ? decl[0] : `${named[1]} (not declared in this file — can't verify)`;
    }
    if (!/\bmass\s*:/.test(config)) {
      const line = src.slice(0, m.index).split('\n').length;
      partialSpring.push(`${f}:${line}  withSpring(${args.replace(/\s+/g, ' ').slice(0, 60)})`);
    }
  }
}
if (partialSpring.length) {
  failures.push({ f: 'spring-config', msg: 'withSpring config missing mass — see below' });
  partialSpring.forEach((l) => console.log(`  ${C.red}✗ withSpring without mass (Reanimated 4 default is 4)${C.reset}\n      ${l}`));
} else {
  console.log(`  ${C.green}✓ every withSpring config names its mass${C.reset}`);
  pass++;
}

console.log(`\n${'─'.repeat(34)}`);
console.log(`  ${failures.length === 0 ? C.green : C.red}${pass}/${files.length + 4} passed${C.reset}`);
process.exit(failures.length === 0 ? 0 : 1);
