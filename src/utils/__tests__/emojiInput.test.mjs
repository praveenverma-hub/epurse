// Own-emoji input: whole emoji kept (skin tones, ZWJ families, flags), a new one replaces the old.
import { EMOJI_MAX_UNITS, isEmojiOnly, nextEmoji, sanitizeEmoji } from '../emojiInput.ts';

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`); } else { fail++; console.log(`  ✗ ${name}  ${detail}`); }
};

check('a plain emoji', nextEmoji('', '🍕') === '🍕');
check('a skin-tone emoji stays whole (was: just the 🏽 modifier)', nextEmoji('', '👍🏽') === '👍🏽', nextEmoji('', '👍🏽'));
check('a ZWJ family stays whole', nextEmoji('', '👨‍👩‍👧') === '👨‍👩‍👧');
check('a flag stays whole', nextEmoji('', '🇮🇳') === '🇮🇳');
check('✈️ keeps its colour selector', nextEmoji('', '✈️') === '✈️');
check('typing after the current one REPLACES it', nextEmoji('🍕', '🍕👍🏽') === '👍🏽', nextEmoji('🍕', '🍕👍🏽'));
check('clearing the field → empty', nextEmoji('🍕', '') === '');
check('letters are rejected', nextEmoji('', 'Pets') === null && nextEmoji('🍕', '🍕a') === null);
check('spaces are ignored', nextEmoji('', ' 🎉 ') === '🎉');
const long = '👩🏻‍❤️‍💋‍👨🏿👩🏻‍❤️‍💋‍👨🏿';
check('capped without leaving a broken half', sanitizeEmoji(long).length <= EMOJI_MAX_UNITS && !/[\uD800-\uDBFF]$/.test(sanitizeEmoji(long)) && !/‍$/.test(sanitizeEmoji(long)));
check('isEmojiOnly: emoji yes, a keycap digit no', isEmojiOnly('🎯') && !isEmojiOnly('1️⃣'));

console.log(`\n${pass}/${pass + fail} passed`);
if (fail) process.exit(1);
