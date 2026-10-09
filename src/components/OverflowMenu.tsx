// =============================================================================
// OverflowMenu — a ⋮ icon button that opens a short list of ACTIONS (not a
// choice — that's InlineDropdown). Destructive rows go red; each action runs
// only after the menu has closed, so one that opens a CenterModal (a delete
// confirmation) isn't swallowed on iOS.
// =============================================================================
import React, { useRef, useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import type { StyleProp, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import AnchoredMenu, { MenuRow, menuIconInk, type MenuAnchor } from './AnchoredMenu';
import { colors } from '../constants/theme';

export interface OverflowAction {
  key: string;
  label: string;
  /** An Ionicons name, or a node (e.g. the app's canonical <EditIcon />). */
  icon: keyof typeof Ionicons.glyphMap | React.ReactNode;
  onPress: () => void;
  destructive?: boolean;
}

const MENU_W = 196;

export default function OverflowMenu({ actions, style, iconColor = colors.textSecondary, accessibilityLabel = 'More actions' }: {
  actions: OverflowAction[];
  /** The trigger's own shape (size, tinted circle). */
  style?: StyleProp<ViewStyle>;
  iconColor?: string;
  accessibilityLabel?: string;
}) {
  const triggerRef = useRef<View>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const pending = useRef<(() => void) | null>(null);

  const runPending = () => {
    const fn = pending.current;
    pending.current = null;
    fn?.();
  };
  const pick = (a: OverflowAction) => {
    pending.current = a.onPress;
    setAnchor(null);
    // iOS runs it from onDismiss (once the menu is gone); Android stacks modals fine.
    if (Platform.OS !== 'ios') runPending();
  };

  return (
    <>
      <Pressable
        ref={triggerRef}
        onPress={() => triggerRef.current?.measureInWindow((x, y, w, h) => setAnchor({ x, y, w, h }))}
        hitSlop={8}
        style={style}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel}
        accessibilityHint="Opens a list of actions"
      >
        <Ionicons name="ellipsis-vertical" size={18} color={iconColor} />
      </Pressable>
      <AnchoredMenu
        anchor={anchor}
        onClose={() => setAnchor(null)}
        onClosed={runPending}
        rowCount={actions.length}
        width={MENU_W}
      >
        {actions.map((a) => (
          <MenuRow
            key={a.key}
            label={a.label}
            destructive={a.destructive}
            onPress={() => pick(a)}
            icon={typeof a.icon === 'string'
              ? <Ionicons name={a.icon as keyof typeof Ionicons.glyphMap} size={18} color={menuIconInk(a.destructive)} />
              : a.icon}
          />
        ))}
      </AnchoredMenu>
    </>
  );
}
