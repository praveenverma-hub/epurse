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
import { useToast } from './Toast';
import SheetCloseButton from './SheetCloseButton';
import { colors, radius, spacing, typography } from '../constants/theme';
import { formatCurrency } from '../utils/format';
import {
  compileAndExport,
  ExportAccount,
  ExportCategory,
  ExportFilterContext,
  ExportFormat,
  ExportMethod,
  ExportTransaction,
} from '../services/exportService';
import { computeLedgerTotals } from '../utils/ledgerTotals';
import { spendExcluded } from '../store/ePurseStore';

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
  const toast      = useToast();
  const categories = useEPurseStore((s) => s.categories) as ExportCategory[];
  const accounts   = useEPurseStore((s) => s.accounts)   as ExportAccount[];
  const groups     = useEPurseStore((s) => s.groups)     as { id: string; name: string }[];
  const userName   = useEPurseStore((s) => s.userName)   as string | null;

  // Enrich each row with its resolved group name so the CSV's Group column reads
  // human names, not raw groupIds. Keeps the export service free of a groups dep.
  const exportTxns = useMemo<ExportTransaction[]>(() => {
    if (!groups?.length) return filteredTransactions;
    const nameById = Object.fromEntries(groups.map((g) => [g.id, g.name]));
    return filteredTransactions.map((t: any) =>
      t.groupId ? { ...t, groupName: nameById[t.groupId] || '' } : t
    );
  }, [filteredTransactions, groups]);

  const [selectedFormat, setSelectedFormat] = useState<ExportFormat | null>(null);
  // Which action is in flight (null = idle); drives the per-button spinner.
  const [busyMethod, setBusyMethod]         = useState<ExportMethod | null>(null);
  const loading = busyMethod !== null;

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

  // ── Totals for the context card AND the exported file ─────────────────────
  // ONE computation for both, and the same one the Activity footer uses, so a
  // statement can never disagree with the screen it was exported from. This
  // previously summed raw amounts by type with no exclusions at all: a
  // self-transfer counted as spend AND income, a split counted the whole bill
  // instead of your share, and refunds inflated income — under a PDF heading
  // that read "Total Spent" / "Total Income".
  const totals = useMemo(
    () => computeLedgerTotals(filteredTransactions as any[], groups, spendExcluded),
    [filteredTransactions, groups],
  );
  const { debit: totalDebit, credit: totalCredit } = totals;

  const fmtCompact = (n: number) => formatCurrency(isFinite(n) ? n : 0);

  // ── Export handler (share or download) ────────────────────────────────────
  const handleExport = useCallback(async (method: ExportMethod) => {
    if (!selectedFormat || loading) return;
    setBusyMethod(method);
    try {
      const result = await compileAndExport(
        method,
        selectedFormat,
        exportTxns,
        filterCtx,
        categories,
        accounts,
        userName || undefined,
        totals,
      );
      if (result.outcome === 'saved') {
        toast.success(
          'Saved',
          `${selectedFormat.toUpperCase()} saved to ${result.location ?? 'your device'}.`,
        );
      }
      // Close only after share sheet dismissed (iOS awaits, Android resolves early)
      handleClose();
    } catch (err: any) {
      const msg = String(err?.message ?? '').toLowerCase();
      // 'cancel'/'dismiss' means user cancelled the share sheet — not an error
      if (!msg.includes('cancel') && !msg.includes('dismiss')) {
        Alert.alert(
          method === 'download' ? 'Download failed' : 'Export failed',
          'Could not generate the file. Please try again.',
          [{ text: 'OK' }],
        );
      }
    } finally {
      setBusyMethod(null);
    }
  }, [selectedFormat, loading, exportTxns, filterCtx, categories, accounts, userName, handleClose, toast]);

  const canExport = !!selectedFormat && !loading && filteredTransactions.length > 0;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={handleClose}
    >
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={handleClose} />
        {/* handleClose (not onClose) — it no-ops while an export is running. */}
        <SheetCloseButton onPress={handleClose} />

        <View style={styles.sheet}>
          <View style={styles.handle} />

          {/* ── Header ── */}
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Export Transactions</Text>
              <Text style={styles.subtitle}>Compile & share your current statement</Text>
            </View>
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

          {/* ── Action buttons: Download + Share ── */}
          <View style={styles.actionRow}>
            {/* Download — saves a copy to the device (Files / a chosen folder) */}
            <TouchableOpacity
              onPress={() => handleExport('download')}
              disabled={!canExport}
              activeOpacity={0.85}
              style={[styles.outlineBtn, { borderColor: canExport ? theme.primary : colors.divider }]}
            >
              {busyMethod === 'download' ? (
                <ActivityIndicator size="small" color={theme.primary} />
              ) : (
                <>
                  <Ionicons
                    name="download-outline"
                    size={18}
                    color={canExport ? theme.primary : colors.textMuted}
                    style={{ marginRight: 6 }}
                  />
                  <Text
                    style={[styles.outlineBtnText, { color: canExport ? theme.primary : colors.textMuted }]}
                  >
                    Download
                  </Text>
                </>
              )}
            </TouchableOpacity>

            {/* Share — hands the file to the OS share sheet */}
            <TouchableOpacity
              onPress={() => handleExport('share')}
              disabled={!canExport}
              activeOpacity={0.85}
              style={styles.gradientBtnWrap}
            >
              <LinearGradient
                colors={
                  canExport
                    ? ([theme.gradientStart, theme.gradientEnd] as [string, string])
                    : (['#C8C8C8', '#ADADAD'] as [string, string])
                }
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.gradientBtn}
              >
                {busyMethod === 'share' ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Ionicons name="share-outline" size={18} color="#fff" style={{ marginRight: 6 }} />
                    <Text style={styles.gradientBtnText}>Share</Text>
                  </>
                )}
              </LinearGradient>
            </TouchableOpacity>
          </View>

          <Text style={styles.actionHint}>
            {filteredTransactions.length === 0
              ? 'No transactions match the current filters — nothing to export.'
              : !selectedFormat
              ? 'Select a format above to enable export.'
              : `Download saves the ${selectedFormat.toUpperCase()} to your device · Share opens the share sheet.`}
          </Text>
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
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
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

  // ── Action buttons (Download + Share)
  actionRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  outlineBtn: {
    flex: 1,
    height: 54,
    borderRadius: radius.lg,
    borderWidth: 1.5,
    backgroundColor: colors.card,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  outlineBtnText: {
    fontSize: 16,
    fontWeight: '800' as const,
  },
  gradientBtnWrap: { flex: 1 },
  gradientBtn: {
    height: 54,
    borderRadius: radius.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gradientBtnText: {
    fontSize: 16,
    fontWeight: '800' as const,
    color: '#fff',
  },

  actionHint: {
    fontSize: 12, fontWeight: '400' as const,
    color: colors.textMuted,
    textAlign: 'center' as const,
    marginTop: -spacing.xs,
    lineHeight: 16,
  },
});

export default ExportSheet;
