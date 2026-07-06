// =============================================================================
// EditIcon — the app's single "edit / tweak" affordance. One place to change the
// glyph or icon set. Currently Octicons "pencil".
// =============================================================================

import React from 'react';
import type { StyleProp, TextStyle } from 'react-native';
import { Octicons } from '@expo/vector-icons';

interface EditIconProps {
  size?: number;
  color?: string;
  style?: StyleProp<TextStyle>;
}

const EditIcon: React.FC<EditIconProps> = ({ size = 16, color, style }) => (
  <Octicons name="pencil" size={size} color={color} style={style} />
);

export default EditIcon;
