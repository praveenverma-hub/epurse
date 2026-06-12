// =============================================================================
// AddGroupExpenseScreen — full-screen "add a transaction to a group" flow,
// opened by the Groups-tab "+" FAB. Wraps the shared GroupExpenseForm under a
// themed gradient header. (Tagging an existing txn still uses GroupExpenseSheet.)
// =============================================================================
import React from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';

import { useEPurseStore } from '../store/ePurseStore';
import { colors, spacing, typography as typographyBase } from '../constants/theme';
const typography = typographyBase as unknown as Record<string, import('react-native').TextStyle>;
import GroupExpenseForm from '../components/GroupExpenseForm';
import type { Group, GroupExpenseData } from '../types/group';

interface NavProp {
  goBack: () => void;
}
interface RouteProp {
  params?: { groupId?: string };
}

export default function AddGroupExpenseScreen({ navigation, route }: { navigation: NavProp; route: RouteProp }) {
  const groupId = route?.params?.groupId;
  const group = useEPurseStore((s: any) =>
    (s.groups as Group[]).find((g) => g.id === groupId) || null,
  ) as Group | null;
  const addGroupExpense = useEPurseStore((s: any) => s.addGroupExpense) as (id: string, data: GroupExpenseData) => void;

  const handleAdd = (expenseData: GroupExpenseData) => {
    if (groupId) addGroupExpense(groupId, expenseData);
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
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Add transaction</Text>
            {group && <Text style={styles.subtitle} numberOfLines={1}>{group.name}</Text>}
          </View>
        </View>
      </SafeAreaView>

      {group ? (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        >
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
          >
            <GroupExpenseForm group={group} onAdd={handleAdd} />
          </ScrollView>
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
  backBtn: { padding: 4 },
  title:    { ...typography.h2, color: colors.textPrimary },
  subtitle: { ...typography.small, color: colors.textSecondary, marginTop: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  missingTxt: { ...typography.body, color: colors.textSecondary, textAlign: 'center' },
});
