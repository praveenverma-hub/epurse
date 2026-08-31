// =============================================================================
// Node ESM resolve hook (test-only)
// -----------------------------------------------------------------------------
// The app source uses Metro-style extensionless relative imports
// (e.g. `import … from '../constants/categories'`). Metro/Babel resolve these
// at bundle time, but plain `node` (which runs the parser test) does not.
//
// This hook lets the test import the REAL, UNMODIFIED source files: when a
// relative specifier has no extension and fails to resolve, it retries with
// each source extension in turn. Scoped to relative specifiers only — bare
// package imports are left to Node's normal resolution. This keeps production
// code byte-identical to the rest of the codebase (no `.js` extensions
// sprinkled in for tests).
//
// `.ts`/`.tsx` are in the list because the codebase is mid-migration: a JS
// module importing a TS one extensionless (`constants/themes.js` →
// `config/staticConfig.ts`) resolved to a `.js` that doesn't exist and took the
// whole suite down with ERR_MODULE_NOT_FOUND. Order is `.js` first — it is still
// the common case, and trying it first keeps the happy path one attempt long.
// =============================================================================

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExt = /\.[mc]?[jt]sx?$/.test(specifier) || specifier.endsWith('.json');
    if (isRelative && !hasExt) {
      for (const ext of ['.js', '.ts', '.tsx']) {
        try {
          return await next(`${specifier}${ext}`, context);
        } catch { /* try the next extension */ }
      }
    }
    throw err;
  }
}
