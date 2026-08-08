// =============================================================================
// AddGroupExpenseScreen — full-screen "add a transaction to a group" flow,
// opened by the Groups-tab "+" FAB. Wraps the shared GroupExpenseForm under a
// themed gradient header. (Tagging an existing txn still uses GroupExpenseSheet.)
// =============================================================================
import React, { useRef } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import GroupExpenseForm from '../components/GroupExpenseForm';
import GradientButtonBase from '../components/GradientButton';
import { requestAndGetLocation } from '../services/locationService';
import { useToast } from '../components/Toast';
import type { Group, GroupExpenseData } from '../types/group';

const GradientButton = GradientButtonBase as React.FC<{ title: string; onPress: () => void; style?: object }>;

interface NavProp {
  goBack: () => void;
}
interface RouteProp {
  params?: { groupId?: string; editTxnId?: string };
}

export default function AddGroupExpenseScreen({ navigation, route }: { navigation: NavProp; route: RouteProp }) {
  const groupId = route?.params?.groupId;
  const editTxnId = route?.params?.editTxnId;
  const group = useEPurseStore((s: any) =>
    (s.groups as Group[]).find((g) => g.id === groupId) || null,
  ) as Group | null;
  const editTxn = useEPurseStore((s: any) =>
    (editTxnId ? (s.transactions as any[]).find((t) => t.id === editTxnId) : null) || null,
  ) as any | null;
  const addGroupExpense = useEPurseStore((s: any) => s.addGroupExpense) as (id: string, data: GroupExpenseData) => void;
  const updateGroupExpense = useEPurseStore((s: any) => s.updateGroupExpense) as (id: string, data: GroupExpenseData) => void;
  const isEdit = !!editTxnId;
  const insets = useSafeAreaInsets();
  const submitRef = useRef<(() => void) | null>(null);
  const toast = useToast();

  const handleAdd = async (expenseData: GroupExpenseData) => {
    if (isEdit && editTxnId) {
      // Keep the existing location/createdAt — editing shouldn't re-stamp them.
      updateGroupExpense(editTxnId, expenseData);
      toast.success('Changes saved');
      navigation.goBack();
      return;
    }
    // Manual add → capture the point of purchase (prompts first time; never blocks).
    const location = await requestAndGetLocation();
    if (groupId) addGroupExpense(groupId, location ? { ...expenseData, location } : expenseData);
    toast.success('Expense added');
    navigation.goBack();
  };

  return (
    <View style={styles.root}>
      <StatusBar style="dark" />

      <SafeAreaView edges={['top']} style={styles.headerSafe}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={10} style={styles.backBtn}>
            <Ionicons name="chevron-back" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
          <View style={styles.headerCentre}>
            <Text style={styles.title}>{isEdit ? 'Edit transaction' : 'Add transaction'}</Text>
            {/* Name the group explicitly — a bare name reads as an unlabelled
                subheading, leaving it unclear what it refers to. */}
            {group && (
              <Text style={styles.subtitle} numberOfLines={1}>
                Group · {group.emoji ? `${group.emoji} ` : ''}{group.name}
              </Text>
            )}
          </View>
          {/* Balances the back button so the title block lands on true centre. */}
          <View style={styles.backBtn} />
        </View>
      </SafeAreaView>

      {group ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <GroupExpenseForm
              group={group}
              onAdd={handleAdd}
              editTxn={isEdit ? editTxn : undefined}
              // Tagged SMS txns keep their parsed amount locked; manual ones stay editable.
              presetAmount={isEdit && editTxn && editTxn.source !== 'manual' ? editTxn.amount : undefined}
              hideSubmit
              submitRef={submitRef}
            />
          </ScrollView>

          {/* Pinned bottom bar — single primary action. */}
          <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
            <GradientButton
              title={isEdit ? 'Save changes' : 'Add Expense'}
              onPress={() => submitRef.current?.()}
              style={{ width: '100%' }}
            />
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.missing}>
          <Text style={styles.missingTxt}>This group is no longer available.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  // Gray body — see AddTransactionScreen.root for why this isn't white.
  root: { flex: 1, backgroundColor: colors.background },
  headerSafe: {
    backgroundColor: colors.card,
    borderBottomWidth: 1,
    borderBottomColor: colors.divider,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  // Fixed 40×40 box (same convention as AddTransaction / Categories) so an empty
  // spacer of the same style balances it and the title block is truly centred.
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerCentre: { flex: 1, alignItems: 'center' },
  title:    { ...typography.h2, color: colors.textPrimary, textAlign: 'center' },
  subtitle: { ...typography.small, color: colors.textSecondary, marginTop: 1, textAlign: 'center' },
  scroll: { padding: spacing.lg, paddingBottom: spacing.lg },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.divider,
  },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  missingTxt: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
