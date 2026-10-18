// =============================================================================
// GoogleSignInPanel — the ONE "Sign in with Google" UI, reused by LoginGate
// (full mode: icon + title + subtitle) and the onboarding registration page
// (compact mode: the button alone, under that page's own title). Either way it's
// the screen's only action, so it's the filled PRIMARY button.
// =============================================================================
import React from 'react';
import { Pressable, View, StyleSheet } from 'react-native';
import { Text } from './AppText';
import type { TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useGoogleSession } from '../hooks/useGoogleSession';
import { IS_DEV_BUILD } from '../constants/buildVariant';
import PrimaryButtonBase from './PrimaryButton';
import type { GoogleProfile } from '../backup/googleAuth';

const typography = typographyBase as unknown as Record<string, TextStyle>;

// PrimaryButton.js has no TS declarations, so its inferred prop type demands
// every prop — same local cast the other TS callers use (GoalsScreen, AddTransactionScreen).
const PrimaryButton: React.FC<{
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: object;
}> = PrimaryButtonBase as any;

type Props = {
  /** Required in full mode (LoginGate); ignored in compact mode. */
  title?: string;
  subtitle?: string;
  onSuccess?: (account: GoogleProfile) => void;
  /** true = the button alone, no icon/title/subtitle — for a screen that has its own. */
  compact?: boolean;
  disabled?: boolean;
};

const ERROR_COPY: Record<string, string> = {
  FAILED: "Sign-in didn't go through. Try again.",
  NOT_CONFIGURED: "Google sign-in isn't set up in this build yet.",
};

const GoogleSignInPanel: React.FC<Props> = ({ title, subtitle, onSuccess, compact = false, disabled = false }) => {
  const theme = useTheme();
  const { googleAccount, pending, error, signIn, devBypass } = useGoogleSession();

  const handlePress = async () => {
    try {
      const account = await signIn();
      onSuccess?.(account);
    } catch {
      // Errors are surfaced via the hook's `error` state below — cancellation
      // (AuthError.code === 'CANCELLED') is a choice, not an error, and shows nothing.
    }
  };

  // NO_GRANT already carries a user-facing message from googleAuth.ts itself.
  const errorText = error && error.code !== 'CANCELLED'
    ? (error.code === 'NO_GRANT' ? error.message : ERROR_COPY[error.code] || error.message)
    : null;

  const connected = googleAccount ? (
    <View style={styles.connectedRow}>
      <Ionicons name="checkmark-circle" size={18} color={theme.success} />
      <Text style={[styles.connectedText, { color: theme.textSecondary }]} numberOfLines={1}>
        Signed in as {googleAccount.email}
      </Text>
    </View>
  ) : null;

  // In a dev build, the real button is hidden entirely — only the debug skip
  // below is shown, since real Google sign-in needs Cloud Console setup
  // (scopes, test users) that's easy to have broken mid-development and was
  // blocking work on everything else. IS_DEV_BUILD is false in preview/store
  // builds, where the real button always renders as normal.
  const action = googleAccount ? connected : IS_DEV_BUILD ? null : (
    <PrimaryButton
      title="Sign In With Google"
      onPress={handlePress}
      loading={pending}
      disabled={disabled}
      style={styles.button}
    />
  );

  const handleDevBypass = () => {
    const account = devBypass();
    if (account) onSuccess?.(account);
  };

  const devSkip = !googleAccount && IS_DEV_BUILD ? (
    <Pressable onPress={handleDevBypass} disabled={disabled} hitSlop={8} style={styles.devSkip}>
      <Text style={[styles.devSkipText, { color: theme.textSecondary }]}>Skip sign-in (Debug)</Text>
    </Pressable>
  ) : null;

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        {action}
        {devSkip}
        {errorText ? <Text style={[styles.error, { color: theme.danger }]}>{errorText}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={[styles.iconWrap, { backgroundColor: theme.primary + '1A' }]}>
        <Ionicons name="logo-google" size={28} color={theme.primary} />
      </View>
      <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text>
      {subtitle ? <Text style={[styles.subtitle, { color: theme.textSecondary }]}>{subtitle}</Text> : null}
      {action}
      {devSkip}
      {errorText ? <Text style={[styles.error, { color: theme.danger }]}>{errorText}</Text> : null}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingHorizontal: spacing.lg },
  compactContainer: { marginTop: spacing.md },
  iconWrap: {
    width: 64, height: 64, borderRadius: radius.xl,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.lg,
  },
  title: { ...typography.h3, textAlign: 'center', marginBottom: spacing.xs },
  subtitle: {
    ...typography.small, textAlign: 'center',
    marginBottom: spacing.lg, lineHeight: 20,
  },
  error: { ...typography.tiny, textAlign: 'center', fontWeight: '600', marginTop: spacing.sm },
  button: { width: '100%', marginTop: spacing.sm },
  connectedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: spacing.sm,
  },
  connectedText: { ...typography.small, fontWeight: '600', flexShrink: 1 },
  devSkip: { alignItems: 'center', paddingVertical: spacing.sm },
  devSkipText: { ...typography.tiny, textDecorationLine: 'underline' },
});

export default GoogleSignInPanel;
