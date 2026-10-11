// The retention table stays in step with the constants:  npm run test:retention
import { RETENTION_SUMMARY, RAW_RETENTION_MS, AGG_RETENTION_MS, DAY_MS, KEEP_BACKUPS } from '../../constants/retention.ts';
import { KEEP_BACKUPS as backupKeep } from '../../backup/config.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};
const row = (data) => RETENTION_SUMMARY.find((r) => r.data === data);

check('raw transactions: 90 days', RAW_RETENTION_MS === 90 * DAY_MS && row('Transactions').keeps === '90 days');
check('monthly totals: 730 days', AGG_RETENTION_MS === 730 * DAY_MS && row('Monthly totals').keeps === '730 days');
check('settled lent/borrow: 730 days', row('Settled lent / borrowed').keeps === '730 days');
check('every row names what it keeps and what happens after', RETENTION_SUMMARY.every((r) => r.data && r.keeps && r.then));
check('the backup config re-exports the same number', backupKeep === KEEP_BACKUPS && row('Drive backups').keeps === `latest ${KEEP_BACKUPS}`);
check('raw rows never outlive the monthly totals', RAW_RETENTION_MS <= AGG_RETENTION_MS);

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
