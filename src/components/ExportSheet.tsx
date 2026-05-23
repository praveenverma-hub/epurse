// =============================================================================
// ExportSheet
// Bottom sheet for compiling + sharing a filtered transaction statement.
// Two export paths: PDF Report (visual, print-ready) and CSV Spreadsheet.
// Receives pre-filtered `transactions` so it always exports exactly what
// the user sees on screen — no re-filtering needed.
// =============================================================================

import React, { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { colors, radius, spacing, typography } from '../constants/theme';
import { formatCurrency } from '../utils/format';
import {
  compileAndShare,
  ExportAccount,
  ExportCategory,
  ExportFilterContext,
  ExportFormat,
  ExportTransaction,
} from '../services/exportService';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Props {
  visible: boolean;
  onClose: () => void;
  filteredTransactions: ExportTransaction[];
  filterCtx: ExportFilterContext;
}

interface FormatOption {
  id: ExportFormat;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  subtitle: string;
  accentColor: string;
  badgeLabel: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const FORMAT_OPTIONS: FormatOption[] = [
  {
    id: 'pdf',
    icon: 'document-text-outline',
    title: 'PDF Report',
    subtitle: 'Visual layout with summary totals and per-transaction rows. Ready to print or share.',
    accentColor: '#EF4444',
    badgeLabel: '.PDF',
  },
  {
    id: 'csv',
    icon: 'grid-outline',
    title: 'CSV Spreadsheet',
    subtitle: 'Flat structured data compatible with Excel, Google Sheets, or any data tool.',
    accentColor: '#10B981',
    badgeLabel: '.CSV',
  },
];

const TIMEFRAME_LABELS: Record<string, string> = {
  week: 'This Week',
  month: 'This Month',
  year: 'This Year',
  all: 'All Time',
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ExportSheet: React.FC<Props> = ({
  visible,
  onClose,
  filteredTransactions,
  filterCtx,
}) => {
  const theme      = useTheme();
  const categories = useEPurseStore((s) => s.categories) as ExportCategory[];
  const accounts   = useEPurseStore((s) => s.accounts)   as ExportAccount[];
  const userName   = useEPurseStore((s) => s.userName)   as string | null;

  const [selectedFormat, setSelectedFormat] = useState<ExportFormat | null>(null);
  const [loading, setLoading]               = useState(false);

  const handleClose = useCallback(() => {
    if (loading) return;
    setSelectedFormat(null);
    onClose();
  }, [loading, onClose]);

  // ── Human-readable filter summary ─────────────────────────────────────────
  const filterSummary = useMemo(() => {
    const parts: string[] = [];
    parts.push(TIMEFRAME_LABELS[filterCtx.timeframe] ?? 'All Time');

    const acctNames = filterCtx.acctIds
      .map((id) => accounts.find((a) => a.id === id)?.name)
      .filter(Boolean) as string[];
    if (acctNames.length) parts.push(acctNames.join(', '));

    const catNames = filterCtx.catIds
      .map((id) => {
        const c = categories.find((x) => x.id === id);
        return c ? `${c.emoji ?? ''} ${c.name}`.trim() : null;
      })
      .filter(Boolean) as string[];
    if (catNames.length) parts.push(catNames.join(', '));

    if (filterCtx.showHidden)  parts.push('Hidden');
    if (filterCtx.showIgnored) parts.push('Ignored');
    if (filterCtx.advanced.minAmount) parts.push(`> ₹${filterCtx.advanced.minAmount}`);
    if (filterCtx.advanced.maxAmount) parts.push(`< ₹${filterCtx.advanced.maxAmount}`);
    const q = filterCtx.advanced.query || filterCtx.searchQuery;
    if (q) parts.push(`"${q}"`);

    return parts.join(' · ');
  }, [filterCtx, accounts, categories]);

  // ── Totals for the context card ───────────────────────────────────────────
  const { totalDebit, totalCredit } = useMemo(() => {
    let d = 0, c = 0;
    filteredTransactions.forEach((t) => {
      const amt = Number(t.amount || 0);
      if (t.type === 'debit') d += amt;
      else c += amt;
    });
    return { totalDebit: d, totalCredit: c };
  }, [filteredTransactions]);

  const fmtCompact = (n: number) => formatCurrency(isFinite(n) ? n : 0);

  // ── Compile handler ───────────────────────────────────────────────────────
  const handleCompile = useCallback(async () => {
    if (!selectedFormat) return;
    setLoading(true);
    try {
      await compileAndShare(
        selectedFormat,
        filteredTransactions,
        filterCtx,
        categories,
        accounts,
        userName || undefined,
      );
      // Close only after share sheet dismissed (iOS awaits, Android resolves early)
      handleClose();
    } catch (err: any) {
      const msg = String(err?.message ?? '').toLowerCase();
      // 'cancel'/'dismiss' means user cancelled the share sheet — not an error
      if (!msg.includes('cancel') && !msg.includes('dismiss')) {
        Alert.alert(
          'Export failed',
          'Could not generate the file. Please try again.',
          [{ text: 'OK' }],
        );
      }
    } finally {
      setLoading(false);
    }
  }, [selectedFormat, filteredTransactions, filterCtx, categories, accounts, userName, handleClose]);

  const canCompile = !!selectedFormat && !loading && filteredTransactions.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={handleClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* ── Header ── */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Export Transactions</Text>
              <Text style={styles.subtitle}>Compile & share your current statement</Text>
            </View>
            <TouchableOpacity
              onPress={handleClose}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={18} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>

          {/* ── Context summary card ── */}
          <View
            style={[
              styles.contextCard,
              { borderColor: theme.primary + '33', backgroundColor: theme.primary + '08' },
            ]}
          >
            <View style={[styles.contextIcon, { backgroundColor: theme.primary + '18' }]}>
              <Ionicons name="receipt-outline" size={17} color={theme.primary} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={[styles.contextCount, { color: theme.primary }]}>
                {filteredTransactions.length} transaction
                {filteredTransactions.length !== 1 ? 's' : ''}
              </Text>
              <Text style={styles.contextFilters} numberOfLines={2}>
                {filterSummary}
              </Text>
            </View>
            <View style={styles.contextTotals}>
              <Text style={styles.totalDebit}>−{fmtCompact(totalDebit)}</Text>
              <Text style={styles.totalCredit}>+{fmtCompact(totalCredit)}</Text>
            </View>
          </View>

          {/* ── Format selection ── */}
          <Text style={styles.sectionLabel}>Select format</Text>

          {FORMAT_OPTIONS.map((opt) => {
            const isSelected = selectedFormat === opt.id;
            return (
              <Pressable
                key={opt.id}
                onPress={() => setSelectedFormat(isSelected ? null : opt.id)}
                style={({ pressed }) => [
                  styles.formatCard,
                  isSelected && {
                    borderColor: opt.accentColor + 'CC',
                    backgroundColor: opt.accentColor + '09',
                  },
                  pressed && !isSelected && { backgroundColor: colors.background },
                ]}
              >
                {/* Icon */}
                <View style={[styles.formatIconBox, { backgroundColor: opt.accentColor + '15' }]}>
                  <Ionicons name={opt.icon} size={22} color={opt.accentColor} />
                </View>

                {/* Text */}
                <View style={{ flex: 1, gap: 2 }}>
                  <View style={styles.formatTitleRow}>
                    <Text style={[styles.formatTitle, isSelected && { color: opt.accentColor }]}>
                      {opt.title}
                    </Text>
                    <View
                      style={[
                        styles.formatBadge,
                        { backgroundColor: opt.accentColor + (isSelected ? 'CC' : '22') },
                      ]}
                    >
                      <Text style={[styles.formatBadgeText, isSelected && { color: '#fff' }]}>
                        {opt.badgeLabel}
                      </Text>
                    </View>
                  </View>
                  <Text style={styles.formatSubtitle}>{opt.subtitle}</Text>
                </View>

                {/* Radio */}
                <View
                  style={[
                    styles.radio,
                    isSelected && {
                      borderColor: opt.accentColor,
                      backgroundColor: opt.accentColor,
                    },
                  ]}
                >
                  {isSelected && <View style={styles.radioDot} />}
                </View>
              </Pressable>
            );
          })}

          {/* ── Compile button ── */}
          <TouchableOpacity
            onPress={handleCompile}
            disabled={!canCompile}
            activeOpacity={0.85}
            style={styles.compileBtnWrap}
          >
            <LinearGradient
              colors={
                canCompile
                  ? ([theme.gradientStart, theme.gradientEnd] as [string, string])
                  : (['#C8C8C8', '#ADADAD'] as [string, string])
              }
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.compileBtn}
            >
              {loading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <>
                  <Ionicons
                    name={
                      selectedFormat === 'pdf'
                        ? 'document-text-outline'
                        : selectedFormat === 'csv'
                        ? 'grid-outline'
                        : 'share-outline'
                    }
                    size={18}
                    color="#fff"
                    style={{ marginRight: 8 }}
                  />
                  <Text style={styles.compileBtnText}>
                    {selectedFormat
                      ? `Compile ${selectedFormat.toUpperCase()} & Share`
                      : 'Select a format above'}
                  </Text>
                </>
              )}
            </LinearGradient>
          </TouchableOpacity>

          {filteredTransactions.length === 0 && (
            <Text style={styles.emptyNote}>
              No transactions match the current filters — nothing to export.
            </Text>
          )}
        </View>
      </View>
    </Modal>
  );
};

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },

  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    padding: spacing.lg,
    paddingBottom: spacing.xxl + 8,
    gap: spacing.md,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.xs,
  },

  // ── Header
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  title:    { fontSize: 20, fontWeight: '700' as const, color: colors.textPrimary },
  subtitle: { fontSize: 13, color: colors.textSecondary, marginTop: 2 },
  closeBtn: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: colors.background,
    alignItems: 'center', justifyContent: 'center',
    marginTop: 2,
  },

  // ── Context card
  contextCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  contextIcon: {
    width: 38, height: 38, borderRadius: 19,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  contextCount:   { fontSize: 15, fontWeight: '800' as const, color: colors.textPrimary },
  contextFilters: { fontSize: 11, fontWeight: '500' as const, color: colors.textSecondary, lineHeight: 14 },
  contextTotals:  { alignItems: 'flex-end' as const, gap: 3 },
  totalDebit:     { fontSize: 11, fontWeight: '700' as const, color: colors.danger },
  totalCredit:    { fontSize: 11, fontWeight: '700' as const, color: colors.success },

  // ── Section label
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
    marginBottom: -spacing.xs,
  },

  // ── Format cards
  formatCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    borderColor: colors.divider,
    padding: spacing.md,
  },
  formatIconBox: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  formatTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  formatTitle:    { fontSize: 15, fontWeight: '600' as const, color: colors.textPrimary },
  formatBadge: {
    paddingHorizontal: 6, paddingVertical: 2,
    borderRadius: radius.pill,
  },
  formatBadgeText: {
    fontSize: 10, fontWeight: '800' as const,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },
  formatSubtitle: {
    fontSize: 11, fontWeight: '500' as const,
    color: colors.textSecondary,
    lineHeight: 15,
  },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 2, borderColor: colors.divider,
    alignItems: 'center', justifyContent: 'center',
    flexShrink: 0,
  },
  radioDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#fff' },

  // ── Compile button
  compileBtnWrap: { marginTop: spacing.xs },
  compileBtn: {
    height: 54,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compileBtnText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#fff',
  },

  emptyNote: {
    fontSize: 13, fontWeight: '400' as const,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: -spacing.xs,
  },
});

export default ExportSheet;
