// RateFeedbackScreen — rate ePurse on its store listing (once published) and
// send free-form feedback. Distinct from Help & Support: that's "something's
// wrong", this is "here's what I think".
import React from 'react';
import { Linking, Platform, ScrollView, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';

import { spacing } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { STATIC_CONFIG } from '../config/staticConfig';
import { APP_STORE_URL, PLAY_STORE_URL, SUPPORT_EMAIL } from '../constants/appMeta';
import PlainScreenHeader from '../components/PlainScreenHeader';
import NavListRow from '../components/NavListRow';
import { hapticLight } from '../utils/haptics';

const RATING_ENABLED = STATIC_CONFIG.rating.enabled;

interface Props {
  navigation: { goBack: () => void };
}

const RateFeedbackScreen: React.FC<Props> = ({ navigation }) => {
  const theme = useTheme();

  const rateApp = () => {
    hapticLight();
    Linking.openURL(Platform.OS === 'ios' ? APP_STORE_URL : PLAY_STORE_URL);
  };

  const sendFeedback = () => {
    hapticLight();
    Linking.openURL(`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('ePurse feedback')}`);
  };

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: theme.card }]} edges={['top']}>
      <StatusBar style={theme.darkMode ? 'light' : 'dark'} />
      <PlainScreenHeader
        title="Rate & Feedback"
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
        <NavListRow
          icon="star-outline"
          label="Rate ePurse"
          hint={RATING_ENABLED ? 'Enjoying it? A rating helps others find it.' : 'Coming soon — once ePurse is live on the app stores.'}
          badge={RATING_ENABLED ? undefined : 'SOON'}
          onPress={RATING_ENABLED ? rateApp : undefined}
        />
        <NavListRow
          icon="chatbubble-ellipses-outline"
          label="Send Feedback"
          hint="A feature you'd like, or something that felt off — tell us."
          divided
          onPress={sendFeedback}
        />
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollBody: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
});

export default RateFeedbackScreen;
