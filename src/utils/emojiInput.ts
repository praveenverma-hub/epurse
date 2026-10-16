// =============================================================================
// The "own emoji" input — the device's emoji keyboard does the picking, so there is
// no emoji-picker dependency to keep current with new Unicode releases. PURE.
//
// Measured in UTF-16 units, not characters: one emoji is often many code points — a
// ZWJ family 👨‍👩‍👦‍👦 is 11 units, 👩🏻‍❤️‍💋‍👨🏿 is 15, 👍🏽 is a base + a skin-tone modifier.
// `Array.from` splits code points, so taking its last item kept only the 🏽.
// =============================================================================

export const EMOJI_MAX_UNITS = 16;

/**
 * A cut can land inside a surrogate pair or right after a joiner, leaving a lone high
 * surrogate (renders as �) or a dangling ZWJ. NOT the variation selector U+FE0F — it ends
 * a complete emoji (✈️, ❤️); stripping it gives the monochrome text glyph.
 */
const trimBrokenTail = (s: string): string => {
  let out = s;
  let prev;
  do {
    prev = out;
    out = out.replace(/[\uD800-\uDBFF]$/, '').replace(/‍+$/, '');
  } while (out !== prev);
  return out;
};

export const sanitizeEmoji = (raw: string | null | undefined): string =>
  trimBrokenTail((raw || '').replace(/\s/g, '').slice(0, EMOJI_MAX_UNITS));

/**
 * A reject-list, not an emoji match (`\p{Extended_Pictographic}` needs property escapes,
 * risky on Hermes): no ASCII letters or digits, so a name can't become the icon.
 */
export const isEmojiOnly = (s: string): boolean => !!s && !/[A-Za-z0-9]/.test(s);

/**
 * What the own-emoji field holds after the user types. The field shows the current
 * emoji, so a new one arrives appended to it — the NEW part wins (one icon, replaced),
 * whole, however many code points it has.
 * Returns '' for a cleared field, null for a rejected one (letters/digits).
 */
export function nextEmoji(current: string, typed: string): string | null {
  const t = typed.replace(/\s/g, '');
  const added = current && t.startsWith(current) && t.length > current.length ? t.slice(current.length) : t;
  const e = sanitizeEmoji(added);
  if (!e) return '';
  return isEmojiOnly(e) ? e : null;
}
