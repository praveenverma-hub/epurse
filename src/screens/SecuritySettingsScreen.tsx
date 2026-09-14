// SecuritySettingsScreen — app-open lock (Face ID/Fingerprint), enforced by
// AppLockGate at the app root. This screen only owns the toggle + device
// capability check; the actual gate lives in App.js so it covers every screen.
import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as LocalAuthentication from 'expo-local-authentication';

import { useEPurseStore } from '../store/ePurseStore';
import { radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import PlainScreenHeader from '../components/PlainScreenHeader';
import AppSwitch from '../components/AppSwitch';

const typography = typographyBase as unknown as Record<string, TextStyle>;

interface Props {
  navigation: { goBack: () => void };
}

const SecuritySettingsScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();
  const appLockEnabled = useEPurseStore((s: any) => s.appLockEnabled) as boolean;
  const setAppLockEnabled = useEPurseStore((s: any) => s.setAppLockEnabled);

  // 'checking' | 'available' | 'no-hardware' | 'not-enrolled'
  const [capability, setCapability] = useState<'checking' | 'available' | 'no-hardware' | 'not-enrolled'>('checking');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      if (!hasHardware) { if (!cancelled) setCapability('no-hardware'); return; }
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      if (!cancelled) setCapability(enrolled ? 'available' : 'not-enrolled');
    })();
    return () => { cancelled = true; };
  }, []);

  const unavailable = capability === 'no-hardware' || capability === 'not-enrolled';

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="Security"
        onBack={() => navigation.goBack()}
        tint={theme.textPrimary}
        titleColor={theme.textPrimary}
        bordered
        surfaceColor={theme.card}
        dividerColor={theme.divider}
      />

      <View style={[styles.body, { backgroundColor: theme.background }]}>
        <View style={styles.row}>
          <Ionicons name="finger-print-outline" size={20} color={theme.primary} style={styles.rowIcon} />
          <View style={styles.rowMid}>
            <Text style={[styles.rowLabel, { color: theme.textPrimary }]}>App Lock</Text>
            <Text style={[styles.rowHint, { color: theme.textSecondary }]}>
              Face ID or Fingerprint to open ePurse
            </Text>
          </View>
          <AppSwitch
            value={appLockEnabled}
            onValueChange={setAppLockEnabled}
            disabled={unavailable}
            trackColor={{ true: theme.primary, false: theme.divider }}
            thumbColor="#fff"
            ios_backgroundColor={theme.divider}
          />
        </View>

        {unavailable ? (
          <View style={[styles.noteRow, { backgroundColor: theme.warning + '14', borderColor: theme.warning + '33' }]}>
            <Ionicons name="information-circle-outline" size={15} color={theme.warning} />
            <Text style={[styles.noteText, { color: theme.warning }]}>
              {capability === 'no-hardware'
                ? "This device has no Face ID or Fingerprint sensor, so App Lock isn't available."
                : 'Set up Face ID or Fingerprint in your device settings first, then come back to turn this on.'}
            </Text>
          </View>
        ) : (
          <Text style={[styles.hint, { color: theme.textSecondary }]}>
            When on, ePurse asks for Face ID or Fingerprint every time you open the app or
            return to it from the background. Your backup password is separate — this only
            controls opening the app on this device.
          </Text>
        )}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  body: { flex: 1, padding: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm + 2 },
  rowIcon: { width: 22, textAlign: 'center' },
  rowMid: { flex: 1 },
  rowLabel: { ...typography.body, fontWeight: '600' },
  rowHint: { ...typography.tiny, marginTop: 1 },
  hint: { ...typography.small, marginTop: spacing.md, lineHeight: 19 },
  noteRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    marginTop: spacing.md,
  },
  noteText: { ...typography.tiny, fontWeight: '600', flex: 1, lineHeight: 16 },
});

export default SecuritySettingsScreen;
