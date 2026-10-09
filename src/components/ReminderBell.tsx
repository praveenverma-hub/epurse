// =============================================================================
// ReminderBell — the "remind me to pay" button on a person row where YOU owe
// (Lent/Borrowed list, Group Detail's Pending Settlements). The pair to the
// WhatsApp button on an "owes you" row: money you owe is your task, so you
// schedule a nudge to yourself; money owed to you is theirs, so you message them.
//
// Opens the reminder form prefilled ("Pay Rohit ₹300"); solid bell when that
// person already has one — read from the reminder REGISTRY (keyed by personKey
// in `sourceKey`), the same list the Reminders screen shows.
// =============================================================================
import React from 'react';
import { StyleSheet, TouchableOpacity } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useEPurseStore } from '../store/ePurseStore';
import { useTheme } from '../hooks/useTheme';
import { colors, withAlpha } from '../constants/theme';

export default function ReminderBell({ personKey, person, amount, style }: { personKey: string; person: string; amount: number; style?: StyleProp<ViewStyle> }) {
  const navigation = useNavigation<any>();
  const theme = useTheme();
  const reminded = useEPurseStore((s: any) => !!s.reminders?.some((r: any) => r.sourceKey === personKey));
  return (
    <TouchableOpacity
      style={[
        styles.btn,
        { backgroundColor: withAlpha(theme.primary, reminded ? 0.16 : 0.07), borderColor: withAlpha(theme.primary, reminded ? 0.4 : 0.19) },
        style,
      ]}
      onPress={(e) => {
        e.stopPropagation?.();
        // Amount + person go over STRUCTURED so the form can emphasise them in its
        // "Remind yourself to pay ₹X to Y" line and compose the notification from them.
        navigation.navigate('ReminderForm', {
          kind: 'lb_borrow',
          sourceKey: personKey,
          presetTitle: `Pay ${person}`,
          presetAmount: Math.abs(amount),
          presetPerson: person,
        });
      }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel={`Set a reminder to pay ${person}`}
    >
      <Ionicons name={reminded ? 'notifications' : 'notifications-outline'} size={16} color={reminded ? theme.primary : colors.textMuted} />
    </TouchableOpacity>
  );
}

// 28×28 tinted circle — the matched pair to the WhatsApp button (same size).
const styles = StyleSheet.create({
  btn: { width: 28, height: 28, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
