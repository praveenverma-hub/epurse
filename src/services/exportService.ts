// =============================================================================
// exportService.ts — Transaction export pipeline (CSV + PDF)
//
// Dependencies (already installed):
//   expo-file-system · expo-sharing · expo-print
// =============================================================================

// NO top-level runtime imports for native expo modules.
// They are required lazily inside compileAndShare() so that a missing native
// binary (app not yet rebuilt after `npm install`) never crashes the screen load.
// Type-only imports are erased at compile time — zero runtime effect.
import type * as TFileSystem from 'expo-file-system';
import type * as TSharing    from 'expo-sharing';
import type * as TPrint       from 'expo-print';

// ---------------------------------------------------------------------------
// Shared types (intentionally minimal — no store import to avoid circular deps)
// ---------------------------------------------------------------------------

export type ExportFormat = 'pdf' | 'csv';

export interface ExportFilterContext {
  timeframe: 'week' | 'month' | 'year' | 'all';
  catIds: string[];
  acctIds: string[];
  showHidden: boolean;
  showIgnored: boolean;
  showSplit: boolean;
  advanced: { minAmount: string; maxAmount: string; query: string };
  searchQuery: string;
}

export interface ExportTransaction {
  id: string;
  createdAt: string;
  merchant?: string;
  note?: string;
  amount: number;
  type: string;           // 'debit' | 'credit'
  categoryId?: string;
  parentCategory?: string;
  childCategory?: string;
  accountId?: string;
  isHidden?: boolean;
  isIgnored?: boolean;
  isSplit?: boolean;
}

export interface ExportCategory {
  id: string;
  name: string;
  emoji?: string;
}

export interface ExportAccount {
  id: string;
  name: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtINR(n: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function escapeCell(val: string | number | undefined | null): string {
  const s = String(val ?? '');
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

const TIMEFRAME_LABELS: Record<string, string> = {
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
  all: 'All Time',
};

function buildFilterChips(
  ctx: ExportFilterContext,
  categories: ExportCategory[],
  accounts: ExportAccount[],
): string[] {
  const catMap = Object.fromEntries(categories.map((c) => [c.id, c]));
  const acctMap = Object.fromEntries(accounts.map((a) => [a.id, a]));
  const chips: string[] = [TIMEFRAME_LABELS[ctx.timeframe] ?? 'All Time'];

  ctx.acctIds.forEach((id) => { if (acctMap[id]) chips.push(acctMap[id].name); });
  ctx.catIds.forEach((id) => {
    const c = catMap[id];
    if (c) chips.push(`${c.emoji ?? ''} ${c.name}`.trim());
  });
  if (ctx.showHidden)  chips.push('Hidden');
  if (ctx.showIgnored) chips.push('Ignored');
  if (ctx.showSplit)   chips.push('Split only');
  if (ctx.advanced.minAmount) chips.push(`> ₹${ctx.advanced.minAmount}`);
  if (ctx.advanced.maxAmount) chips.push(`< ₹${ctx.advanced.maxAmount}`);
  const q = ctx.advanced.query || ctx.searchQuery;
  if (q) chips.push(`"${q}"`);
  return chips;
}

// ---------------------------------------------------------------------------
// CSV builder
// ---------------------------------------------------------------------------

export function buildCSV(
  txns: ExportTransaction[],
  categories: ExportCategory[],
  accounts: ExportAccount[],
): string {
  const catMap  = Object.fromEntries(categories.map((c) => [c.id, c]));
  const acctMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  const header = [
    'Date', 'Time', 'Merchant', 'Category', 'Sub-Category',
    'Amount (₹)', 'Type', 'Account', 'Notes',
  ].join(',');

  const rows = txns.map((t) => {
    const d       = new Date(t.createdAt);
    const date    = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
    const time    = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const cat     = catMap[t.categoryId ?? ''];
    const catName = t.parentCategory || cat?.name || '';
    const subCat  = t.childCategory || '';
    const acct    = acctMap[t.accountId ?? '']?.name || '';
    const type    = t.type === 'debit' ? 'Debit' : 'Credit';

    return [
      escapeCell(date),
      escapeCell(time),
      escapeCell(t.merchant || t.note || ''),
      escapeCell(catName),
      escapeCell(subCat),
      escapeCell(Number(t.amount || 0).toFixed(2)),
      escapeCell(type),
      escapeCell(acct),
      escapeCell(t.note || ''),
    ].join(',');
  });

  return [header, ...rows].join('\r\n');
}

// ---------------------------------------------------------------------------
// PDF HTML builder
// ---------------------------------------------------------------------------

export function buildPDFHTML(
  txns: ExportTransaction[],
  ctx: ExportFilterContext,
  categories: ExportCategory[],
  accounts: ExportAccount[],
  userName?: string,
): string {
  const catMap  = Object.fromEntries(categories.map((c) => [c.id, c]));
  const acctMap = Object.fromEntries(accounts.map((a) => [a.id, a]));

  // ── Totals
  let totalDebit = 0, totalCredit = 0;
  txns.forEach((t) => {
    const amt = Number(t.amount || 0);
    if (t.type === 'debit') totalDebit += amt;
    else totalCredit += amt;
  });
  const net = totalCredit - totalDebit;

  // ── Chips HTML
  const chipsHTML = buildFilterChips(ctx, categories, accounts)
    .map((c) => `<span class="chip">${c}</span>`)
    .join('');

  // ── Table rows
  const rows = txns.map((t, i) => {
    const d         = new Date(t.createdAt);
    const dateStr   = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    const timeStr   = d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
    const merchant  = t.merchant || t.note || '—';
    const cat       = catMap[t.categoryId ?? ''];
    const catLabel  = t.parentCategory || cat?.name || '—';
    const subLabel  = t.childCategory
      ? `<div class="sub">${t.childCategory}</div>`
      : '';
    const acctName  = acctMap[t.accountId ?? '']?.name || '—';
    const amtClass  = t.type === 'debit' ? 'amt-d' : 'amt-c';
    const amtSign   = t.type === 'debit' ? '−' : '+';
    const note      = (t.note && t.merchant) ? `<div class="sub">${t.note}</div>` : '';
    const rowBg     = i % 2 === 1 ? ' class="alt"' : '';

    return `<tr${rowBg}>
      <td class="col-date"><div class="d1">${dateStr}</div><div class="sub">${timeStr}</div></td>
      <td class="col-merchant">${merchant}${note}</td>
      <td><span class="pill">${catLabel}</span>${subLabel}</td>
      <td class="col-acct">${acctName}</td>
      <td class="col-amt ${amtClass}">${amtSign} ${fmtINR(Number(t.amount || 0))}</td>
    </tr>`;
  }).join('');

  const generatedAt = new Date().toLocaleString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<title>ePurse Statement</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:-apple-system,'Helvetica Neue',Arial,sans-serif;
       background:#fff;color:#1C1C1E;padding:36px 44px;font-size:13px;line-height:1.55}
  /* ── Header */
  .hdr{display:flex;justify-content:space-between;align-items:flex-start;
       padding-bottom:18px;border-bottom:3px solid #FF5A1F;margin-bottom:20px}
  .brand{font-size:26px;font-weight:900;color:#FF5A1F;letter-spacing:-0.5px}
  .brand-sub{font-size:12px;color:#6B7280;margin-top:4px}
  .hdr-right{text-align:right;font-size:11px;color:#9CA3AF;line-height:1.8}
  .hdr-right strong{color:#1C1C1E;font-size:13px;font-weight:700}
  /* ── Filter chips */
  .chips{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:18px}
  .chip{background:#FFF3EE;color:#FF5A1F;font-size:11px;font-weight:700;
        padding:3px 10px;border-radius:999px;border:1px solid #FFD8C9}
  /* ── Summary */
  .summary{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:26px}
  .stat{background:#F4F5F7;border-radius:10px;padding:14px 16px}
  .stat-lbl{font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;
             letter-spacing:0.8px;margin-bottom:5px}
  .stat-val{font-size:20px;font-weight:800;color:#1C1C1E}
  .stat-val.red{color:#EF4444}.stat-val.grn{color:#10B981}
  /* ── Table */
  .sec-lbl{font-size:10px;font-weight:700;color:#9CA3AF;text-transform:uppercase;
            letter-spacing:0.8px;margin-bottom:8px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  thead th{text-align:left;font-size:10px;font-weight:700;color:#9CA3AF;
            text-transform:uppercase;letter-spacing:0.5px;
            padding:8px 10px;background:#F4F5F7}
  thead th.col-amt{text-align:right}
  tr.alt{background:#FAFAFB}
  td{padding:9px 10px;border-bottom:1px solid #EAECEE;vertical-align:top}
  .col-date{min-width:68px;white-space:nowrap}
  .d1{font-weight:600;font-size:12px}
  .sub{font-size:10px;color:#9CA3AF;margin-top:2px}
  .col-merchant{max-width:170px;font-weight:500}
  .pill{background:#F4F5F7;color:#6B7280;font-size:10px;padding:2px 7px;
         border-radius:999px;display:inline-block;white-space:nowrap}
  .col-acct{font-size:11px;color:#6B7280;max-width:90px}
  .col-amt{text-align:right;font-weight:700;white-space:nowrap;min-width:88px}
  .amt-d{color:#EF4444}.amt-c{color:#10B981}
  /* ── Footer */
  .footer{margin-top:28px;text-align:center;font-size:10px;color:#9CA3AF;
           padding-top:14px;border-top:1px solid #EAECEE}
</style>
</head>
<body>

<div class="hdr">
  <div>
    <div class="brand">ePurse</div>
    <div class="brand-sub">Personal Finance · Transaction Statement</div>
  </div>
  <div class="hdr-right">
    <strong>${userName ? `${userName}'s Statement` : 'Transaction Statement'}</strong><br/>
    Generated ${generatedAt}<br/>
    ${txns.length} transaction${txns.length !== 1 ? 's' : ''}
  </div>
</div>

<div class="chips">${chipsHTML}</div>

<div class="summary">
  <div class="stat">
    <div class="stat-lbl">Total Spent</div>
    <div class="stat-val red">${fmtINR(totalDebit)}</div>
  </div>
  <div class="stat">
    <div class="stat-lbl">Total Income</div>
    <div class="stat-val grn">${fmtINR(totalCredit)}</div>
  </div>
  <div class="stat">
    <div class="stat-lbl">Net</div>
    <div class="stat-val ${net >= 0 ? 'grn' : 'red'}">${net >= 0 ? '+' : ''}${fmtINR(net)}</div>
  </div>
</div>

<div class="sec-lbl">Transactions (${txns.length})</div>
<table>
  <thead>
    <tr>
      <th>Date</th>
      <th>Merchant</th>
      <th>Category</th>
      <th>Account</th>
      <th class="col-amt">Amount</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="footer">Generated by ePurse · Personal Finance Manager · ${new Date().getFullYear()}</div>
</body>
</html>`;
}

// ---------------------------------------------------------------------------
// Main entry point — compile file and invoke native share sheet
// ---------------------------------------------------------------------------

export async function compileAndShare(
  format: ExportFormat,
  txns: ExportTransaction[],
  ctx: ExportFilterContext,
  categories: ExportCategory[],
  accounts: ExportAccount[],
  userName?: string,
): Promise<void> {
  // Lazy requires — only evaluated here at call-time, never at module load.
  // This prevents expo-print / expo-sharing from calling requireNativeModule()
  // during bundle init (which crashes the screen if the binary hasn't been
  // rebuilt yet after `npm install`).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const FS      = require('expo-file-system') as typeof TFileSystem;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Sharing = require('expo-sharing')     as typeof TSharing;

  const ts = Date.now();

  if (format === 'csv') {
    const csv  = buildCSV(txns, categories, accounts);
    const path = `${FS.cacheDirectory}epurse_statement_${ts}.csv`;
    await FS.writeAsStringAsync(path, csv, { encoding: FS.EncodingType.UTF8 });
    await Sharing.shareAsync(path, {
      mimeType: 'text/csv',
      dialogTitle: 'Share Transaction Statement',
      UTI: 'public.comma-separated-values-text',
    });
  } else {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Print = require('expo-print') as typeof TPrint;
    const html  = buildPDFHTML(txns, ctx, categories, accounts, userName);
    const { uri } = await Print.printToFileAsync({ html, base64: false });
    const dest    = `${FS.cacheDirectory}epurse_report_${ts}.pdf`;
    await FS.moveAsync({ from: uri, to: dest });
    await Sharing.shareAsync(dest, {
      mimeType: 'application/pdf',
      dialogTitle: 'Share Transaction Report',
      UTI: 'com.adobe.pdf',
    });
  }
}
