// =============================================================================
// Node ESM loader hook (test-only) for STORE integration tests.
// -----------------------------------------------------------------------------
// Lets a plain `node` process import the REAL ePurseStore.js by:
//   1. resolving Metro-style extensionless relative imports (.js then .ts),
//   2. transforming .ts/.tsx source with babel (merchantEnricher, twoTierCategories,
//      useNotificationStore types) on the fly,
//   3. stubbing React-Native / Expo-only modules that can't load headlessly
//      (AsyncStorage → in-memory, notifications → no-ops, useNotificationStore →
//      no-op proxy, buildVariant → IS_PREVIEW_BUILD=false to avoid __DEV__).
// The store's own logic (ingest, dedup, balances, mask-merge, self-transfer) runs
// byte-identical to production — only the leaf native deps are swapped.
// =============================================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import babel from '@babel/core';

const STUBS = {
  asyncStorage:
    'const s=new Map();' +
    'export default {getItem:async k=>s.has(k)?s.get(k):null,setItem:async(k,v)=>{s.set(k,String(v));},' +
    'removeItem:async k=>{s.delete(k);},clear:async()=>{s.clear();},getAllKeys:async()=>[...s.keys()],' +
    'multiRemove:async ks=>{ks.forEach(k=>s.delete(k));}};',
  // ASYNC, matching the real notifications.js signatures — every one of these
  // is `async function` in production, and two call sites in the store chain
  // `.catch(() => {})` straight onto the result (checkBudgetBreach,
  // maybeFireMidmonthNudge). A synchronous stub returns `undefined`, and
  // `undefined.catch` crashes the whole test process the first time a test
  // actually triggers a budget breach or a mid-month nudge — found while
  // writing e2eJourney.test.mjs, which is the first suite to cross a budget
  // cap under ingestMessage.
  // Every fire/schedule fn also RECORDS its name on `globalThis.__notifCalls`, so
  // a test can assert a nudge really was (or wasn't) sent — the per-nudge
  // on/off switches are otherwise untestable: a suppressed notification and a
  // fired one both look like "nothing happened" from the store's own state.
  notifications:
    'const rec=(n)=>{(globalThis.__notifCalls ||= []).push(n);};' +
    'export const fireBudgetBreachNotification=async()=>{rec("budgetBreach");};' +
    'export const fireMidmonthNudgeNotification=async()=>{rec("midmonthNudge");};' +
    'export const fireCCPaymentNotification=async()=>{rec("ccPayment");};' +
    // Returns an ID, not null: returning null short-circuited the whole `.then()`
    // in ingestMessage's cc_due branch, so the code that mirrors a card bill into
    // the reminder registry was never executed by ANY test — which is how a missing
    // `formatCurrency` import survived in there. Same trap as the parseDueDate stub.
    'export const scheduleCCBillDueReminder=async()=>{rec("ccBillDue");return "notif_cc";};' +
    'export const cancelScheduledNotification=async()=>{};' +
    'export const fireSubscriptionHikeNotification=async()=>{rec("subscriptionHike");return null;};' +
    'export const fireMonthlyRecapNotification=async()=>{rec("monthlyRecap");return null;};' +
    'export const fireCcCycleHeadsUpNotification=async()=>{rec("ccCycleHeadsUp");return null;};' +
    // Returns a UNIQUE id per call, unlike the other stubs: the reminder registry
    // stores these and a test asserts on how many occurrences got armed, which a
    // constant would make indistinguishable from "scheduled once".
    // `globalThis.__notifDenied` makes it refuse, the way the real one does when
    // permission has been revoked — the failure path that used to eat records.
    'let __n=0; export const scheduleReminderAt=async()=>' +
      '(globalThis.__notifDenied ? null : `notif_${++__n}`);' +
    'export const parseDueDate=()=>null;',
  notifStore:
    'export const useNotificationStore={getState:()=>new Proxy({},{get:()=>()=>{}}),setState:()=>{},subscribe:()=>()=>{}};',
  buildVariant: 'export const IS_PREVIEW_BUILD=false;',
  // ── SMS-sync leaves (used by smsSync.test.mjs) ────────────────────────────
  // Every one reads `globalThis.__smsStub` at CALL time, not at module load, so a
  // test can change the device's answers between cases. `Platform` is a shared
  // object so `Platform.OS = 'ios'` from a test is visible here too.
  // Inert for the store suite: ePurseStore imports none of these.
  reactNative:
    'export const Platform={OS:"android"};' +
    'export const AppState={addEventListener:()=>({remove(){}})};',
  smsService:
    'const S=()=>globalThis.__smsStub||{};' +
    'export let smsSupported=true;' +
    'export const __setSupported=(v)=>{smsSupported=v;};' +
    'export const hasSmsPermission=async()=>S().osPermission!==false;' +
    'export const readInbox=async(since)=>{const s=S();' +
    'if(s.throwOnRead)throw new Error("readInbox timed out");' +
    // `readDelayMs` holds the sweep open, so a test can observe the state while
    // one is genuinely IN FLIGHT — the only way to prove that a concurrent
    // 'busy' caller does not settle the first-sweep signal early.
    'if(s.readDelayMs)await new Promise((r)=>setTimeout(r,s.readDelayMs));' +
    's.readCount=(s.readCount||0)+1;s.lastSince=since;' +
    'return s.inbox||[];};' +
    'export const subscribeToIncomingSms=(cb)=>{S().liveCb=cb;return ()=>{S().liveCb=null;};};',
  locationService: 'export const getLocationIfGranted=async()=>null;',
};

function stubFor(specifier) {
  if (specifier.includes('@react-native-async-storage/async-storage')) return STUBS.asyncStorage;
  if (/(^|\/)utils\/notifications$/.test(specifier) || specifier.endsWith('/notifications')) return STUBS.notifications;
  if (specifier.includes('useNotificationStore')) return STUBS.notifStore;
  if (specifier.includes('constants/buildVariant') || specifier.endsWith('/buildVariant')) return STUBS.buildVariant;
  if (specifier === 'react-native') return STUBS.reactNative;
  if (/services\/smsService$/.test(specifier)) return STUBS.smsService;
  if (/services\/locationService$/.test(specifier)) return STUBS.locationService;
  return null;
}

export async function resolve(specifier, context, next) {
  if (stubFor(specifier)) {
    return { url: 'stub:' + Buffer.from(specifier).toString('hex'), shortCircuit: true, format: 'module' };
  }
  try {
    return await next(specifier, context);
  } catch (err) {
    const isRel = specifier.startsWith('./') || specifier.startsWith('../');
    const hasExt = /\.[mc]?[jt]sx?$/.test(specifier) || specifier.endsWith('.json');
    if (isRel && !hasExt) {
      try { return await next(specifier + '.js', context); }
      catch { return await next(specifier + '.ts', context); }
    }
    throw err;
  }
}

export async function load(url, context, next) {
  if (url.startsWith('stub:')) {
    const spec = Buffer.from(url.slice(5), 'hex').toString();
    return { format: 'module', shortCircuit: true, source: stubFor(spec) };
  }
  if (/\.tsx?$/.test(url)) {
    const path = fileURLToPath(url);
    const src = readFileSync(path, 'utf8');
    // preset-typescript only strips TS types and leaves ESM import/export intact (these
    // .ts files have no JSX), so Node still sees the real named exports.
    const out = babel.transformSync(src, {
      filename: path,
      configFile: false,   // ignore the project's babel.config.js (its expo preset → CJS)
      babelrc: false,
      presets: [['@babel/preset-typescript', { onlyRemoveTypeImports: true }]],
      sourceMaps: false,
    });
    return { format: 'module', shortCircuit: true, source: out.code };
  }
  return next(url, context);
}
