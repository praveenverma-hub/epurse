// =============================================================================
// GoogleSignInPanel — the ONE "Sign in with Google" UI, reused by LoginGate
// (full mode: it's the only action on that screen, so it's the filled/gradient
// PRIMARY button) and the onboarding registration page (compact mode: SECONDARY
// there, outlined, since "Get Started" is that screen's actual primary action —
// two filled CTAs stacked on one screen reads as neither being the point).
// =============================================================================
import React from 'react';
import { ActivityIndicator, Pressable, View, Text, StyleSheet } from 'react-native';
import type { TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { radius, spacing, typography as typographyBase, BUTTON_H } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { useGoogleSession } from '../hooks/useGoogleSession';
import GradientButtonBase from './GradientButton';
import type { GoogleProfile } from '../backup/googleAuth';

const typography = typographyBase as unknown as Record<string, TextStyle>;

// GradientButton.js has no TS declarations, so its inferred prop type demands
// every prop — same local cast the other TS callers use (GoalsScreen, AddTransactionScreen).
const GradientButton: React.FC<{
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  style?: object;
}> = GradientButtonBase as any;

type Props = {
  /** Required in full mode (LoginGate); ignored in compact mode. */
  title?: string;
  subtitle?: string;
  onSuccess?: (account: GoogleProfile) => void;
  /** true = outlined secondary button, no icon/title/subtitle — for embedding beside another primary CTA. */
  compact?: boolean;
  disabled?: boolean;
};

const ERROR_COPY: Record<string, string> = {
  FAILED: "Sign-in didn't go through. Try again.",
  NOT_CONFIGURED: "Google sign-in isn't set up in this build yet.",
};

const GoogleSignInPanel: React.FC<Props> = ({ title, subtitle, onSuccess, compact = false, disabled = false }) => {
  const theme = useTheme();
  const { googleAccount, pending, error, signIn } = useGoogleSession();

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

  const outlineButton = (
    <Pressable
      onPress={handlePress}
      disabled={disabled || pending}
      style={({ pressed }) => [
        styles.outlineBtn,
        { borderColor: theme.primary, opacity: disabled ? 0.5 : pressed ? 0.8 : 1 },
      ]}
      accessibilityRole="button"
      accessibilityLabel="Sign in with Google"
    >
      {pending ? (
        <ActivityIndicator color={theme.primary} />
      ) : (
        <>
          <Ionicons name="logo-google" size={18} color={theme.primary} />
          <Text style={[styles.outlineBtnText, { color: theme.primary }]}>Sign In With Google</Text>
        </>
      )}
    </Pressable>
  );

  const action = googleAccount ? connected : compact ? outlineButton : (
    <GradientButton
      title="Sign In With Google"
      onPress={handlePress}
      loading={pending}
      disabled={disabled}
      style={styles.button}
    />
  );

  if (compact) {
    return (
      <View style={styles.compactContainer}>
        {action}
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
  outlineBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    minHeight: BUTTON_H, borderRadius: radius.lg, borderWidth: 1.5, backgroundColor: 'transparent',
  },
  outlineBtnText: { fontSize: 16, fontWeight: '700' },
  connectedRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, paddingVertical: spacing.sm,
  },
  connectedText: { ...typography.small, fontWeight: '600', flexShrink: 1 },
});

export default GoogleSignInPanel;
