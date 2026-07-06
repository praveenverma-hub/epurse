// =============================================================================
// InfoIcon — the app's single "ⓘ info" affordance. One place to change the glyph
// or icon set. Currently MaterialIcons "info-outline".
// =============================================================================

import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { MaterialIcons } from '@expo/vector-icons';

interface InfoIconProps {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

const InfoIcon: React.FC<InfoIconProps> = ({ size = 18, color, style }) => (
  <MaterialIcons name="info-outline" size={size} color={color} style={style} />
);

export default InfoIcon;
