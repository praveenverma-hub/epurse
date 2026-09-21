// appMeta.ts — identity/contact constants shared by About, Help & Support and
// Rate & Feedback. Not behaviour switches (those live in staticConfig.ts).
//
// Reads app.base.json (the real PROD identity: name "ePurse", package
// com.epurse.app), not the resolved runtime config from app.config.js — a
// dev-test/stage-test build's Play Store link and in-app "About ePurse" copy
// must still point at the one real published app, not that build's own
// variant-suffixed package name (see app.config.js).
import appJson from '../../app.base.json';

export const APP_NAME = appJson.expo.name;
export const APP_VERSION = appJson.expo.version;

export const SUPPORT_EMAIL = 'support@epurse.co.in';

// TODO: fill in the real numeric App Store id once ePurse is listed.
// STATIC_CONFIG.rating.enabled gates the "Rate ePurse" row until then.
export const APP_STORE_URL = 'https://apps.apple.com/app/idXXXXXXXXXX';
export const PLAY_STORE_URL = `https://play.google.com/store/apps/details?id=${appJson.expo.android.package}`;
