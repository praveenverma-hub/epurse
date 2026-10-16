// The app's "+" mark for Add buttons (FAB, tab bar center Add). Drawn rather than
// Ionicons `add`, whose ~2pt stroke reads thin on a filled circle. Scales with `size`.
import React from 'react';
import Svg, { Path } from 'react-native-svg';

export default function PlusGlyph({ size = 30, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 30 30">
      <Path d="M15 6v18M6 15h18" stroke={color} strokeWidth={3} strokeLinecap="round" />
    </Svg>
  );
}
