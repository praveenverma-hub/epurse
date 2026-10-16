// =============================================================================
// IconColorPicker — how anything the user names gets its look (group, goal, custom
// category, account). `IconField` = the name row with the item's tile on its left;
// tapping the tile opens the choices right below (not a sheet: the ⌨️ own-emoji tile
// opens the keyboard, which would cover one). `EmojiChoices` / `ColorChoices` are
// those choices. An emoji here is DATA, so it stays an emoji.
// =============================================================================
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, shadows, spacing, DIVIDER_W } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { hapticLight } from '../utils/haptics';
import { EMOJI_MAX_UNITS, nextEmoji } from '../utils/emojiInput';
import EditIcon from './EditIcon';

// ─── IconField — tile + name input + the choices it opens ────────────────────

interface IconFieldProps {
  /** What the tile shows — usually the emoji. */
  tile: React.ReactNode;
  /** Tile fill — the item's own colour, tinted. */
  tileColor: string;
  /** The name input, as the screen already styles it. */
  children: React.ReactNode;
  /** The choices shown when the tile is tapped (EmojiChoices / ColorChoices with ChoiceLabel). */
  choices: React.ReactNode;
  error?: string | null;
}

export function IconField({ tile, tileColor, children, choices, error }: IconFieldProps) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  return (
    <View>
      <View style={styles.nameRow}>
        <TouchableOpacity
          style={[styles.tile, { backgroundColor: tileColor }, open && { borderColor: theme.primary }]}
          onPress={() => { hapticLight(); setOpen((v) => !v); }}
          activeOpacity={0.8}
          accessibilityRole="button"
          accessibilityLabel={open ? 'Close the look choices' : 'Change the look'}
        >
          {tile}
          <View style={[styles.tileBadge, { backgroundColor: theme.card }]}>
            <EditIcon size={11} color={theme.primary} />
          </View>
        </TouchableOpacity>
        <View style={styles.input}>{children}</View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {open ? <View style={styles.panel}>{choices}</View> : null}
    </View>
  );
}

/** "Icon" / "Colour" above each set of choices inside the panel. */
export function ChoiceLabel({ children, first }: { children: string; first?: boolean }) {
  return <Text style={[styles.choiceLabel, !first && styles.choiceLabelGap]}>{children}</Text>;
}

/** The emoji a tile shows, at the size every tile uses. */
export function TileEmoji({ emoji }: { emoji: string }) {
  return <Text style={styles.tileEmoji} allowFontScaling={false}>{emoji}</Text>;
}

// ─── EmojiChoices ────────────────────────────────────────────────────────────

interface EmojiChoicesProps {
  value: string;
  onChange: (v: string) => void;
  choices: string[];
}

/** Presets + a ⌨️ tile that takes any emoji from the keyboard (highlighted while in use). */
export function EmojiChoices({ value, onChange, choices }: EmojiChoicesProps) {
  const theme = useTheme();
  const [err, setErr] = useState(false);
  const own = !choices.includes(value);
  return (
    <View>
      <View style={styles.wrap}>
        <TextInput
          value={own ? value : ''}
          onChangeText={(t) => {
            const e = nextEmoji(own ? value : '', t);
            if (e === null) { setErr(true); return; }   // typed a letter — say so
            setErr(false);
            if (e) { hapticLight(); onChange(e); } else onChange(choices[0]);
          }}
          placeholder="⌨️"
          placeholderTextColor={theme.textMuted}
          maxLength={EMOJI_MAX_UNITS * 2}
          style={[
            styles.emojiBtn,
            styles.emojiOwn,
            {
              color: theme.textPrimary,
              borderColor: err ? theme.danger : own ? theme.primary : theme.inputBorder,
              backgroundColor: own ? theme.primary + '14' : theme.cardAlt,
            },
          ]}
          accessibilityLabel="Use your own emoji"
        />
        {choices.map((e) => (
          <TouchableOpacity
            key={e}
            onPress={() => { hapticLight(); setErr(false); onChange(e); }}
            activeOpacity={0.75}
            style={[
              styles.emojiBtn,
              {
                borderColor: value === e ? theme.primary : 'transparent',
                backgroundColor: value === e ? theme.primary + '10' : theme.cardAlt,
              },
            ]}
            accessibilityLabel={`Icon ${e}`}
          >
            <Text style={styles.emojiTxt} allowFontScaling={false}>{e}</Text>
          </TouchableOpacity>
        ))}
      </View>
      <Text style={[styles.emojiHint, { color: err ? theme.danger : theme.textMuted }]}>
        {err ? 'Emoji only — tap the 😀 key on your keyboard.' : 'Tap ⌨️ to use any emoji from your keyboard.'}
      </Text>
    </View>
  );
}

// ─── ColorChoices ────────────────────────────────────────────────────────────

interface ColorChoicesProps {
  /** null = Auto (only with `auto`). */
  value: string | null;
  onChange: (v: string | null) => void;
  /** Values to offer; each is a colour unless `swatchColor` maps it (e.g. a gradient key). */
  choices: string[];
  swatchColor?: (v: string) => string;
  /** Leads with an Auto swatch (value null) — the app picks the colour. */
  auto?: boolean;
}

export function ColorChoices({ value, onChange, choices, swatchColor, auto }: ColorChoicesProps) {
  const theme = useTheme();
  return (
    // Wider gap than the emoji row: a selected swatch scales up into its neighbours.
    <View style={[styles.wrap, styles.colorWrap]}>
      {auto ? (
        <TouchableOpacity
          onPress={() => { hapticLight(); onChange(null); }}
          activeOpacity={0.75}
          style={[styles.swatch, { backgroundColor: theme.cardAlt }, value === null && styles.swatchSelected]}
          accessibilityLabel="Automatic colour"
          accessibilityState={{ selected: value === null }}
        >
          <Ionicons name="shuffle-outline" size={15} color={theme.textMuted} />
        </TouchableOpacity>
      ) : null}
      {choices.map((c) => (
        <TouchableOpacity
          key={c}
          onPress={() => { hapticLight(); onChange(c); }}
          activeOpacity={0.75}
          style={[styles.swatch, { backgroundColor: swatchColor ? swatchColor(c) : c }, value === c && styles.swatchSelected]}
          accessibilityLabel={`Colour ${c}`}
          accessibilityState={{ selected: value === c }}
        >
          {value === c ? <Ionicons name="checkmark" size={15} color="#FFFFFF" /> : null}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  nameRow: { flexDirection: 'row', gap: spacing.sm },
  // Same tile as the list cards; `stretch` keeps it exactly the input's height.
  tile: {
    width: 52, alignSelf: 'stretch', minHeight: 48, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5, borderColor: 'transparent',
  },
  tileEmoji: { fontSize: 24 },
  tileBadge: {
    position: 'absolute', right: -4, bottom: -4,
    width: 20, height: 20, borderRadius: 10,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: DIVIDER_W, borderColor: colors.inputBorder,
  },
  input: { flex: 1 },
  error: { fontSize: 12, color: colors.danger, marginTop: spacing.xs },
  panel: { marginTop: spacing.md },
  choiceLabel: { fontSize: 12, fontWeight: '600', color: colors.textSecondary, marginBottom: spacing.sm },
  choiceLabelGap: { marginTop: spacing.md },

  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  colorWrap: { gap: spacing.md, paddingVertical: spacing.xs },
  emojiBtn: {
    width: 44, height: 44, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1.5,
  },
  emojiTxt: { fontSize: 20 },
  emojiOwn: { fontSize: 20, textAlign: 'center', padding: 0 },
  emojiHint: { fontSize: 12, marginTop: spacing.sm },
  swatch: {
    width: 36, height: 36, borderRadius: radius.pill,
    alignItems: 'center', justifyContent: 'center',
  },
  // Scale up + a WHITE ring + a dark drop, so the ring shows on a pale colour too.
  swatchSelected: {
    borderWidth: 2,
    borderColor: '#fff',
    transform: [{ scale: 1.18 }],
    ...shadows.pop,
  },
});
