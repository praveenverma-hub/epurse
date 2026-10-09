// =============================================================================
// AnchoredMenu — the small popover menu that opens from a trigger: positioning,
// backdrop and the menu box, shared by InlineDropdown (pick a value) and
// OverflowMenu (⋮ actions). Rows are `MenuRow`s.
//
// It's a `Modal`, not an absolutely-positioned sibling: it has to escape any
// clipping parent (a horizontal chip row, a card) and paint over the list.
// Position comes from the caller's `measureInWindow` on the trigger and is
// CLAMPED to the screen, so a trigger near an edge still opens a fully visible
// menu; it flips above the trigger when there's no room below.
// =============================================================================
import React from 'react';
import { Dimensions, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { TextStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Modal from './AppModal';
import { colors, radius, readableOn, shadows, spacing, typography as typographyBase } from '../constants/theme';

const typography = typographyBase as unknown as Record<string, TextStyle>;

export const MENU_ROW_H = 44;
const EDGE = spacing.sm; // keep-away from the screen edges
const GAP = 6;           // trigger → menu

export interface MenuAnchor { x: number; y: number; w: number; h: number }

interface AnchoredMenuProps {
  /** Trigger's window rect; null = closed. */
  anchor: MenuAnchor | null;
  onClose: () => void;
  /** Runs once the menu is fully gone — open another modal from HERE, not from a
   *  row press (iOS silently drops a modal presented while one is dismissing). */
  onClosed?: () => void;
  rowCount: number;
  width: number;
  children: React.ReactNode;
}

export default function AnchoredMenu({ anchor, onClose, onClosed, rowCount, width, children }: AnchoredMenuProps) {
  const screen = Dimensions.get('window');
  const menuH = rowCount * MENU_ROW_H + spacing.xs * 2;
  const below = (anchor?.y ?? 0) + (anchor?.h ?? 0) + GAP;
  const opensDown = below + menuH + EDGE <= screen.height;
  return (
    <Modal
      visible={anchor !== null}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      onDismiss={Platform.OS === 'ios' ? onClosed : undefined}
    >
      {/* Full-screen catcher: a tap anywhere outside closes. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      {anchor ? (
        <View
          accessibilityRole="menu"
          style={[
            styles.menu,
            {
              width,
              left: Math.min(Math.max(anchor.x, EDGE), Math.max(EDGE, screen.width - width - EDGE)),
              top: opensDown ? below : Math.max(EDGE, anchor.y - menuH - GAP),
            },
          ]}
        >
          {children}
        </View>
      ) : null}
    </Modal>
  );
}

const DESTRUCTIVE_INK = readableOn(colors.card, colors.danger);

/** One menu row: optional leading icon, a check when `selected`, red when `destructive`. */
export function MenuRow({ label, onPress, icon, selected, destructive, accentColor = colors.primary }: {
  label: string;
  onPress: () => void;
  icon?: React.ReactNode;
  selected?: boolean;
  destructive?: boolean;
  accentColor?: string;
}) {
  const ink = destructive ? DESTRUCTIVE_INK : selected ? accentColor : colors.textPrimary;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="menuitem"
      accessibilityState={{ selected: !!selected }}
      style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
    >
      {icon ? <View style={styles.rowIcon}>{icon}</View> : null}
      <Text style={[styles.rowText, { color: ink }, selected && styles.rowTextSelected]}>{label}</Text>
      {selected ? <Ionicons name="checkmark" size={16} color={accentColor} /> : null}
    </Pressable>
  );
}

/** Ink for a row's leading icon — same rule as MenuRow's label. */
export const menuIconInk = (destructive?: boolean) => (destructive ? DESTRUCTIVE_INK : colors.textSecondary);

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFill },
  menu: {
    position: 'absolute',
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    // A popover floating over the content -> `elevated`.
    ...shadows.elevated,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MENU_ROW_H,
    paddingHorizontal: spacing.md,
  },
  rowPressed: { backgroundColor: colors.background },
  rowIcon: { width: 20, alignItems: 'center' },
  rowText: { ...typography.body, flex: 1 },
  rowTextSelected: { fontWeight: '700' },
});
