# ePurse

A premium personal-finance mobile app built with **React Native + Expo**.

ePurse merges multiple simulated accounts (Bank, Credit Card, Digital Wallet, Cash) into a single "purse" view, auto-categorises spending from SMS / notification messages, and tracks informal IOUs between you and friends.

> Inspired by the clean, card-based aesthetic of apps like Swiggy — soft shadows, gradient headers, boxed white cards on a light grey background, and emoji-driven iconography (no heavy bitmaps).

---

## Features

- **Centralised state ("ePurse")** — Zustand store persisted to `AsyncStorage`. Merges accounts, transactions, categories, and lent/borrowed entries.
- **SMS / notification parser** — extracts amount, account mask, merchant, and intent (`debited`, `spent`, `credited`) and maps it to a category via keyword dictionary.
- **Manual entry FAB** — orange gradient floating action button on the dashboard.
- **Default + custom categories** — Food, Travel, Bills, Shopping plus a colour-and-emoji picker for new ones.
- **Dashboard** — gradient header with total ePurse balance, account chips, Lent/Borrowed widgets, quick actions, and recent boxed transaction cards.
- **Analytics** — month switcher, SVG bar chart and SVG progress rings, full category breakdown.
- **Lent / Borrowed** — informal IOUs with one-tap settle.
- **Future-proofed for splits** — every transaction has `isSplit` and `splitWith[]` ready for shared/group views.

---

## Folder structure

```
ePurse/
├── App.js                          # entry — wraps navigator with safe-area + gesture-handler
├── app.json                        # Expo config (icons, splash, theme colour)
├── babel.config.js
├── package.json
├── assets/
│   ├── icon.svg / icon.png         # generated app icon
│   ├── adaptive-icon.png           # Android adaptive icon
│   ├── splash.svg / splash.png     # generated splash screen
│   └── favicon.png
└── src/
    ├── constants/
    │   ├── theme.js                # colours, spacing, radius, typography, shadows
    │   └── categories.js           # default categories + keyword → category map
    ├── store/
    │   └── ePurseStore.js          # Zustand store + selectors
    ├── utils/
    │   ├── messageParser.js        # SMS / notification → Transaction
    │   ├── format.js               # currency / date helpers
    │   └── storage.js              # AsyncStorage wrapper
    ├── components/
    │   ├── GradientButton.js
    │   ├── FAB.js
    │   ├── TransactionItem.js
    │   ├── CategoryIcon.js
    │   ├── AccountChip.js
    │   └── LentBorrowedWidget.js
    ├── screens/
    │   ├── DashboardScreen.js
    │   ├── TransactionsScreen.js
    │   ├── AddTransactionScreen.js
    │   ├── AnalyticsScreen.js
    │   ├── CategoriesScreen.js
    │   └── LentBorrowedScreen.js
    └── navigation/
        └── AppNavigator.js
```

---

## Getting started

```bash
# 1. install
npm install            # or: yarn

# 2. run
npx expo start         # opens the Expo dev tools
# press i (iOS sim), a (Android), or scan the QR with Expo Go
```

No paid backend is required — everything is stored locally in `AsyncStorage`. When you're ready to sync across devices, swap the storage adapter in `src/store/ePurseStore.js` for Supabase / Firebase / your own API. The store's `partialize` already lists exactly what to persist.

---

## How the SMS parser works

`src/utils/messageParser.js` does the work:

1. **Intent**: looks for `Debited`, `Spent`, `Paid`, `Credited`, `Refund`, etc.
2. **Amount**: regex catches `Rs.1,234.50`, `₹1234`, `INR 1234`, plain `1234.00`.
3. **Account**: pulls a 3-6 digit mask after `A/c`, `account`, or `card ending`.
4. **Merchant**: tries UPI VPA (`name@bank`) first, then a phrase after `to / at / @ / from`.
5. **Category**: scans merchant + body against `CATEGORY_KEYWORDS` — `swiggy → food`, `uber → travel`, `netflix → entertainment`, etc.

```js
import { parseMessage } from './src/utils/messageParser';

parseMessage('Rs.450 debited from A/c xx1234 to SWIGGY via UPI.');
// {
//   amount: 450, type: 'debit',
//   accountType: 'Bank', accountMask: '1234',
//   merchant: 'SWIGGY', categoryId: 'food',
//   isSplit: false, splitWith: [],
//   ...
// }
```

A "Simulate SMS" quick-action on the dashboard injects a random sample message so you can see the pipeline live.

---

## Customising

- **Theme** → `src/constants/theme.js` (single source of truth for colour, spacing, shadows).
- **Default categories** → `src/constants/categories.js`.
- **Add a new screen** → drop it in `src/screens/`, register it in `src/navigation/AppNavigator.js`.
- **Backend later** → wrap `useEPurseStore` actions to sync with Supabase / Firestore. The data model is JSON-friendly.

---

## License

MIT — yours to fork and ship.
