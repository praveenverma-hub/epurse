// =============================================================================
// InfoTip — a label with an ⓘ beside it; tapping the ⓘ opens a real TOOLTIP: a
// small theme-coloured bubble with an arrow, floating next to the icon (below it, or above when
// the icon is low on screen). Tap anywhere to dismiss. For the "what is this" copy
// a form would otherwise print under every field. Errors and live status
// ("₹3,000 unallocated") are NOT tips — keep those visible.
//
// Rendered in its own transparent Modal so a scroll view can't clip it; anchored
// from the icon's window position (`measureInWindow`), clamped to the screen.
// =============================================================================
import React, { useRef, useState } from 'react';
import { View, Text, TouchableOpacity, Pressable, Modal, Platform, StyleSheet, useWindowDimensions } from 'react-native';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';
import InfoIcon from './InfoIcon';
import { useTheme } from '../hooks/useTheme';
import { radius, spacing, shadows, readableOn, typography as typographyBase } from '../constants/theme';

const typography = typographyBase as unknown as Record<string, TextStyle>;

const MAX_W = 280;
const EDGE = spacing.md;
const GAP = 8;
const ARROW = 10;
const ICON = 15;

interface Props {
  label: React.ReactNode;
  tip: string;
  /** The label's own text style (colour, case, size). */
  labelStyle?: StyleProp<TextStyle>;
  /** Spacing around the label row. */
  style?: StyleProp<ViewStyle>;
}

interface Anchor { x: number; y: number; w: number; h: number }

export default function InfoTip({ label, tip, labelStyle, style }: Props) {
  const theme = useTheme();
  const win = useWindowDimensions();
  const iconRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);

  const open = () => iconRef.current?.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }));
  const close = () => setAnchor(null);

  const ink = readableOn(theme.primary, '#FFFFFF');
  const width = Math.min(MAX_W, win.width - EDGE * 2);
  const iconCx = anchor ? anchor.x + anchor.w / 2 : 0;
  const left = Math.min(Math.max(EDGE, iconCx - width / 2), win.width - EDGE - width);
  const below = anchor ? anchor.y + anchor.h / 2 < win.height * 0.6 : true;
  const arrowLeft = Math.min(Math.max(iconCx - left - ARROW / 2, radius.md), width - radius.md - ARROW);
  const bubbleStyle: ViewStyle = anchor
    ? { left, width, ...(below ? { top: anchor.y + anchor.h + GAP } : { bottom: win.height - anchor.y + GAP }) }
    : {};

  return (
    <View style={[styles.row, style]}>
      <Text style={labelStyle}>{label}</Text>
      <TouchableOpacity
        onPress={open}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel="More information"
      >
        <View ref={iconRef} collapsable={false}>
          <InfoIcon size={ICON} color={theme.textMuted} />
        </View>
      </TouchableOpacity>

      <Modal visible={!!anchor} transparent animationType="fade" onRequestClose={close} statusBarTranslucent={Platform.OS === 'android'}>
        <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close">
          {anchor ? (
            <View style={[styles.bubble, bubbleStyle, shadows.pop, { backgroundColor: theme.primary }]}>
              <View
                style={[
                  styles.arrow,
                  below ? styles.arrowUp : styles.arrowDown,
                  { left: arrowLeft, backgroundColor: theme.primary },
                ]}
              />
              <Text style={[styles.text, { color: ink }]}>{tip}</Text>
            </View>
          ) : null}
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  backdrop: { flex: 1 },
  bubble: {
    position: 'absolute',
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  // A rotated square, half of it poking out of the bubble edge, forms the pointer.
  arrow: {
    position: 'absolute',
    width: ARROW,
    height: ARROW,
    transform: [{ rotate: '45deg' }],
  },
  arrowUp: { top: -ARROW / 2 },
  arrowDown: { bottom: -ARROW / 2 },
  text: { ...typography.small, lineHeight: 18 },
});
