// =============================================================================
// SectionBand — a settings screen's group heading: SectionHeader on a
// full-width card-coloured strip between hairlines (user's choice for
// Notifications, Oct-11-26). Every settings sub-screen with 2+ groups uses it;
// a screen with ONE group takes no heading at all. No subtitle — explanation is
// the screen's hint line, or a hint under the band.
//
// Bleeds by `spacing.lg`, the scroll padding every settings screen uses.
// =============================================================================
import React from 'react';
import { StyleSheet } from 'react-native';

import SectionHeader from './SectionHeader';
import { useTheme } from '../hooks/useTheme';
import { spacing, DIVIDER_W } from '../constants/theme';

type Props = Pick<React.ComponentProps<typeof SectionHeader>, 'icon' | 'title' | 'right'>;

const SectionBand = ({ icon, title, right }: Props) => {
  const theme = useTheme();
  return (
    <SectionHeader
      icon={icon}
      title={title}
      right={right}
      accentColor={theme.primary}
      style={[styles.band, { backgroundColor: theme.card, borderColor: theme.divider }]}
    />
  );
};

const styles = StyleSheet.create({
  band: {
    marginHorizontal: -spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm + 2,
    borderTopWidth: DIVIDER_W,
    borderBottomWidth: DIVIDER_W,
  },
});

export default SectionBand;
