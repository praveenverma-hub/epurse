import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';

import { useTheme } from '../hooks/useTheme';

interface Props {
  iconSize?: number;
  wordmarkSize?: number;
  color?: string;
  centered?: boolean;
  tagline?: string;
  taglineColor?: string;
}

interface InlineProps {
  size?: number;
  color?: string;
  /** Logotype weight. 900 is the brand default; drop it where the wordmark sits beside body text. */
  weight?: '700' | '800' | '900';
}

export const EPurseInlineWordmark: React.FC<InlineProps> = ({ size = 16, color, weight = '900' }) => {
  const theme = useTheme();
  const ink = color || theme.textPrimary;
  return (
    <View
      style={styles.wordmark}
      accessible
      accessibilityRole="text"
      accessibilityLabel="ePurse"
    >
      <Text style={[styles.name, styles.rotatedE, { color: ink, fontSize: size, lineHeight: size * 1.12, fontWeight: weight }]}>e</Text>
      <Text style={[styles.name, { color: ink, fontSize: size, lineHeight: size * 1.12, fontWeight: weight }]}>Purse</Text>
    </View>
  );
};

/** Filled app mark + the shared 13° ePurse wordmark used on identity screens. */
const EPurseBrandLockup: React.FC<Props> = ({
  iconSize = 58,
  wordmarkSize = 34,
  color,
  centered = true,
  tagline,
  taglineColor,
}) => {
  const theme = useTheme();
  const ink = color || theme.textPrimary;

  return (
    <View
      style={[styles.lockup, centered && styles.centered]}
      accessible
      accessibilityRole="image"
      accessibilityLabel={tagline ? `ePurse. ${tagline}` : 'ePurse'}
    >
      <Image
        source={require('../../assets/icon.png')}
        style={{ width: iconSize, height: iconSize, borderRadius: iconSize * 0.24 }}
        accessibilityIgnoresInvertColors
      />
      <View style={styles.copy} importantForAccessibility="no-hide-descendants">
        <View style={styles.wordmark}>
          <Text
            style={[
              styles.name,
              styles.rotatedE,
              { color: ink, fontSize: wordmarkSize, lineHeight: wordmarkSize * 1.12 },
            ]}
          >
            e
          </Text>
          <Text style={[styles.name, { color: ink, fontSize: wordmarkSize, lineHeight: wordmarkSize * 1.12 }]}>Purse</Text>
          <Text style={[styles.trademark, { color: ink, fontSize: Math.max(8, wordmarkSize * 0.26) }]}>TM</Text>
        </View>
        {tagline ? (
          <Text style={[styles.tagline, { color: taglineColor || theme.textSecondary }]}>{tagline}</Text>
        ) : null}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  lockup: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  centered: { alignSelf: 'center' },
  copy: { alignItems: 'flex-start' },
  wordmark: { flexDirection: 'row', alignItems: 'flex-start' },
  name: { fontWeight: '900', letterSpacing: -1.2 },
  rotatedE: { transform: [{ rotate: '-13deg' }], marginRight: -1 },
  trademark: { fontWeight: '700', marginTop: 1, marginLeft: 2, letterSpacing: -0.2 },
  tagline: { fontSize: 13, lineHeight: 16, fontWeight: '700', marginTop: 1 },
});

export default EPurseBrandLockup;
