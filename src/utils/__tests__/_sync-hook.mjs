// =============================================================================
// Node ESM resolve hook (test-only) for the shared-group SCENARIO suite: on top of
// _store-hook.mjs, points src/sync's server, session and native leaves at the
// in-memory fakes, so the real groupSync / fold / crypto / store run end to end.
// =============================================================================
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './paths.mjs';

const here = (f) => pathToFileURL(`${PROJECT_ROOT}/src/utils/__tests__/${f}`).href;
const FROM_SYNC = {
  './api': here('_fakeSyncServer.mjs'),
  './session': here('_fakeSyncSession.mjs'),
  './report': here('_fakeSyncLeaves.mjs'),
  '../backup/random': here('_fakeSyncLeaves.mjs'),
};

export async function resolve(specifier, context, next) {
  if (context.parentURL?.includes('/src/sync/') && FROM_SYNC[specifier]) {
    return { url: FROM_SYNC[specifier], shortCircuit: true, format: 'module' };
  }
  return next(specifier, context);
}
