// AboutScreen — app identity + version. No legal docs yet (Terms/Privacy) —
// add rows for those once real ones exist, rather than linking to nothing.
import React from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { APP_NAME, APP_VERSION } from '../constants/appMeta';
import PlainScreenHeader from '../components/PlainScreenHeader';

const typography = typographyBase as unknown as Record<string, TextStyle>;

interface Props {
  navigation: { goBack: () => void };
}

const AboutScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="About"
        onBack={() => navigation.goBack()}
        tint={theme.textPrimary}
        titleColor={theme.textPrimary}
        bordered
        surfaceColor={theme.card}
        dividerColor={theme.divider}
      />

      <ScrollView
        style={[styles.scrollBody, { backgroundColor: theme.background }]}
        contentContainerStyle={styles.scroll}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.identity}>
          <Image source={require('../../assets/icon.png')} style={styles.icon} />
          <Text style={[styles.appName, { color: theme.textPrimary }]}>{APP_NAME}</Text>
          <Text style={[styles.version, { color: theme.textSecondary }]}>Version {APP_VERSION}</Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  identity: { alignItems: 'center', paddingTop: spacing.xl, gap: spacing.xs },
  icon: { width: 72, height: 72, borderRadius: radius.xl, marginBottom: spacing.sm },
  appName: { ...typography.h2 },
  version: { ...typography.small },
});

export default AboutScreen;
