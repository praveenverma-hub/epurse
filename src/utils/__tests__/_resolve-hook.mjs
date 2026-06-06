// =============================================================================
// Node ESM resolve hook (test-only)
// -----------------------------------------------------------------------------
// The app source uses Metro-style extensionless relative imports
// (e.g. `import … from '../constants/categories'`). Metro/Babel resolve these
// at bundle time, but plain `node` (which runs the parser test) does not.
//
// This hook lets the test import the REAL, UNMODIFIED source files: when a
// relative specifier has no extension and fails to resolve, it retries with
// `.js` appended. Scoped to relative specifiers only — bare package imports are
// left to Node's normal resolution. This keeps production code byte-identical
// to the rest of the codebase (no `.js` extensions sprinkled in for tests).
// =============================================================================

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExt = /\.[mc]?[jt]sx?$/.test(specifier) || specifier.endsWith('.json');
    if (isRelative && !hasExt) {
      return await next(`${specifier}.js`, context);
    }
    throw err;
  }
}
