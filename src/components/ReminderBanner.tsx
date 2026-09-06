// =============================================================================
// ReminderBanner — the indigo bell/calendar illustration on the reminder form.
//
// Carried over verbatim from BorrowReminderModal (deleted when the reminder form
// became one full screen for every reminder). It is an ILLUSTRATION, not an icon,
// which is why it stays hand-drawn SVG rather than becoming an Ionicon: the
// "icons come from @expo/vector-icons" rule is about chrome.
//
// Fixed indigo, deliberately not theme-derived: white text is painted flat on it
// (see the form's overlay pill), so the palette has to stay dark whatever accent
// the user picks — the same rule the theme memo records for gradient stops.
// =============================================================================
import React from 'react';
import Svg, {
  Path, Circle, Rect, Ellipse,
  Defs, LinearGradient as SvgGradient, Stop,
} from 'react-native-svg';

interface ReminderBannerProps {
  /** Width in px — the form passes its content width so the art fills the card. */
  w: number;
  /** Height in px. The art is drawn on a 320×110 viewBox; keep that ratio. */
  h: number;
}

const ReminderBanner: React.FC<ReminderBannerProps> = ({ w, h }) => (

  <Svg width={w} height={h} viewBox="0 0 320 110">
    <Defs>
      <SvgGradient id="rmbg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0%" stopColor="#312E81" />
        <Stop offset="100%" stopColor="#4338CA" />
      </SvgGradient>
      <SvgGradient id="bellFill" x1="0" y1="0" x2="0" y2="1">
        <Stop offset="0%" stopColor="#A5B4FC" />
        <Stop offset="100%" stopColor="#6366F1" />
      </SvgGradient>
    </Defs>
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="url(#rmbg)" />
    <Circle cx="72" cy="55" r="52" fill="#6366F1" opacity="0.18" />
    <Circle cx="268" cy="30" r="40" fill="#818CF8" opacity="0.12" />
    {[0,1,2,3,4].map((i) => [0,1,2].map((j) => (
      <Circle key={`d${i}${j}`} cx={230+i*16} cy={12+j*16} r="1.5" fill="#818CF8" opacity="0.3" />
    )))}
    <Path d="M72 28 C52 28 40 46 40 66 L104 66 C104 46 92 28 72 28 Z" fill="url(#bellFill)" />
    <Circle cx="72" cy="26" r="5" fill="#A5B4FC" />
    <Circle cx="72" cy="23" r="3" fill="#C7D2FE" />
    <Rect x="38" y="66" width="68" height="8" rx="4" fill="#818CF8" />
    <Ellipse cx="72" cy="78" rx="7" ry="5" fill="#4F46E5" />
    <Circle cx="72" cy="78" r="4" fill="#A5B4FC" />
    <Circle cx="72" cy="52" r="40" fill="none" stroke="#818CF8" strokeWidth="1" opacity="0.35" />
    <Circle cx="72" cy="52" r="56" fill="none" stroke="#6366F1" strokeWidth="1" opacity="0.15" />
    <Rect x="168" y="28" width="80" height="66" rx="8" fill="#1E1B4B" opacity="0.7" />
    <Rect x="168" y="28" width="80" height="20" rx="8" fill="#4F46E5" opacity="0.9" />
    <Rect x="168" y="40" width="80" height="8" fill="#4F46E5" opacity="0.9" />
    <Circle cx="190" cy="24" r="4" fill="#818CF8" />
    <Circle cx="228" cy="24" r="4" fill="#818CF8" />
    {[0,1,2].map((col) => [0,1,2].map((row) => {
      const hi = col === 0 && row === 0;
      return <Circle key={`cal${col}${row}`} cx={182+col*20} cy={62+row*14} r={hi?6:4} fill={hi?'#818CF8':'#6366F1'} opacity={hi?1:0.4} />;
    }))}
    <Circle cx="182" cy="62" r="8" fill="none" stroke="#A5B4FC" strokeWidth="1.5" />
    <Circle cx="272" cy="72" r="16" fill="#4F46E5" opacity="0.6" />
    <Circle cx="272" cy="72" r="13" fill="#312E81" opacity="0.5" />
    <Path d="M266 68 L278 68 M266 72 L278 72 M268 68 Q268 78 276 80" stroke="#A5B4FC" strokeWidth="2" strokeLinecap="round" fill="none" />
    <Path d="M144 18 L146 12 L148 18 L154 20 L148 22 L146 28 L144 22 L138 20 Z" fill="#A5B4FC" opacity="0.8" />
    <Path d="M158 52 L159 48 L160 52 L164 53 L160 54 L159 58 L158 54 L154 53 Z" fill="#C7D2FE" opacity="0.6" />
    <Path d="M140 80 L141 77 L142 80 L145 81 L142 82 L141 85 L140 82 L137 81 Z" fill="#818CF8" opacity="0.5" />
    <Rect x="0" y="104" width="320" height="6" rx="0" fill="#4F46E5" opacity="0.6" />
    <Rect x="0" y="104" width="107" height="6" fill="#6366F1" opacity="0.9" />
    <Rect x="107" y="104" width="106" height="6" fill="#818CF8" opacity="0.9" />
    <Rect x="213" y="104" width="107" height="6" fill="#A5B4FC" opacity="0.9" />
  </Svg>
);

export default ReminderBanner;
