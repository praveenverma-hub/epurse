// =============================================================================
// AddGroupExpenseScreen — the full-screen group expense form (shared
// GroupExpenseForm under a header). Three modes, by route param:
//   • new        — Groups-tab "+" FAB                     ({ groupId })
//   • edit       — an already-grouped txn                  ({ groupId, editTxnId })
//   • tag        — put an existing txn into a shared group ({ groupId, tagTxnId })
// `fromQueue` (Home review queue) also counts the action as reviewing the txn.
// =============================================================================
import React, { useRef, useState } from 'react';
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
import FormFooterActions from '../components/FormFooterActions';
import { requestAndGetLocation } from '../services/locationService';
import { useToast } from '../components/Toast';
import { useSubmitGuard } from '../hooks/useSubmitGuard';
import { useRewardStore } from '../store/useRewardStore';
import { isPayerLockedToMe } from '../utils/split';
import type { Group, GroupExpenseData } from '../types/group';

interface NavProp {
  goBack: () => void;
}
interface RouteProp {
  params?: { groupId?: string; editTxnId?: string; tagTxnId?: string; fromQueue?: boolean };
}

export default function AddGroupExpenseScreen({ navigation, route }: { navigation: NavProp; route: RouteProp }) {
  const groupId = route?.params?.groupId;
  const editTxnId = route?.params?.editTxnId;
  const tagTxnId = route?.params?.tagTxnId;
  const fromQueue = !!route?.params?.fromQueue;
  const group = useEPurseStore((s: any) =>
    (s.groups as Group[]).find((g) => g.id === groupId) || null,
  ) as Group | null;
  const editTxn = useEPurseStore((s: any) =>
    (editTxnId ? (s.transactions as any[]).find((t) => t.id === editTxnId) : null) || null,
  ) as any | null;
  const tagTxn = useEPurseStore((s: any) =>
    (tagTxnId ? (s.transactions as any[]).find((t) => t.id === tagTxnId) : null) || null,
  ) as any | null;
  const tagTransactionToGroup = useEPurseStore((s: any) => s.tagTransactionToGroup);
  const markReviewed = useEPurseStore((s: any) => s.markReviewed);
  const recordReview = useRewardStore((s: any) => s.recordReview);
  const addGroupExpense = useEPurseStore((s: any) => s.addGroupExpense) as (id: string, data: GroupExpenseData) => void;
  const updateGroupExpense = useEPurseStore((s: any) => s.updateGroupExpense) as (id: string, data: GroupExpenseData) => void;
  const isEdit = !!editTxnId;
  const isTag = !isEdit && !!tagTxnId;
  // The txn this form acts on (edit / tag) — gone if deleted meanwhile.
  const baseTxn = isEdit ? editTxn : isTag ? tagTxn : null;
  const insets = useSafeAreaInsets();
  const submitRef = useRef<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const toast = useToast();
  const { submit, submitting } = useSubmitGuard();

  // Acting on a review-queue txn counts as reviewing it (reward + leaves the queue).
  const countReview = (id: string) => {
    if (!fromQueue) return;
    recordReview();
    markReviewed(id);
  };

  const handleAdd = async (expenseData: GroupExpenseData) => {
    if (isEdit && editTxnId) {
      // Keep the existing location/createdAt — editing shouldn't re-stamp them.
      updateGroupExpense(editTxnId, expenseData);
      countReview(editTxnId);
      if (!fromQueue) toast.success('Changes saved');
      navigation.goBack();
      return;
    }
    if (isTag && tagTxnId && groupId) {
      tagTransactionToGroup(tagTxnId, groupId, expenseData.shares?.length ? {
        paidByMemberId: expenseData.paidByMemberId,
        paidByName: expenseData.paidByName,
        shares: expenseData.shares,
      } : null);
      countReview(tagTxnId);
      if (!fromQueue) toast.success('Added to group');
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
            <Text style={styles.title}>{isEdit ? 'Edit Transaction' : isTag ? 'Add to Group' : 'Add Transaction'}</Text>
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

      {group && (!(isEdit || isTag) || baseTxn) ? (
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
              onAdd={(expenseData: GroupExpenseData) => submit(() => handleAdd(expenseData))}
              editTxn={isEdit ? editTxn : undefined}
              // Tagging keeps the txn's amount; on edit, SMS txns keep their parsed
              // amount locked and manual ones stay editable.
              presetAmount={isTag ? tagTxn?.amount : isEdit && editTxn && editTxn.source !== 'manual' ? editTxn.amount : undefined}
              // Tagging: category was already decided where the txn came from.
              hideCategory={isTag}
              // A real account debit can't be re-attributed to someone else.
              lockPayerToMe={!!baseTxn && isPayerLockedToMe(baseTxn)}
              hideSubmit
              submitRef={submitRef}
              onReadyChange={setReady}
            />
          </ScrollView>

          {/* Pinned bottom bar — Cancel always; the submit once amount + merchant are filled. */}
          <View style={[styles.footer, { paddingBottom: spacing.md + insets.bottom }]}>
            <FormFooterActions
              onCancel={() => navigation.goBack()}
              submit={ready ? { title: isEdit ? 'Save Changes' : isTag ? 'Add to Group' : 'Add Expense', onPress: () => submitRef.current?.(), loading: submitting } : null}
            />
          </View>
        </KeyboardAvoidingView>
      ) : (
        <View style={styles.missing}>
          <Text style={styles.missingTxt}>
            {group ? 'This transaction is no longer available.' : 'This group is no longer available.'}
          </Text>
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
