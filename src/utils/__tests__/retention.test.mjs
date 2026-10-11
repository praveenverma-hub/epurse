// The retention table stays in step with the constants:  npm run test:retention
import { RETENTION_SUMMARY, IGNORED_RETENTION_MS, AGG_RETENTION_MS, CLEANUP_CHOICES_YEARS, DAY_MS, KEEP_BACKUPS, PRE_RESTORE_SNAPSHOT_MS } from '../../constants/retention.ts';
import { KEEP_BACKUPS as backupKeep } from '../../backup/config.ts';

let pass = 0, fail = 0;
const check = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${name}`); }
  else { fail++; console.log(`  \x1b[31m✗ ${name}\x1b[0m  ${detail}`); }
};
const row = (data) => RETENTION_SUMMARY.find((r) => r.data === data);

check('transactions: kept until the user cleans up', row('Transactions').keeps === 'until you clean up');
check('settled lent/borrow and groups: kept until the user cleans up',
  row('Settled lent / borrowed').keeps === 'until you clean up' && row('Settled groups').keeps === 'until you clean up');
check('monthly totals: 10 years', AGG_RETENTION_MS === 3650 * DAY_MS && row('Monthly totals').keeps === '10 years');
check('ignored transactions: 90 days', IGNORED_RETENTION_MS === 90 * DAY_MS && row('Ignored transactions').keeps === '90 days');
check('every row names what it keeps and what happens after', RETENTION_SUMMARY.every((r) => r.data && r.keeps && r.then));
check('the backup config re-exports the same number', backupKeep === KEEP_BACKUPS && row('Drive backups').keeps === `latest ${KEEP_BACKUPS}`);
check('totals outlive every clean-up choice', CLEANUP_CHOICES_YEARS.every((y) => y * 365 * DAY_MS < AGG_RETENTION_MS));
check('pre-restore copy: 7 days', PRE_RESTORE_SNAPSHOT_MS === 7 * DAY_MS && row('Pre-restore copy (for Undo)').keeps === '7 days');

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
