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
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1)}k`;
  return `₹${n.toFixed(0)}`;
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

export const monthKey = (date) => {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export const isSameMonth = (a, b) => monthKey(a) === monthKey(b);
