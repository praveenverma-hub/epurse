// =============================================================================
// monthlyReportHtml — builds the printable HTML for the month-end PDF.
// -----------------------------------------------------------------------------
// Pure function: takes the report object from `selectMonthlyReport(mk)` and
// returns a self-contained HTML string (inline CSS + inline SVG charts, no
// external assets) suitable for expo-print's printToFileAsync. Raw-only
// sections (daily / merchants / subscriptions / payment methods) are omitted
// when their data is absent (older months whose raw rows were compacted).
// =============================================================================

// ─── Minimal shapes (structural; the source is the JS store selector) ─────────

interface Cat { name: string; color: string; emoji: string; total: number; percent: number; moverPct: number | null; }
interface BudgetRow { name: string; color: string; emoji: string; cap: number; actual: number; over: boolean; }
interface Budget { totalCap: number | null; totalActual: number; status: string | null; overshoot: number; saved: number; streak: number; rows: BudgetRow[]; }
interface DayPt { day: number; amount: number; }
interface Merchant { name: string; amount: number; count: number; }
interface Sub { merchant: string; amount: number; priceHike: boolean; hikeFrom: number | null; hikeTo: number | null; }
interface Pay { label: string; total: number; color: string; }
interface GroupSpend { name: string; emoji: string; color: string; total: number; count: number; type: string | null; }
interface TxnRow { dateLabel: string; merchant: string; category: string; amount: number; account: string; isPrivate: boolean; }
interface Highlight { kind: string; icon: string; text: string; }

export interface MonthlyReport {
  monthKey: string;
  monthLabel: string;
  shortLabel: string;
  daysInMonth: number;
  cashflow: { spent: number; income: number; net: number; savingsRate: number; prevSpent: number; spendDeltaPct: number | null };
  budget: Budget | null;
  categories: Cat[];
  daily: DayPt[] | null;
  peakDay: { day: number; amount: number; weekday: string } | null;
  noSpendDays: number | null;
  weekdayAvg: number | null;
  weekendAvg: number | null;
  biggest: { amount: number; merchant: string; day: number } | null;
  merchants: Merchant[] | null;
  subscriptions: Sub[];
  subscriptionTotal: number;
  paymentMethods: Pay[] | null;
  groupSpend: GroupSpend[];
  txnList: TxnRow[] | null;
  highlights: Highlight[];
  plan: { suggestedBudget: number; avgSpend: number; watchCategories: string[] };
  hasRaw: boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (n: number): string => '₹' + Math.round(n || 0).toLocaleString('en-IN');
const esc = (s: string): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));

// A little colour math for translucent fills without color-mix (some print
// engines are old): append an 8-bit alpha hex to a #RRGGBB colour.
const alpha = (hex: string, a: number): string => {
  const h = /^#([0-9a-f]{6})$/i.test(hex) ? hex : '#9CA3AF';
  return h + Math.round(a * 255).toString(16).padStart(2, '0');
};

const POS = '#12A150', NEG = '#E5484D', ACCENT = '#FF5A1F', ACCENT2 = '#FC8019', INK = '#14161B', MUTED = '#838B99', LINE = '#E7E9EE', FIELD = '#F6F7F9';

// Donut SVG from category slices.
function donutSvg(cats: Cat[], total: number): string {
  const R = 80, cx = 100, cy = 100, sw = 26, C = 2 * Math.PI * R;
  let acc = 0;
  const segs = cats.map((c) => {
    const len = total > 0 ? (c.total / total) * C : 0;
    const off = acc; acc += len;
    return `<circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${c.color}" stroke-width="${sw}" stroke-dasharray="${(len - 1.5).toFixed(2)} ${(C - len + 1.5).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
  }).join('');
  return `<svg width="180" height="180" viewBox="0 0 200 200">
    <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${alpha(LINE, 0.9)}" stroke-width="${sw}"/>
    ${segs}
    <text x="100" y="94" text-anchor="middle" font-size="12" fill="${MUTED}" font-weight="700">TOTAL SPENT</text>
    <text x="100" y="118" text-anchor="middle" font-size="22" fill="${INK}" font-weight="800">${money(total)}</text>
  </svg>`;
}

// Daily spend bar chart SVG.
function dailySvg(daily: DayPt[]): string {
  const W = 660, H = 130, n = daily.length, gap = 3;
  const bw = (W - (n - 1) * gap) / n;
  const max = Math.max(1, ...daily.map((d) => d.amount));
  const peak = daily.reduce((mx, d) => (d.amount > mx ? d.amount : mx), 0);
  const bars = daily.map((d, i) => {
    const h = d.amount > 0 ? Math.max(2, (d.amount / max) * (H - 8)) : 1.5;
    const x = i * (bw + gap), y = H - h;
    const fill = d.amount === peak ? ACCENT : d.amount === 0 ? alpha(MUTED, 0.18) : alpha(ACCENT, 0.35);
    return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="1.5" fill="${fill}"/>`;
  }).join('');
  return `<svg width="100%" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="height:120px">${bars}</svg>`;
}

function barMini(pct: number, color: string): string {
  return `<div class="mini-track"><span style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%;background:${color}"></span></div>`;
}

// ─── Section builders ─────────────────────────────────────────────────────────

function heroSection(r: MonthlyReport): string {
  const cf = r.cashflow;
  const delta = cf.spendDeltaPct == null ? ''
    : `<span class="delta ${cf.spendDeltaPct < 0 ? 'down' : 'up'}">${cf.spendDeltaPct < 0 ? '▼' : '▲'} ${Math.abs(Math.round(cf.spendDeltaPct))}%</span> vs prev`;
  const rate = Math.round(cf.savingsRate * 100);
  return `
  <div class="hero">
    <div class="hstat lead"><div class="lbl">Net saved</div><div class="val pos">${money(cf.net)}</div><div class="cap">${rate}% of income kept</div></div>
    <div class="hstat"><div class="lbl">Spent</div><div class="val">${money(cf.spent)}</div><div class="cap">${delta}</div></div>
    <div class="hstat"><div class="lbl">Income</div><div class="val">${money(cf.income)}</div><div class="cap">this month</div></div>
    <div class="hstat"><div class="lbl">Savings rate</div><div class="val">${rate}%</div><div class="cap">of income</div></div>
  </div>`;
}

function budgetSection(r: MonthlyReport): string {
  const b = r.budget;
  if (!b) return '';
  const overallPct = b.totalCap ? (b.totalActual / b.totalCap) * 100 : 0;
  const pill = b.totalCap == null ? ''
    : b.status === 'over'
      ? `<span class="pill over">+${money(b.overshoot)} over</span>`
      : `<span class="pill under">${money(b.saved)} under · streak ${b.streak}</span>`;
  const rows = b.rows.map((row) => {
    const pct = row.cap ? (row.actual / row.cap) * 100 : 0;
    const col = row.over ? NEG : POS;
    const tag = row.over ? `<span class="pill over">+${money(row.actual - row.cap)}</span>` : `<span class="pill under">${money(row.cap - row.actual)}</span>`;
    return `<div class="brow">
      <div class="b-name"><span class="sw" style="background:${row.color}"></span>${esc(row.name)}</div>
      ${barMini(pct, col)}
      <div class="b-nums"><b>${money(row.actual)}</b> / ${money(row.cap)} ${tag}</div>
    </div>`;
  }).join('');
  return `
  <div class="sec">
    <div class="sec-h"><h2>Plan vs reality</h2></div>
    ${b.totalCap != null ? `<div class="overall">
      <div class="oa"><div class="oa-top"><span>Overall budget</span><span><b>${money(b.totalActual)}</b> of ${money(b.totalCap)}</span></div>${barMini(overallPct, b.status === 'over' ? NEG : POS)}</div>
      ${pill}
    </div>` : ''}
    <div class="bud-rows">${rows}</div>
  </div>`;
}

function categorySection(r: MonthlyReport): string {
  if (!r.categories.length) return '';
  const total = r.categories.reduce((s, c) => s + c.total, 0);
  const list = r.categories.map((c) => {
    const mover = c.moverPct == null ? '' :
      `<span class="mover ${c.moverPct > 0 ? 'up' : 'down'}">${c.moverPct > 0 ? '▲' : '▼'}${Math.abs(Math.round(c.moverPct))}%</span>`;
    return `<div class="crow"><span class="sw" style="background:${c.color}"></span><span class="c-name">${esc(c.name)}</span>${mover}<span class="c-amt">${money(c.total)}</span><span class="c-pct">${Math.round(c.percent)}%</span></div>`;
  }).join('');
  return `
  <div class="sec">
    <div class="sec-h"><h2>Where it went</h2><span class="sub">movers vs last month</span></div>
    <div class="went"><div class="donut">${donutSvg(r.categories, total)}</div><div class="cat-list">${list}</div></div>
  </div>`;
}

function dailySection(r: MonthlyReport): string {
  if (!r.daily || !r.daily.length) return '';
  const stats: string[] = [];
  if (r.peakDay) stats.push(`Peak day · <b>${r.peakDay.weekday} ${r.peakDay.day}</b> — <b>${money(r.peakDay.amount)}</b>`);
  if (r.noSpendDays != null) stats.push(`No-spend days · <b>${r.noSpendDays}</b>`);
  if (r.weekdayAvg != null && r.weekendAvg != null) stats.push(`Weekday avg <b>${money(r.weekdayAvg)}</b> · Weekend <b>${money(r.weekendAvg)}</b>`);
  return `
  <div class="sec">
    <div class="sec-h"><h2>Daily rhythm</h2><span class="sub">${r.daily.length} days</span></div>
    ${dailySvg(r.daily)}
    <div class="t-stats">${stats.map((s) => `<span>${s}</span>`).join('')}</div>
  </div>`;
}

function merchantsSubsSection(r: MonthlyReport): string {
  const hasM = r.merchants && r.merchants.length;
  const hasS = r.subscriptions && r.subscriptions.length;
  if (!hasM && !hasS) return '';
  const max = hasM ? Math.max(1, ...r.merchants!.map((m) => m.amount)) : 1;
  const mCol = hasM ? `<div><div class="sec-h"><h2>Top merchants</h2></div>${r.merchants!.map((m, i) =>
    `<div class="mrow"><span class="m-rank">${i + 1}</span><div class="m-body"><div class="m-name"><span>${esc(m.name)}</span><span>${money(m.amount)}</span></div>${barMini(m.amount / max * 100, alpha(ACCENT, 0.5))}<div class="m-meta">${m.count} txns</div></div></div>`).join('')}</div>` : '';
  const sCol = hasS ? `<div><div class="sec-h"><h2>Recurring</h2></div>
    <div class="sub-total"><span>Monthly subscriptions</span><b>${money(r.subscriptionTotal)}</b></div>
    ${r.subscriptions.map((s) => `<div class="srow"><span class="s-name">${esc(s.merchant)}</span>${s.priceHike ? `<span class="hike">▲ ${money((s.hikeTo || 0) - (s.hikeFrom || 0))}</span>` : ''}<span class="s-amt">${money(s.amount)}</span></div>`).join('')}</div>` : '';
  return `<div class="sec"><div class="cols2">${mCol}${sCol}</div></div>`;
}

function groupSection(r: MonthlyReport): string {
  const gs = r.groupSpend;
  if (!gs || !gs.length) return '';
  const max = Math.max(1, ...gs.map((g) => g.total));
  const rows = gs.map((g) => `
    <div class="grow">
      <div class="g-head"><span class="g-name">${esc(g.emoji)} ${esc(g.name)}${g.type === 'trip' ? '<span class="g-tag">TRIP</span>' : ''}</span><b>${money(g.total)}</b></div>
      ${barMini(g.total / max * 100, g.color)}
      <div class="g-meta">${g.count} ${g.count === 1 ? 'expense' : 'expenses'} · your share</div>
    </div>`).join('');
  return `
  <div class="sec">
    <div class="sec-h"><h2>By group</h2><span class="sub">shared &amp; trip spend that counts toward your total</span></div>
    <div class="grp-rows">${rows}</div>
  </div>`;
}

function payHighlightsSection(r: MonthlyReport): string {
  const hasP = r.paymentMethods && r.paymentMethods.length;
  const hasH = r.highlights && r.highlights.length;
  if (!hasP && !hasH) return '';
  const tot = hasP ? r.paymentMethods!.reduce((s, p) => s + p.total, 0) || 1 : 1;
  const pCol = hasP ? `<div><div class="sec-h"><h2>Payment methods</h2></div>
    <div class="pay-bar">${r.paymentMethods!.map((p) => `<span style="width:${(p.total / tot * 100).toFixed(1)}%;background:${p.color}"></span>`).join('')}</div>
    ${r.paymentMethods!.map((p) => `<div class="pleg"><span class="pl-sw" style="background:${p.color}"></span><span class="pl-name">${esc(p.label)}</span><span class="pl-amt">${money(p.total)}</span></div>`).join('')}</div>` : '';
  const hCol = hasH ? `<div><div class="sec-h"><h2>Highlights</h2></div><div class="chips">${r.highlights.map((h) =>
    `<div class="chip ${h.kind}"><span class="ci">${h.icon}</span>${esc(h.text)}</div>`).join('')}</div></div>` : '';
  return `<div class="sec"><div class="cols2">${pCol}${hCol}</div></div>`;
}

function planSection(r: MonthlyReport): string {
  const watch = r.plan.watchCategories.length ? ` <b>Watch ${r.plan.watchCategories.slice(0, 2).map(esc).join(' & ')}</b> — over this month.` : '';
  return `
  <div class="sec">
    <div class="sec-h"><h2>Planning ahead</h2></div>
    <div class="plan"><div class="p-big">${money(r.plan.suggestedBudget)}</div>
      <div><div class="p-title">Suggested budget for next month</div><div class="p-note">Based on your recent ${money(r.plan.avgSpend)} monthly average.${watch}</div></div></div>
  </div>`;
}

function txnListSection(r: MonthlyReport): string {
  const rows = r.txnList;
  if (!rows || !rows.length) return '';
  const body = rows.map((t) => `
    <tr>
      <td class="tl-d">${esc(t.dateLabel)}</td>
      <td class="tl-m">${esc(t.merchant)}${t.isPrivate ? '<span class="tl-priv">private</span>' : ''}</td>
      <td class="tl-c">${esc(t.category)}</td>
      <td class="tl-a">${esc(t.account)}</td>
      <td class="tl-amt">${money(t.amount)}</td>
    </tr>`).join('');
  return `
  <div class="sec">
    <div class="sec-h"><h2>All transactions</h2><span class="sub">${rows.length} this month</span></div>
    <table class="tl">
      <thead><tr><th>Date</th><th>Merchant</th><th>Category</th><th>Account</th><th class="tl-amt">Amount</th></tr></thead>
      <tbody>${body}</tbody>
    </table>
  </div>`;
}

// ─── Entry point ──────────────────────────────────────────────────────────────

export function buildMonthlyReportHtml(r: MonthlyReport, opts: { userName?: string; generatedOn?: string } = {}): string {
  const gen = opts.generatedOn || '';
  const owner = opts.userName ? esc(opts.userName) : 'ePurse';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>
  * { box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  body { margin:0; font-family:-apple-system,'Helvetica Neue',Arial,sans-serif; color:${INK}; font-size:13px; line-height:1.5; }
  .doc { padding:0; }
  .mast { padding:26px 30px 22px; background:linear-gradient(135deg, ${alpha(ACCENT, 0.10)}, ${alpha(ACCENT2, 0.04)}); }
  .mast-top { display:flex; justify-content:space-between; align-items:flex-start; }
  .eyebrow { font-size:11px; letter-spacing:.16em; text-transform:uppercase; color:${ACCENT}; font-weight:800; }
  h1 { margin:4px 0 2px; font-size:28px; font-weight:800; letter-spacing:-.6px; }
  .gen { color:${MUTED}; font-size:12px; }
  .brand { font-weight:800; color:${ACCENT}; }
  .hero { display:flex; gap:10px; margin-top:18px; }
  .hstat { flex:1; background:#fff; border:1px solid ${LINE}; border-radius:12px; padding:11px 13px; }
  .hstat.lead { background:${alpha(POS, 0.08)}; border-color:${alpha(POS, 0.30)}; }
  .lbl { font-size:10px; text-transform:uppercase; letter-spacing:.06em; color:${MUTED}; font-weight:700; }
  .val { font-size:20px; font-weight:800; letter-spacing:-.4px; margin-top:4px; }
  .val.pos { color:${POS}; font-size:23px; }
  .cap { font-size:11px; color:#4A5160; margin-top:2px; }
  .delta { font-weight:800; } .delta.down { color:${POS}; } .delta.up { color:${NEG}; }

  .sec { padding:20px 30px; border-top:1px solid ${LINE}; }
  .sec-h { display:flex; align-items:baseline; margin-bottom:13px; }
  .sec-h h2 { font-size:15px; font-weight:800; margin:0; letter-spacing:-.2px; }
  .sec-h .sub { font-size:11.5px; color:${MUTED}; margin-left:auto; }

  .mini-track { height:9px; border-radius:5px; background:${alpha(MUTED, 0.16)}; overflow:hidden; }
  .mini-track > span { display:block; height:100%; border-radius:5px; }
  .pill { font-size:10.5px; font-weight:800; padding:2px 7px; border-radius:999px; white-space:nowrap; }
  .pill.under { color:${POS}; background:${alpha(POS, 0.12)}; }
  .pill.over { color:${NEG}; background:${alpha(NEG, 0.12)}; }
  .sw { display:inline-block; width:10px; height:10px; border-radius:3px; vertical-align:middle; margin-right:2px; }

  .overall { display:flex; align-items:center; gap:14px; background:${FIELD}; border:1px solid ${LINE}; border-radius:12px; padding:12px 14px; margin-bottom:13px; }
  .overall .oa { flex:1; } .oa-top { display:flex; justify-content:space-between; font-size:12.5px; margin-bottom:7px; }
  .bud-rows { display:flex; flex-direction:column; gap:10px; }
  .brow { display:grid; grid-template-columns:130px 1fr 175px; gap:12px; align-items:center; }
  .b-name { font-size:12.5px; font-weight:600; } .b-nums { text-align:right; font-size:11.5px; color:#4A5160; } .b-nums b { color:${INK}; }

  .went { display:grid; grid-template-columns:180px 1fr; gap:22px; align-items:center; }
  .donut { text-align:center; }
  .cat-list { display:flex; flex-direction:column; gap:2px; }
  .crow { display:flex; align-items:center; gap:8px; padding:5px 4px; }
  .c-name { font-size:12.5px; font-weight:600; flex:1; } .c-amt { font-size:12px; font-weight:700; } .c-pct { font-size:11.5px; color:${MUTED}; width:34px; text-align:right; }
  .mover { font-size:10.5px; font-weight:800; } .mover.up { color:${NEG}; } .mover.down { color:${POS}; }

  .t-stats { display:flex; flex-wrap:wrap; gap:8px 20px; margin-top:12px; font-size:12px; color:#4A5160; }

  .cols2 { display:grid; grid-template-columns:1fr 1fr; gap:24px; }
  .mrow { display:flex; gap:9px; align-items:center; padding:5px 0; }
  .m-rank { width:15px; color:${MUTED}; font-weight:800; font-size:11.5px; } .m-body { flex:1; }
  .m-name { display:flex; justify-content:space-between; font-size:12.5px; font-weight:600; } .m-name span:last-child { font-weight:800; }
  .m-meta { font-size:11px; color:${MUTED}; margin-top:2px; }
  .m-body .mini-track { margin-top:5px; height:5px; }
  .sub-total { display:flex; justify-content:space-between; align-items:center; background:${FIELD}; border:1px solid ${LINE}; border-radius:10px; padding:9px 12px; margin-bottom:9px; font-size:12.5px; } .sub-total b { font-size:16px; }
  .srow { display:flex; align-items:center; gap:8px; padding:5px 2px; } .s-name { flex:1; font-size:12.5px; font-weight:600; } .s-amt { font-size:12px; font-weight:700; }
  .hike { font-size:10px; font-weight:800; color:${NEG}; background:${alpha(NEG, 0.12)}; padding:2px 6px; border-radius:6px; }

  .grp-rows { display:grid; grid-template-columns:1fr 1fr; gap:14px 22px; }
  .grow .g-head { display:flex; justify-content:space-between; align-items:center; font-size:12.5px; margin-bottom:6px; }
  .g-name { font-weight:700; }
  .g-tag { font-size:8.5px; font-weight:800; letter-spacing:.06em; color:${ACCENT}; background:${alpha(ACCENT, 0.12)}; padding:1px 5px; border-radius:5px; margin-left:6px; vertical-align:middle; }
  .g-meta { font-size:11px; color:${MUTED}; margin-top:5px; }

  table.tl { width:100%; border-collapse:collapse; font-size:11.5px; }
  table.tl th { text-align:left; font-size:9.5px; text-transform:uppercase; letter-spacing:.05em; color:${MUTED}; font-weight:700; padding:0 8px 7px; border-bottom:1px solid ${LINE}; }
  table.tl td { padding:6px 8px; border-bottom:1px solid ${alpha(LINE, 0.6)}; }
  .tl-d { color:${MUTED}; white-space:nowrap; } .tl-m { font-weight:600; } .tl-c, .tl-a { color:#4A5160; }
  .tl-amt { text-align:right; font-weight:700; white-space:nowrap; }
  .tl-priv { font-size:8.5px; font-weight:800; color:${MUTED}; background:${alpha(MUTED, 0.14)}; padding:1px 5px; border-radius:5px; margin-left:6px; text-transform:uppercase; letter-spacing:.04em; }

  .pay-bar { height:14px; border-radius:7px; overflow:hidden; display:flex; margin-bottom:10px; } .pay-bar > span { display:block; height:100%; }
  .pleg { display:flex; align-items:center; gap:8px; font-size:12px; padding:2px 0; } .pl-sw { width:10px; height:10px; border-radius:3px; } .pl-name { flex:1; color:#4A5160; } .pl-amt { font-weight:700; }

  .chips { display:flex; flex-wrap:wrap; gap:8px; }
  .chip { display:flex; align-items:center; gap:7px; font-size:12px; font-weight:600; padding:8px 11px; border-radius:11px; background:${FIELD}; border:1px solid ${LINE}; }
  .chip.pos { background:${alpha(POS, 0.10)}; border-color:${alpha(POS, 0.28)}; } .chip.neg { background:${alpha(NEG, 0.10)}; border-color:${alpha(NEG, 0.28)}; }
  .chip .ci { font-size:14px; }

  .plan { display:flex; gap:14px; align-items:center; background:${alpha(ACCENT, 0.08)}; border:1px solid ${alpha(ACCENT, 0.24)}; border-radius:14px; padding:15px 17px; }
  .p-big { font-size:23px; font-weight:800; color:${ACCENT}; letter-spacing:-.4px; } .p-title { font-weight:800; font-size:13px; } .p-note { font-size:12px; color:#4A5160; margin-top:2px; }

  .foot { padding:16px 30px; border-top:1px solid ${LINE}; display:flex; justify-content:space-between; font-size:10.5px; color:${MUTED}; }
</style></head>
<body><div class="doc">
  <div class="mast">
    <div class="mast-top">
      <div><div class="eyebrow">Monthly Report</div><h1>${esc(r.monthLabel)}</h1><div class="gen">${gen ? esc(gen) : ''}</div></div>
      <div class="brand">₹ ePurse</div>
    </div>
    ${heroSection(r)}
  </div>
  ${budgetSection(r)}
  ${categorySection(r)}
  ${dailySection(r)}
  ${merchantsSubsSection(r)}
  ${groupSection(r)}
  ${payHighlightsSection(r)}
  ${planSection(r)}
  ${txnListSection(r)}
  <div class="foot"><span>${owner} · private to your device</span><span>₹ figures in INR</span></div>
</div></body></html>`;
}
