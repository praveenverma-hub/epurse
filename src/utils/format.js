// Currency / date helpers
export const formatCurrency = (value, currency = 'INR') => {
  const n = Number(value || 0);
  try {
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `₹${n.toLocaleString('en-IN')}`;
  }
};

export const formatCompact = (value) => {
  const n = Number(value || 0);
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  // 2 decimal places, strip trailing zeros: 2.00→2, 2.10→2.1, 2.03→2.03
  const fmt = (num) => num.toFixed(2).replace(/\.?0+$/, '');
  if (abs >= 1e7) return `${sign}₹${fmt(abs / 1e7)}Cr`;
  if (abs >= 1e5) return `${sign}₹${fmt(abs / 1e5)}L`;
  if (abs >= 1e3) return `${sign}₹${fmt(abs / 1e3)}k`;
  return `${sign}₹${Math.round(abs)}`;
};

export const formatDate = (date) => {
  const d = new Date(date);
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
};

export const formatDateTime = (date) => {
  const d = new Date(date);
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
};

/**
 * Label for the transaction date field. Always includes the real date so it's
 * never hidden behind a relative word alone:
 *   "Today · 31 Jul" / "Yesterday · 30 Jul" / "28 Jul" / "28 Jul 2025"
 */
export const formatDateLabel = (date) => {
  const d = new Date(date);
  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const dayMonth = d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
  if (sameDay(d, now)) return `Today · ${dayMonth}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return `Yesterday · ${dayMonth}`;
  return dayMonth;
};

export const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const isSameMonth = (a, b) => monthKey(a) === monthKey(b);
