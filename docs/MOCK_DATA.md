# Configurable mock data

Run `npm run start:mock`, then reload the development app. Normal login still
applies (or use the app's existing development login). Demo-prefixed records
identify test data; the layout matches normal mode without a debug banner.
Production/release JS bundles cannot enable it.

Stop Metro and run `npm start -- --clear`, then fully reload to return to normal
data. Mock mode is off by default. Do not put the flag in a shared `.env` file.

## Configuration

Edit `src/config/mockData.js` → `MOCK_SCENARIO`. It defines input amounts,
expense categories/accounts, 1–3 calendar months, budgets, goals and a scale
factor. All visible balances, charts, budget usage, credit utilisation and
summaries use the existing store and selectors. No screen totals are injected.
Current-month dates are clamped to today; historical dates remain within their
calendar months. Random internal IDs follow the existing action implementation;
the input financial amounts and dates are repeatable for the same day/config.

Coverage: bank/cash/credit-card accounts; expenses/income/refund; three pending
review rows; Private and Ignore; direct split and linked lending; personal/shared
groups; manual lent/borrowed entries; budget; two saving goals and contributions;
reminder; review rewards/profile. Normal recap and Aware Run eligibility runs
after seeding. This does not force every modal or every rare error state.

## Isolation and reset

Ledger, reward and notification stores use memory instead of device storage.
Full JS reload resets the scenario; Fast Refresh intentionally does not seed it
twice. Turning mock mode off restores the saved real stores. Seeding a nonempty
store is rejected. Cloud backup/restore and device SMS import are disabled;
reminders stay in-app without scheduling OS notifications. Login, permissions,
contacts, location and explicit share/export actions are still real integrations.
Avoid choosing real contacts if you want the scenario to remain wholly synthetic.

## Verification

`npm run test:mock` exercises the real store at 1× and 2× input amounts and checks
account balances, signed card liability, monthly spend/income, budget cap,
goal contributions, pending reviews, group/reminder creation, reset protection
and the memory adapter. Expected values come from input arithmetic, not the same
selectors under test.

This is a ledger/UI scenario, not proof of native integration. Review rows are
synthetic SMS-shaped transactions. Use `test:parser`, `test:smsSync`, `test:e2e`
and actual Android permission/inbox tests for parsing/import; real-device tests
are still needed for notification delivery, biometric lock, OAuth and sharing.
