// =============================================================================
// SettingsScreen — app settings as a real pushed screen.
//
// Was a bottom sheet inside RewardShop (Region D, Jul-28). A sheet was the wrong
// container once it held more than two rows: it can't grow (the recap sub-toggles
// already pushed it near its limit), it isn't deep-linkable, and every nav row had
// to dismiss it manually before pushing. As a screen it scrolls, gets a back
// button, and each section can be extended without a layout budget.
//
// Sections, in order of how often they're touched:
//   Appearance (theme)  →  Monthly recap (+ what the report includes)  →  Manage.
//
// Backup used to be a section here. It MOVED to the Profile hub (Aug-31): it is
// its own screen, so a nav row inside a settings section put it three taps from
// home for no reason. It is not duplicated — one entry point, on the hub.
//
// "Appearance" used to live at the top of CategoriesScreen, which is why that
// screen was titled "Categories & Settings". Theme has nothing to do with
// categories; it now has its own section here and CategoriesScreen is just
// categories again.
// =============================================================================

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Switch } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography, shadows } from '../constants/theme';
import { THEMES } from '../constants/themes';
import { useTheme } from '../hooks/useTheme';
import SectionHeader from '../components/SectionHeader';
import NavListRow from '../components/NavListRow';
import PlainScreenHeader from '../components/PlainScreenHeader';

const RECAP_INCLUDES = [
  { key: 'includePrivate', label: 'Private transactions' },
  { key: 'includeGroups',  label: 'Group & trip spend' },
  { key: 'includeTxnList', label: 'Full transaction list (PDF)' },
];

// Ionicons, not emoji: emoji render at the OS's mercy (different glyph per platform and
// version, inconsistent optical weight next to the Switch rows) and can't take the theme
// accent. Names follow ui-consistency §5. Category emoji stay emoji — there they're the
// category's own identity, not chrome.
const MANAGE_ROWS = [
  // `hint: null` → computed per-render below (needs store state).
  { icon: 'calculator-outline', label: 'Counts as expense', hint: null,                         route: 'SpendRules' },
  { icon: 'pricetags-outline',  label: 'Categories',        hint: 'Add or remove your own',      route: 'Categories' },
  { icon: 'flask-outline',      label: 'SMS Diagnostic',    hint: 'See how messages are parsed', route: 'SmsDiagnostic' },
];

const SettingsScreen = ({ navigation }) => {
  const theme = useTheme();

  const themeId            = useEPurseStore((s) => s.themeId);
  const setThemeId         = useEPurseStore((s) => s.setThemeId);
  const showMonthlyRecap   = useEPurseStore((s) => s.showMonthlyRecap);
  const setShowMonthlyRecap = useEPurseStore((s) => s.setShowMonthlyRecap);
  const recapOptions       = useEPurseStore((s) => s.recapOptions);
  const excludedExpenseParents = useEPurseStore((s) => s.excludedExpenseParents);
  const setRecapOption     = useEPurseStore((s) => s.setRecapOption);

  const excludedCount = (excludedExpenseParents || []).length;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Light header painted from the static palette → dark glyphs (status-bar skill). */}
      <StatusBar style="dark" />
      <PlainScreenHeader title="Settings" onBack={() => navigation.goBack()} />

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* ── Appearance ─────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader icon="color-palette-outline" title="Appearance" accentColor={theme.primary} />
          <Text style={styles.hint}>
            Pick an accent — gradients, buttons and highlights update across the app.
          </Text>
          <View style={styles.themeRow}>
            {Object.values(THEMES).map((t) => {
              const active = themeId === t.id;
              return (
                <TouchableOpacity
                  key={t.id}
                  onPress={() => setThemeId(t.id)}
                  style={[styles.themeTile, active && { borderColor: t.primary, borderWidth: 2 }]}
                  activeOpacity={0.85}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: active }}
                  accessibilityLabel={`${t.label} theme`}
                >
                  <LinearGradient
                    // `gradientStops` so Platinum's swatch shows its sheen, not a flat pair.
                    colors={t.gradientStops || [t.gradientStart, t.gradientEnd]}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}
                    style={styles.themeSwatch}
                  >
                    {active ? <Text style={styles.themeCheck}>✓</Text> : null}
                  </LinearGradient>
                  <Text
                    style={[styles.themeLabel, active && { color: t.primary, fontWeight: '700' }]}
                    numberOfLines={1}
                  >
                    {t.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
        </View>

        {/* ── Monthly recap ──────────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader icon="document-text-outline" title="Monthly recap" accentColor={theme.primary} />
          <Text style={styles.hint}>
            A month-end summary card, modal and downloadable PDF.
          </Text>
          <View style={styles.row}>
            <Ionicons name="stats-chart-outline" size={18} color={theme.primary} style={styles.rowIcon} />
            <Text style={styles.rowLabel}>Show monthly recap</Text>
            <Switch
              value={!!showMonthlyRecap}
              onValueChange={setShowMonthlyRecap}
              trackColor={{ true: theme.primary, false: colors.divider }}
              thumbColor="#fff"
              ios_backgroundColor={colors.divider}
            />
          </View>

          {/* Only meaningful while the recap is on — hidden rather than disabled, so
              the section doesn't show controls that can't do anything. */}
          {showMonthlyRecap ? (
            <>
              <Text style={styles.sub}>Report includes</Text>
              {RECAP_INCLUDES.map(({ key, label }) => (
                <View key={key} style={[styles.row, styles.subRow]}>
                  <Text style={styles.subLabel}>{label}</Text>
                  <Switch
                    value={!!recapOptions?.[key]}
                    onValueChange={(v) => setRecapOption(key, v)}
                    trackColor={{ true: theme.primary, false: colors.divider }}
                    thumbColor="#fff"
                    ios_backgroundColor={colors.divider}
                  />
                </View>
              ))}
            </>
          ) : null}
        </View>

        {/* ── Manage ─────────────────────────────────────────────────────── */}
        <View style={styles.card}>
          <SectionHeader icon="options-outline" title="Manage" accentColor={theme.primary} />
          {MANAGE_ROWS.map(({ icon, label, hint, route }, i) => (
            <NavListRow
              key={route}
              icon={icon}
              label={label}
              divided={i > 0}
              onPress={() => navigation.navigate(route)}
              /* An exclusion has to be visible from OUTSIDE the screen that set it —
                 otherwise "why is Spent low?" has no discoverable answer. */
              hint={
                route === 'SpendRules'
                  ? (excludedCount > 0
                      ? `${excludedCount} categor${excludedCount === 1 ? 'y' : 'ies'} not counted`
                      : 'All categories counted')
                  : hint
              }
              hintTone={route === 'SpendRules' && excludedCount > 0 ? 'warn' : 'default'}
            />
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginBottom: spacing.md,
    ...shadows.card,
  },
  // marginBottom lives on sectionHead now — the heading itself carries no layout.
  hint: { ...typography.small, color: colors.textSecondary, marginBottom: spacing.md },
  sub: {
    ...typography.small,
    color: colors.textSecondary,
    marginTop: spacing.md,
    marginBottom: spacing.xs,
    fontWeight: '600',
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  // Fixed width so every label starts at the same x, whatever the glyph.
  rowIcon: { width: 22, textAlign: 'center' },
  rowLabel: { ...typography.body, color: colors.textPrimary, flex: 1, fontWeight: '600' },
  subRow: { paddingLeft: spacing.xl },
  subLabel: { ...typography.small, color: colors.textPrimary, flex: 1 },

  // Theme picker — moved here verbatim from CategoriesScreen (Aug-26).
  themeRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  themeTile: {
    alignItems: 'center',
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: 'transparent',
    gap: 6,
    flexBasis: '22%',
  },
  themeSwatch: {
    width: 56,
    height: 56,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  themeCheck: { color: '#fff', fontSize: 24, fontWeight: '800' },
  themeLabel: { ...typography.tiny, color: colors.textSecondary, fontWeight: '600' },
});

export default SettingsScreen;
