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
 * Label for the transaction date field. The two recent days get a bare relative
 * word (shortest form, and unambiguous on its own); everything older shows the
 * real date, with the year only when it isn't the current one:
 *   "Today" / "Yesterday" / "28 Jul" / "28 Jul 2025"
 */
export const formatDateLabel = (date) => {
  const d = new Date(date);
  const now = new Date();
  const sameDay = (a, b) =>
    a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  // "Today" / "Yesterday" stand ALONE — no "· 8 Aug" tail. A relative day is
  // already unambiguous, so the numeric date added no information while nearly
  // doubling the label's width, which crowded the compact LB date button.
  if (sameDay(d, now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (sameDay(d, yesterday)) return 'Yesterday';
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
};

/**
 * One-line running balance with a person, for Lent/Borrowed confirmations.
 * `net` is the signed owed-to-me figure from `getPersonBalances` (> 0 = they owe
 * you), so the sign — not the caller — decides the wording.
 *
 * This is what makes an LB toast worth reading: echoing back the amount the user
 * just typed tells them nothing, whereas the resulting position does (and it
 * quietly catches a wrong-direction entry, since the total moves the wrong way).
 * Returns null when there's no balance to describe.
 */
export const formatOutstanding = (net, name) => {
  if (net == null || Number.isNaN(net)) return null;
  const who = (name || '').trim() || 'them';
  if (Math.abs(net) < 0.01) return `You're all square with ${who}`;
  return net > 0
    ? `${who} owes you ${formatCurrency(net)} in total`
    : `You owe ${who} ${formatCurrency(-net)} in total`;
};

/**
 * Title-case a person's name for DISPLAY — "rohit sharma" / "ROHIT SHARMA" both
 * read as "Rohit Sharma" on a card. Never touches stored data or the name field
 * while it's being typed (that would fight the user's cursor); call it only at
 * render time, on whatever a card/toast is about to show.
 */
export const titleCaseName = (raw) => {
  const s = String(raw ?? '').trim();
  if (!s) return s;
  return s.split(/\s+/).map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
};

/** First name only — toasts and chips read better without a full legal name. */
export const firstName = (full) =>
  titleCaseName((full || '').trim().split(/\s+/)[0] || (full || '').trim());

/**
 * Title-case a UI LABEL (a button, a heading) for DISPLAY — the app-wide rule is
 * every screen/section heading, button and chip is Title Case (see ui-consistency
 * skill). This is the enforcement point: a component that renders caller-supplied
 * text as a label routes it through here so a caller that typed "add entry"
 * still SHOWS "Add Entry", instead of relying on every call site remembering.
 *
 * Deliberately gentler than `titleCaseName` above: it only capitalises a word
 * that's WHOLLY lowercase, and leaves any word alone that already has an
 * uppercase letter or a digit/currency/percent in it. That's what keeps it safe
 * on the kind of text these components actually carry — an acronym ("PDF",
 * "CSV", "EPC"), a proper noun, or a dynamic value ("₹500", "3 days") — none of
 * which a blunt "capitalise every word" pass could tell apart from a plain word.
 * Prose (a subtitle, a toast, a sentence) is explicitly OUT of scope for the
 * Title Case rule and must not be routed through this.
 */
export const titleCaseLabel = (text) => {
  const s = String(text ?? '');
  if (!s) return s;
  return s
    .split(' ')
    .map((word) => (word && !/[0-9₹%A-Z]/.test(word) ? word.charAt(0).toUpperCase() + word.slice(1) : word))
    .join(' ');
};

export const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const isSameMonth = (a, b) => monthKey(a) === monthKey(b);
