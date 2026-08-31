// =============================================================================
// InlineDropdown — a chip that opens a short anchored menu.
//
// For a 2–5 option choice that belongs INLINE with the content it arranges
// (Activity's Sort / Group). A bottom sheet is the app's answer for a long or
// searchable list; it is too much travel for "newest or oldest", and it hides the
// list you are deciding about.
//
// The trigger reads `Label: value ▾` and TINTS when the value is off-default, so
// a list that has been re-arranged always looks re-arranged — the same rule the
// quick chips follow. Without it, a user who sorted by amount and scrolled away
// has no way to tell why the order looks wrong.
//
// The menu is a `Modal`, not an absolutely-positioned sibling: it has to escape
// the horizontally-scrolling row it lives in (which would clip it) and paint over
// the list. Position comes from `measureInWindow` on the trigger and is CLAMPED to
// the screen, so a trigger near the right edge or near the bottom still opens a
// fully visible menu.
// =============================================================================
import React, { useCallback, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import type { TextStyle } from 'react-native';

const typography = typographyBase as unknown as Record<string, TextStyle>;

const MENU_MIN_W = 184;
const EDGE = spacing.sm;          // keep-away from the screen edges
const GAP = 6;                    // trigger → menu

export interface DropdownOption {
  id: string;
  /** Full text in the menu. */
  label: string;
  /** Compact text on the trigger. Falls back to `label`. */
  short?: string;
}

export interface InlineDropdownProps {
  /** Static prefix on the trigger — "Sort", "Group". */
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (id: string) => void;
  /** The value at which this control is considered untouched (no tint). */
  defaultValue?: string;
  /** Leading glyph on the trigger. */
  icon?: keyof typeof Ionicons.glyphMap;
  style?: ViewStyle;
}

const InlineDropdown: React.FC<InlineDropdownProps> = ({
  label,
  value,
  options,
  onChange,
  defaultValue,
  icon,
  style,
}) => {
  const theme = useTheme();
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

  const current = options.find((o) => o.id === value) ?? options[0];
  const touched = defaultValue !== undefined && value !== defaultValue;

  const open = useCallback(() => {
    // Measure first, THEN open: opening on the previous frame's position makes the
    // menu jump on the first render after any layout change (rotation, a chip
    // appearing beside it).
    triggerRef.current?.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }));
  }, []);

  const screen = Dimensions.get('window');
  const menuW = Math.max(MENU_MIN_W, anchor?.w ?? 0);
  // Rows are ~44 tall; enough to decide whether the menu fits below the trigger.
  const menuH = options.length * 44 + spacing.xs * 2;
  const below = (anchor?.y ?? 0) + (anchor?.h ?? 0) + GAP;
  const opensDown = below + menuH + EDGE <= screen.height;

  const ink = touched ? '#fff' : colors.textSecondary;

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={open}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${current?.label ?? ''}`}
        accessibilityHint="Opens a list of options"
        style={[
          styles.trigger,
          touched && { backgroundColor: theme.primary, borderColor: theme.primary },
          style,
        ]}
      >
        {icon ? <Ionicons name={icon} size={13} color={ink} style={styles.triggerIcon} /> : null}
        <Text style={[styles.triggerText, { color: ink }]} numberOfLines={1}>
          {`${label}: `}
          <Text style={styles.triggerValue}>{current?.short ?? current?.label ?? ''}</Text>
        </Text>
        <Ionicons name="chevron-down" size={12} color={ink} style={styles.triggerChevron} />
      </Pressable>

      <Modal
        visible={anchor !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setAnchor(null)}
      >
        {/* Full-screen catcher: a tap anywhere outside closes, which is the only
            dismissal a menu this small needs. */}
        <Pressable style={styles.backdrop} onPress={() => setAnchor(null)} accessibilityLabel="Close menu" />
        {anchor ? (
          <View
            style={[
              styles.menu,
              {
                width: menuW,
                left: Math.min(Math.max(anchor.x, EDGE), Math.max(EDGE, screen.width - menuW - EDGE)),
                ...(opensDown
                  ? { top: below }
                  : { top: Math.max(EDGE, anchor.y - menuH - GAP) }),
              },
            ]}
          >
            {options.map((o) => {
              const selected = o.id === current?.id;
              return (
                <Pressable
                  key={o.id}
                  onPress={() => { setAnchor(null); if (!selected) onChange(o.id); }}
                  accessibilityRole="menuitem"
                  accessibilityState={{ selected }}
                  style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                >
                  <Text style={[styles.rowText, selected && { color: theme.primary, fontWeight: '700' }]}>
                    {o.label}
                  </Text>
                  {selected ? <Ionicons name="checkmark" size={16} color={theme.primary} /> : null}
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </Modal>
    </>
  );
};

export default InlineDropdown;

const styles = StyleSheet.create({
  // Metrics mirror the Activity quick chip so the two sit on one visual line.
  trigger: {
    flexDirection: 'row',
    alignItems: 'center',
    // 34 to match Activity's quick chip exactly — the two sit on one line, and a
    // 2pt difference in height reads as a rendering fault rather than a variant.
    height: 34,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    maxWidth: 200,
  },
  triggerIcon: { marginRight: 4 },
  triggerChevron: { marginLeft: 4 },
  triggerText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  triggerValue: { fontWeight: '800' },
  backdrop: { ...StyleSheet.absoluteFillObject },
  menu: {
    position: 'absolute',
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.divider,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.14,
    shadowRadius: 16,
    elevation: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  rowPressed: { backgroundColor: colors.background },
  rowText: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
});
