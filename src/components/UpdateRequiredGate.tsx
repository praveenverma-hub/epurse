// =============================================================================
// UpdateRequiredGate — the HARD update wall, as a bottom sheet.
//
// Mounted once at the root (App.js) as the LAST sibling, above AppLockGate and
// LoginGate: if this build is no longer supported, unlocking it and signing in
// both lead nowhere, so this outranks them. A native `Modal`, not a navigator
// route — so it can appear over WHATEVER is on screen with no navigation.reset.
//
// Dismissal contract, same shape as EpcClaimBottomSheet's (the other
// non-dismissable sheet in the app):
//   • Cannot be dismissed by tapping the backdrop, swipe, or Android back.
//   • No SheetCloseButton — unlike EpcClaimBottomSheet, there IS no action
//     that legitimately closes this one. Tapping "Update ePurse" opens the
//     store listing; it does not (cannot) confirm the update actually
//     happened, so the sheet keeps showing. It only stops rendering the next
//     time `blocked` is recomputed false — i.e. after the app is actually
//     updated and relaunched on a supported version.
//
// There is no local data loss in being blocked: everything is on the device
// and comes back the moment a supported build is installed over the top. The
// copy says so, because "update to continue" with no reassurance reads like a
// threat to someone's records.
// =============================================================================
import React from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { radius, spacing, shadows, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useAppUpdate } from '../hooks/useAppUpdate';
import { APP_STORE_URL, PLAY_STORE_URL } from '../constants/appMeta';
import GradientButtonBase from './GradientButton';

const typography = typographyBase as unknown as Record<string, TextStyle>;

// GradientButton.js has no TS declarations — same local cast its other TS
// callers use (GoogleSignInPanel, GoalsScreen).
const GradientButton: React.FC<{ title: string; onPress: () => void; style?: object }> =
  GradientButtonBase as any;

const DEFAULT_MESSAGE =
  'This version of ePurse is no longer supported. Update to carry on — everything on this device stays exactly where it is.';

/** Opens the platform store listing. Never throws — there is nowhere useful to surface a failure from a wall the user cannot get off of. */
export const openStoreListing = (): void => {
  const url = Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL;
  Linking.openURL(url).catch(() => {});
};

const UpdateRequiredGate: React.FC = () => {
  const theme = useTheme();
  const { blocked, message } = useAppUpdate();

  if (!blocked) return null;

  return (
    <Modal
      visible
      transparent
      animationType="slide"
      statusBarTranslucent
      // No-op — hardware back cannot dismiss this sheet.
      onRequestClose={() => {}}
    >
      {/* Backdrop — receives outside taps but does NOT close, same as EpcClaimBottomSheet. */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => { /* locked */ }} />

        <SafeAreaView edges={['bottom']} style={styles.safe}>
          <View style={[styles.sheet, { backgroundColor: theme.card }]}>
            <View style={[styles.handle, { backgroundColor: theme.divider }]} />

            <View style={[styles.iconWrap, { backgroundColor: theme.primary + '1A' }]}>
              <Ionicons name="arrow-up-circle" size={28} color={theme.primary} />
            </View>
            <Text style={[styles.title, { color: theme.textPrimary }]}>Update Required</Text>
            <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{message ?? DEFAULT_MESSAGE}</Text>
            <GradientButton title="Update ePurse" onPress={openStoreListing} style={styles.button} />
          </View>
        </SafeAreaView>
      </View>
    </Modal>
  );
};

export default UpdateRequiredGate;

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#0008', justifyContent: 'flex-end' },
  safe: { backgroundColor: 'transparent' },
  sheet: {
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
    alignItems: 'center',
    // Bottom sheet -> `sheet` rung casts its shadow UPWARD, toward the
    // content it covers (ui-consistency §6b-i).
    ...shadows.sheet,
  },
  handle: { width: 40, height: 4, borderRadius: 2, marginBottom: spacing.lg },
  iconWrap: {
    width: 64, height: 64, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  title: { ...typography.h3, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: { ...typography.small, textAlign: 'center', marginBottom: spacing.lg, lineHeight: 20 },
  button: { alignSelf: 'stretch', width: '100%' },
});
