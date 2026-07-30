// =============================================================================
// WhatsAppReminderModal — 5 themed SVG banners + WA deep-link reminder
// =============================================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Modal, View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, Linking, Dimensions,
} from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as MediaLibrary from 'expo-media-library';
import Svg, {
  Path, Circle, Rect, Ellipse,
  Defs, LinearGradient as SvgGradient, Stop,
  Line, G,
} from 'react-native-svg';

import { colors, radius, spacing, typography } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';
import { formatCurrency } from '../utils/format';
import { useToast } from './Toast';
import SheetCloseButton from './SheetCloseButton';
import CenterModal from './CenterModal';

// ── Screen dimensions ─────────────────────────────────────────────────────────
const SCREEN_W = Dimensions.get('window').width;
const SCREEN_H = Dimensions.get('window').height;
// Sheet height: fixed so flex: 1 on the inner ScrollView is unambiguous
const SHEET_H  = Math.min(Math.round(SCREEN_H * 0.88), 700);
// Banner fills the sheet content area (sheet has spacing.lg padding on each side)
const BANNER_W = SCREEN_W - spacing.lg * 2;
const BANNER_H = Math.round(BANNER_W * (110 / 320));

// ── Phone normalisation ───────────────────────────────────────────────────────
const normalisePhone = (raw) => {
  if (!raw) return null;
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10) return `91${d}`;
  if (d.length === 11 && d.startsWith('0')) return `91${d.slice(1)}`;
  if (d.length === 12 && d.startsWith('91')) return d;
  if (d.length === 13 && d.startsWith('091')) return d.slice(1);
  return d;
};

// ── Due-date helpers ──────────────────────────────────────────────────────────
const dueDateLabel = (key) => {
  const now = new Date();
  const fmt = (d) => d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  if (key === 'today') return fmt(now);
  if (key === 'week')  { const d = new Date(now); d.setDate(d.getDate() + 7); return fmt(d); }
  if (key === 'month') { const d = new Date(now); d.setMonth(d.getMonth() + 1); return fmt(d); }
  return null;
};

// =============================================================================
// SVG Banner components  (viewBox 0 0 320 110, renders at any width via w/h)
// =============================================================================

// ── 1. Friendly ───────────────────────────────────────────────────────────────
const FriendlyBanner = ({ w, h }) => (
  <Svg width={w} height={h} viewBox="0 0 320 110">
    <Defs>
      <SvgGradient id="fbg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0%" stopColor="#D1FAE5" />
        <Stop offset="100%" stopColor="#A7F3D0" />
      </SvgGradient>
    </Defs>
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="url(#fbg)" />
    {/* Soft blob top-right */}
    <Circle cx="280" cy="20" r="55" fill="#6EE7B7" opacity="0.25" />
    {/* Bottom wave */}
    <Path d="M0 82 Q80 66 160 82 Q240 98 320 82 L320 110 L0 110 Z" fill="#34D39922" />
    {/* Coin stack */}
    <Ellipse cx="58" cy="76" rx="22" ry="7" fill="#059669" opacity="0.3"/>
    <Rect x="36" y="52" width="44" height="24" rx="4" fill="#10B981"/>
    <Rect x="36" y="52" width="44" height="8"  rx="4" fill="#34D399"/>
    <Text style={{ fontSize: 18, position: 'absolute' }}/>
    <Circle cx="58" cy="52" rx="22" ry="8" fill="#6EE7B7" />
    <Ellipse cx="58" cy="52" rx="22" ry="8" fill="#34D399"/>
    {/* Rupee symbol on coin */}
    <Path d="M52 49 L64 49 M52 52 L64 52 M54 49 Q54 58 62 58" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" fill="none"/>
    {/* Second smaller coin */}
    <Ellipse cx="90" cy="68" rx="16" ry="6" fill="#10B98166"/>
    <Rect x="74" y="50" width="32" height="18" rx="3" fill="#059669"/>
    <Ellipse cx="90" cy="50" rx="16" ry="6" fill="#34D399"/>
    {/* Third coin */}
    <Ellipse cx="116" cy="72" rx="12" ry="5" fill="#10B98144"/>
    <Rect x="104" y="57" width="24" height="15" rx="3" fill="#047857"/>
    <Ellipse cx="116" cy="57" rx="12" ry="5" fill="#10B981"/>
    {/* Sparkles */}
    <Path d="M190 22 L192 16 L194 22 L200 24 L194 26 L192 32 L190 26 L184 24 Z" fill="#6EE7B7"/>
    <Path d="M240 55 L241 51 L242 55 L246 56 L242 57 L241 61 L240 57 L236 56 Z" fill="#A7F3D0"/>
    <Path d="M270 30 L271 27 L272 30 L275 31 L272 32 L271 35 L270 32 L267 31 Z" fill="#34D399"/>
    {/* Handshake simplified */}
    <Path d="M185 72 Q200 60 220 68 Q235 74 245 68 Q255 62 265 70" stroke="#10B981" strokeWidth="3" strokeLinecap="round" fill="none"/>
    <Circle cx="185" cy="72" r="5" fill="#10B981"/>
    <Circle cx="265" cy="70" r="5" fill="#10B981"/>
    {/* Label */}
    <Rect x="150" y="20" width="155" height="32" rx="8" fill="#FFFFFF66"/>
    <Path d="M155 36 L160 36" stroke="#10B981" strokeWidth="0" fill="none"/>
    {/* Text labels as SVG */}
    {/* We position these via React Native Text overlay instead */}
  </Svg>
);

// ── 2. Professional ───────────────────────────────────────────────────────────
const ProfessionalBanner = ({ w, h }) => (
  <Svg width={w} height={h} viewBox="0 0 320 110">
    <Defs>
      <SvgGradient id="pbg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0%" stopColor="#0F172A" />
        <Stop offset="100%" stopColor="#1E3A5F" />
      </SvgGradient>
    </Defs>
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="url(#pbg)" />
    {/* Document shape */}
    <Rect x="30" y="18" width="60" height="74" rx="4" fill="#1E3A5F" stroke="#C9A84C" strokeWidth="1"/>
    <Rect x="35" y="28" width="50" height="3" rx="1.5" fill="#C9A84C" opacity="0.8"/>
    <Rect x="35" y="36" width="40" height="2" rx="1" fill="#94A3B8" opacity="0.6"/>
    <Rect x="35" y="43" width="45" height="2" rx="1" fill="#94A3B8" opacity="0.6"/>
    <Rect x="35" y="50" width="35" height="2" rx="1" fill="#94A3B8" opacity="0.6"/>
    <Rect x="35" y="57" width="42" height="2" rx="1" fill="#94A3B8" opacity="0.6"/>
    <Rect x="35" y="64" width="30" height="2" rx="1" fill="#94A3B8" opacity="0.5"/>
    {/* Stamp/seal */}
    <Circle cx="68" cy="80" r="14" fill="none" stroke="#EF4444" strokeWidth="1.5" strokeDasharray="3 2"/>
    <Path d="M62 78 L66 82 L74 74" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
    {/* Gold accent bar */}
    <Rect x="0" y="104" width="320" height="6" rx="0" fill="#C9A84C"/>
    <Rect x="0" y="104" width="320" height="6" rx="0" fill="#C9A84C" opacity="0.7"/>
    {/* Decorative dots top-right */}
    {[0,1,2,3].map(i => [0,1,2,3].map(j => (
      <Circle key={`${i}${j}`} cx={220 + i*18} cy={18 + j*18} r="1.5" fill="#C9A84C" opacity="0.3"/>
    )))}
    {/* Corner fold */}
    <Path d="M82 18 L90 18 L90 26 Z" fill="#0F172A"/>
    <Path d="M82 18 L90 26" stroke="#C9A84C" strokeWidth="0.8" fill="none"/>
  </Svg>
);

// ── 3. Funny ──────────────────────────────────────────────────────────────────
const FunnyBanner = ({ w, h }) => (
  <Svg width={w} height={h} viewBox="0 0 320 110">
    <Defs>
      <SvgGradient id="ybg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0%" stopColor="#FFFDE7" />
        <Stop offset="100%" stopColor="#FFF9C4" />
      </SvgGradient>
    </Defs>
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="url(#ybg)" />
    {/* Ground shadow */}
    <Ellipse cx="80" cy="100" rx="45" ry="7" fill="#F59E0B" opacity="0.2"/>
    {/* Money bag body */}
    <Circle cx="80" cy="66" r="28" fill="#F59E0B"/>
    <Circle cx="80" cy="66" r="28" fill="#FBBF24" opacity="0.5"/>
    {/* Bag highlight */}
    <Circle cx="72" cy="58" r="8" fill="#FDE68A" opacity="0.6"/>
    {/* Bag neck */}
    <Rect x="72" y="36" width="16" height="12" rx="4" fill="#D97706"/>
    {/* Bag string knot */}
    <Circle cx="80" cy="34" r="6" fill="#92400E"/>
    <Circle cx="80" cy="34" r="3" fill="#B45309"/>
    {/* Rupee on bag */}
    <Path d="M73 62 L87 62 M73 67 L87 67 M75 62 Q75 74 84 74" stroke="#92400E" strokeWidth="2.2" strokeLinecap="round" fill="none"/>
    {/* Legs running */}
    <Line x1="68" y1="94" x2="58" y2="108" stroke="#D97706" strokeWidth="4" strokeLinecap="round"/>
    <Line x1="92" y1="94" x2="105" y2="105" stroke="#D97706" strokeWidth="4" strokeLinecap="round"/>
    {/* Arms flailing */}
    <Line x1="55" y1="70" x2="42" y2="58" stroke="#D97706" strokeWidth="3" strokeLinecap="round"/>
    <Line x1="105" y1="65" x2="118" y2="54" stroke="#D97706" strokeWidth="3" strokeLinecap="round"/>
    {/* Motion lines */}
    <Line x1="28" y1="55" x2="18" y2="55" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round"/>
    <Line x1="26" y1="63" x2="14" y2="63" stroke="#F59E0B" strokeWidth="2" strokeLinecap="round" opacity="0.6"/>
    <Line x1="30" y1="71" x2="20" y2="71" stroke="#F59E0B" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"/>
    {/* Falling ₹ symbols (small circles with paths) */}
    <Circle cx="160" cy="30" r="10" fill="#FDE68A" stroke="#F59E0B" strokeWidth="1"/>
    <Path d="M155 28 L165 28 M155 31 L165 31 M157 28 Q157 36 163 36" stroke="#D97706" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
    <Circle cx="200" cy="55" r="8" fill="#FDE68A" stroke="#F59E0B" strokeWidth="1"/>
    <Path d="M196 53 L204 53 M196 56 L204 56 M198 53 Q198 60 203 60" stroke="#D97706" strokeWidth="1.1" strokeLinecap="round" fill="none"/>
    <Circle cx="175" cy="80" r="6" fill="#FDE68A" stroke="#F59E0B" strokeWidth="1" opacity="0.7"/>
    {/* Stars */}
    <Path d="M240 25 L242 20 L244 25 L249 27 L244 29 L242 34 L240 29 L235 27 Z" fill="#F59E0B"/>
    <Path d="M270 55 L271 52 L272 55 L275 56 L272 57 L271 60 L270 57 L267 56 Z" fill="#FBBF24"/>
    <Path d="M255 90 L256 88 L257 90 L259 91 L257 92 L256 94 L255 92 L253 91 Z" fill="#F59E0B" opacity="0.7"/>
    {/* Exclamation */}
    <Rect x="285" y="20" width="8" height="28" rx="4" fill="#EF4444"/>
    <Circle cx="289" cy="56" r="4" fill="#EF4444"/>
  </Svg>
);

// ── 4. Urgent ─────────────────────────────────────────────────────────────────
const UrgentBanner = ({ w, h }) => (
  <Svg width={w} height={h} viewBox="0 0 320 110">
    <Defs>
      <SvgGradient id="ubg" x1="0" y1="0" x2="1" y2="1">
        <Stop offset="0%" stopColor="#FFF0F0" />
        <Stop offset="100%" stopColor="#FFE4E4" />
      </SvgGradient>
    </Defs>
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="url(#ubg)" />
    {/* Radiating pulse circles */}
    <Circle cx="80" cy="58" r="52" fill="none" stroke="#EF4444" strokeWidth="1" opacity="0.12"/>
    <Circle cx="80" cy="58" r="42" fill="none" stroke="#EF4444" strokeWidth="1" opacity="0.18"/>
    <Circle cx="80" cy="58" r="32" fill="none" stroke="#EF4444" strokeWidth="1.5" opacity="0.25"/>
    <Circle cx="80" cy="58" r="22" fill="#EF444418"/>
    {/* Bell body */}
    <Path d="M60 65 Q55 45 80 38 Q105 45 100 65 Z" fill="#EF4444"/>
    <Path d="M60 65 Q55 45 80 38 Q105 45 100 65 Z" fill="#F87171" opacity="0.4"/>
    {/* Bell clapper */}
    <Rect x="74" y="65" width="12" height="8" rx="2" fill="#DC2626"/>
    <Circle cx="80" cy="76" r="6" fill="#DC2626"/>
    {/* Bell handle */}
    <Rect x="76" y="32" width="8" height="8" rx="4" fill="#B91C1C"/>
    {/* Ringing lines */}
    <Path d="M48 42 Q44 38 46 32" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
    <Path d="M112 42 Q116 38 114 32" stroke="#EF4444" strokeWidth="2.5" strokeLinecap="round" fill="none"/>
    <Path d="M40 54 Q34 50 36 42" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6"/>
    <Path d="M120 54 Q126 50 124 42" stroke="#EF4444" strokeWidth="2" strokeLinecap="round" fill="none" opacity="0.6"/>
    {/* Warning triangles */}
    <Path d="M185 30 L195 48 L175 48 Z" fill="#F59E0B"/>
    <Rect x="188" y="35" width="4" height="7" rx="1" fill="#fff"/>
    <Circle cx="190" cy="45" r="2" fill="#fff"/>
    <Path d="M220 22 L228 36 L212 36 Z" fill="#F59E0B" opacity="0.7"/>
    {/* Diagonal stripes top-right */}
    {[0,1,2,3,4].map(i => (
      <Line key={i} x1={240 + i*16} y1="0" x2={260 + i*16} y2="30" stroke="#EF4444" strokeWidth="8" opacity="0.06"/>
    ))}
    {/* Red bar bottom */}
    <Rect x="0" y="100" width="320" height="10" rx="0" fill="#EF4444" opacity="0.15"/>
    <Rect x="0" y="104" width="320" height="6" rx="0" fill="#DC2626"/>
  </Svg>
);

// ── 5. Minimal ────────────────────────────────────────────────────────────────
const MinimalBanner = ({ w, h }) => (
  <Svg width={w} height={h} viewBox="0 0 320 110">
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="#F8FAFC"/>
    <Rect x="0" y="0" width="320" height="110" rx="14" fill="#F1F5F9" opacity="0.5"/>
    {/* Dot grid */}
    {Array.from({ length: 8 }).map((_, row) =>
      Array.from({ length: 14 }).map((_, col) => (
        <Circle key={`${row}-${col}`} cx={20 + col * 22} cy={14 + row * 14} r="1.5" fill="#CBD5E1" opacity="0.5"/>
      ))
    )}
    {/* Large soft circle */}
    <Circle cx="260" cy="55" r="60" fill="#E2E8F0" opacity="0.5"/>
    <Circle cx="260" cy="55" r="40" fill="#CBD5E1" opacity="0.3"/>
    {/* Clock face */}
    <Circle cx="80" cy="55" r="32" fill="#fff" stroke="#CBD5E1" strokeWidth="2"/>
    <Circle cx="80" cy="55" r="28" fill="#F8FAFC"/>
    {/* Clock ticks */}
    {[0,3,6,9].map(i => {
      const angle = (i * 30 - 90) * (Math.PI / 180);
      const x1 = 80 + 22 * Math.cos(angle);
      const y1 = 55 + 22 * Math.sin(angle);
      const x2 = 80 + 26 * Math.cos(angle);
      const y2 = 55 + 26 * Math.sin(angle);
      return <Line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#94A3B8" strokeWidth="2" strokeLinecap="round"/>;
    })}
    {/* Hour hand (10 o'clock position) */}
    <Line x1="80" y1="55" x2="66" y2="42" stroke="#334155" strokeWidth="2.5" strokeLinecap="round"/>
    {/* Minute hand (past 2) */}
    <Line x1="80" y1="55" x2="92" y2="38" stroke="#475569" strokeWidth="2" strokeLinecap="round"/>
    <Circle cx="80" cy="55" r="3" fill="#334155"/>
    {/* Minimal accent line */}
    <Rect x="0" y="104" width="320" height="6" rx="0" fill="#E2E8F0"/>
    <Rect x="0" y="104" width="96" height="6" rx="0" fill="#64748B"/>
    {/* Right-side text lines (decorative) */}
    <Rect x="140" y="36" width="100" height="3" rx="1.5" fill="#CBD5E1"/>
    <Rect x="140" y="46" width="80" height="3" rx="1.5" fill="#E2E8F0"/>
    <Rect x="140" y="56" width="110" height="3" rx="1.5" fill="#CBD5E1"/>
    <Rect x="140" y="66" width="70" height="3" rx="1.5" fill="#E2E8F0"/>
    <Rect x="140" y="76" width="90" height="3" rx="1.5" fill="#CBD5E1" opacity="0.6"/>
  </Svg>
);

// =============================================================================
// Theme registry
// =============================================================================
const REMINDER_THEMES = [
  {
    id: 'friendly',
    label: 'Friendly',
    emoji: '🤝',
    accentColor: '#10B981',
    labelBg: '#D1FAE5',
    labelText: '#065F46',
    title: 'Friendly Reminder',
    tagline: 'A gentle nudge 🌿',
    Banner: FriendlyBanner,
    buildMsg: (name, amt, due, sender) =>
      `Hi ${name}! 👋\n\n` +
      `Hope you're doing great! Just a little reminder that *${amt}* is still pending.\n\n` +
      `💰 *Amount Due:* ${amt}\n` +
      due +
      `\nNo rush at all — settle whenever you get a chance! 😊\n\n` +
      `_— ${sender}_`,
  },
  {
    id: 'professional',
    label: 'Formal',
    emoji: '📋',
    accentColor: '#C9A84C',
    labelBg: '#1E3A5F',
    labelText: '#FFFFFF',
    title: 'Payment Notice',
    tagline: 'Formal & Professional',
    Banner: ProfessionalBanner,
    buildMsg: (name, amt, due, sender) =>
      `Dear ${name},\n\n` +
      `This is a formal reminder regarding an outstanding payment.\n\n` +
      `*Amount Due:* ${amt}\n` +
      due +
      `\nKindly arrange for the payment at your earliest convenience.\n\n` +
      `Regards,\n${sender}`,
  },
  {
    id: 'funny',
    label: 'Funny',
    emoji: '😂',
    accentColor: '#F59E0B',
    labelBg: '#FDE68A',
    labelText: '#78350F',
    title: 'Your money ran away!',
    tagline: 'Light & Humorous 😄',
    Banner: FunnyBanner,
    buildMsg: (name, amt, due, sender) =>
      `Hey ${name}! 🏃‍♂️💨\n\n` +
      `BREAKING NEWS: *${amt}* was last seen running out of your wallet 😂\n\n` +
      `🎯 *Wanted:* ${amt}\n` +
      `🔍 *Last seen:* Your pocket\n` +
      due +
      `\nPlease help bring it home. It misses me 😅\n\n` +
      `_— ${sender} (the banker 🏦)_`,
  },
  {
    id: 'urgent',
    label: 'Urgent',
    emoji: '🔔',
    accentColor: '#EF4444',
    labelBg: '#FEE2E2',
    labelText: '#7F1D1D',
    title: 'Action Required',
    tagline: '⚠️ Needs attention',
    Banner: UrgentBanner,
    buildMsg: (name, amt, due, sender) =>
      `⚠️ *REMINDER* ⚠️\n\n` +
      `Hi ${name},\n\n` +
      `This is an important reminder that *${amt}* is pending and needs your attention.\n\n` +
      `💰 *Amount Due:* ${amt}\n` +
      due +
      `\nPlease prioritize this payment.\n\n` +
      `Thank you,\n${sender}`,
  },
  {
    id: 'minimal',
    label: 'Minimal',
    emoji: '✨',
    accentColor: '#64748B',
    labelBg: '#F1F5F9',
    labelText: '#1E293B',
    title: 'Quick Reminder',
    tagline: 'Clean & Simple',
    Banner: MinimalBanner,
    buildMsg: (name, amt, due, sender) =>
      `Hi ${name},\n\n` +
      `Quick reminder — *${amt}* is pending.\n\n` +
      due +
      `Thanks,\n${sender}`,
  },
];

// =============================================================================
// WhatsApp icon
// =============================================================================
const WhatsAppIcon = ({ size = 18, color = '#25D366' }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" fill={color}/>
    <Path d="M12 2C6.477 2 2 6.477 2 12c0 1.89.525 3.66 1.438 5.168L2 22l4.978-1.304A9.96 9.96 0 0 0 12 22c5.523 0 10-4.477 10-10S17.523 2 12 2zm0 18a7.958 7.958 0 0 1-4.078-1.117l-.292-.173-3.03.794.808-2.951-.19-.303A7.96 7.96 0 0 1 4 12c0-4.418 3.582-8 8-8s8 3.582 8 8-3.582 8-8 8z" fill={color}/>
  </Svg>
);

// =============================================================================
// Modal component
// =============================================================================
const WhatsAppReminderModal = ({ visible, person, phone, amount, senderName, onClose }) => {
  const theme = useTheme();
  const toast = useToast();
  const bannerRef = useRef(null);
  const [themeId, setThemeId]     = useState('friendly');
  const [dueDateKey, setDueDateKey] = useState(null);
  const [customDate, setCustomDate] = useState('');
  const [msgOverride, setMsgOverride] = useState(null);
  const [bannerSaved, setBannerSaved] = useState(false);
  const [confirm, setConfirm] = useState(null);

  const activeTheme = REMINDER_THEMES.find((t) => t.id === themeId) || REMINDER_THEMES[0];

  const dueText = useMemo(() => {
    if (dueDateKey && dueDateKey !== 'custom') return dueDateLabel(dueDateKey);
    if (dueDateKey === 'custom' && customDate.trim()) return customDate.trim();
    return null;
  }, [dueDateKey, customDate]);

  const generatedMsg = useMemo(() => {
    const name = (person || 'there').split(' ')[0];
    const amt  = formatCurrency(amount);
    const due  = dueText ? `📅 *Due by:* ${dueText}\n` : '';
    return activeTheme.buildMsg(name, amt, due, senderName || 'ePurse');
  }, [person, amount, dueText, senderName, activeTheme]);

  const message = msgOverride !== null ? msgOverride : generatedMsg;

  useEffect(() => {
    if (visible) {
      setDueDateKey(null);
      setCustomDate('');
      setMsgOverride(null);
      setThemeId('friendly');
      setBannerSaved(false);
    }
  }, [visible]);

  // Regenerate message when theme changes (only if user hasn't manually edited)
  useEffect(() => {
    setMsgOverride(null);
  }, [themeId]);

  const handleSend = useCallback(async () => {
    // 1. Capture the banner and save to gallery so the user can attach it in WhatsApp
    let bannerCaptured = false;
    try {
      const uri = await captureRef(bannerRef, { format: 'jpg', quality: 0.92 });
      const { status } = await MediaLibrary.requestPermissionsAsync();
      if (status === 'granted') {
        await MediaLibrary.saveToLibraryAsync(uri);
        setBannerSaved(true);
        bannerCaptured = true;
      }
    } catch (_) {
      // Capture failure is non-fatal — proceed to open WA without the image
    }

    // 2. Build WhatsApp URL with pre-filled message text
    const encoded   = encodeURIComponent(message);
    const phoneNorm = normalisePhone(phone);
    const url = phoneNorm
      ? `https://wa.me/${phoneNorm}?text=${encoded}`
      : `https://wa.me/?text=${encoded}`;

    const canOpen = await Linking.canOpenURL(url).catch(() => false);
    if (!canOpen) {
      toast.error('WhatsApp not found', 'Make sure WhatsApp is installed, then try again.');
      return;
    }

    // 3. Show attach hint if we saved the banner, then open WA
    if (bannerCaptured) {
      setConfirm({
        title:       '📸 Banner saved to gallery!',
        message:     'In WhatsApp, tap the 📎 (attachment) button and pick the banner from your gallery to send it along with the message.',
        primaryText: 'Open WhatsApp',
        onConfirm:   () => {
          setConfirm(null);
          Linking.openURL(url);
          onClose();
        },
      });
    } else {
      await Linking.openURL(url);
      onClose();
    }
  }, [message, phone, bannerRef, onClose, toast]);

  const DUE_OPTIONS = [
    { key: 'today', label: 'Today' },
    { key: 'week',  label: '7 days' },
    { key: 'month', label: '1 month' },
    { key: 'custom', label: 'Custom' },
  ];

  const { Banner } = activeTheme;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <TouchableOpacity style={styles.dismissArea} activeOpacity={1} onPress={onClose} />

        <View style={[styles.sheet, { height: SHEET_H }]}>
          <SheetCloseButton onPress={onClose} variant="absolute" />
          <View style={styles.handle} />

          {/* ── Top info row ── */}
          <View style={styles.infoRow}>
            <WhatsAppIcon size={18} />
            <Text style={styles.infoName} numberOfLines={1}>{person || 'Someone'}</Text>
            <View style={[styles.amtBadge, { backgroundColor: '#25D36618' }]}>
              <Text style={styles.amtBadgeText}>{formatCurrency(amount)} pending</Text>
            </View>
          </View>
          {phone ? (
            <Text style={styles.phoneHint}>{phone}</Text>
          ) : (
            <Text style={styles.noPhoneHint}>No phone saved — WhatsApp will ask you to pick a contact</Text>
          )}

          <ScrollView showsVerticalScrollIndicator={false} style={styles.scroll} contentContainerStyle={styles.scrollContent}>

            {/* ── Banner preview (captured by ViewShot for gallery save) ── */}
            <View
              ref={bannerRef}
              style={[styles.bannerWrap, { width: BANNER_W, height: BANNER_H }]}
              collapsable={false}
            >
              <Banner w={BANNER_W} h={BANNER_H} />
              {/* Text overlay on banner */}
              <View style={styles.bannerOverlay} pointerEvents="none">
                <View style={[styles.bannerLabelPill, { backgroundColor: activeTheme.labelBg + 'EE' }]}>
                  <Text style={[styles.bannerLabelTitle, { color: activeTheme.labelText }]}>
                    {activeTheme.emoji}  {activeTheme.title}
                  </Text>
                  <Text style={[styles.bannerLabelSub, { color: activeTheme.labelText + 'BB' }]}>
                    {activeTheme.tagline}
                  </Text>
                </View>
              </View>
            </View>

            {/* ── Theme selector ── */}
            <Text style={styles.sectionLabel}>Choose style</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.themeScroll} contentContainerStyle={styles.themeScrollContent}>
              {REMINDER_THEMES.map((t) => (
                <TouchableOpacity
                  key={t.id}
                  style={[styles.themeChip, themeId === t.id && { borderColor: t.accentColor, borderWidth: 2 }]}
                  onPress={() => setThemeId(t.id)}
                  activeOpacity={0.8}
                >
                  {/* Thumbnail banner */}
                  <View style={styles.thumbWrap}>
                    <t.Banner w={80} h={50} />
                    {themeId === t.id ? (
                      <View style={[styles.thumbCheck, { backgroundColor: t.accentColor }]}>
                        <Text style={styles.thumbCheckMark}>✓</Text>
                      </View>
                    ) : null}
                  </View>
                  <Text style={[styles.themeChipLabel, themeId === t.id && { color: t.accentColor, fontWeight: '700' }]}>
                    {t.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            {/* ── Due date ── */}
            <Text style={styles.sectionLabel}>Add due date (optional)</Text>
            <View style={styles.dueDateRow}>
              {DUE_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt.key}
                  style={[styles.dueChip, dueDateKey === opt.key && { backgroundColor: theme.primary + '18', borderColor: theme.primary }]}
                  onPress={() => setDueDateKey(dueDateKey === opt.key ? null : opt.key)}
                >
                  <Text style={[styles.dueChipText, dueDateKey === opt.key && { color: theme.primary, fontWeight: '700' }]}>
                    {opt.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
            {dueDateKey === 'custom' ? (
              <TextInput
                value={customDate}
                onChangeText={setCustomDate}
                placeholder="e.g. 30 June 2025"
                placeholderTextColor={colors.textMuted}
                style={styles.customDateInput}
              />
            ) : null}

            {/* ── Message preview / edit ── */}
            <View style={styles.msgHeader}>
              <Text style={styles.sectionLabel}>Message preview</Text>
              {msgOverride !== null ? (
                <TouchableOpacity onPress={() => setMsgOverride(null)}>
                  <Text style={styles.resetText}>↺ Reset</Text>
                </TouchableOpacity>
              ) : null}
            </View>
            <View style={styles.msgBox}>
              <TextInput
                value={message}
                onChangeText={setMsgOverride}
                multiline
                style={styles.msgText}
                textAlignVertical="top"
              />
            </View>

          </ScrollView>

          {/* ── Gallery hint ── */}
          <View style={styles.galleryHint}>
            <Text style={styles.galleryHintText}>
              📸 Banner will be saved to your gallery — attach it in WhatsApp using the 📎 button
            </Text>
          </View>

          {/* ── Send button ── */}
          <TouchableOpacity style={styles.sendBtn} onPress={handleSend} activeOpacity={0.85}>
            <WhatsAppIcon size={18} color="#fff" />
            <Text style={styles.sendBtnText}>
              {phone ? `Send to ${(person || '').split(' ')[0]}` : 'Open WhatsApp'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.cancelBtn} onPress={onClose}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>

      <CenterModal
        visible={!!confirm}
        title={confirm?.title}
        message={confirm?.message}
        primaryText={confirm?.primaryText || 'OK'}
        secondaryText={confirm?.secondaryText}
        destructive={!!confirm?.destructive}
        onPrimary={confirm?.onConfirm || (() => setConfirm(null))}
        onSecondary={() => setConfirm(null)}
        onClose={() => setConfirm(null)}
      />
    </Modal>
  );
};

// =============================================================================
// Styles
// =============================================================================
const styles = StyleSheet.create({
  backdrop:    { flex: 1, backgroundColor: '#0007', justifyContent: 'flex-end' },
  dismissArea: { flex: 1 },
  sheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.divider,
    alignSelf: 'center',
    marginBottom: spacing.md,
  },

  infoRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  infoName: { ...typography.bodyBold, color: colors.textPrimary, flex: 1 },
  amtBadge: { paddingHorizontal: spacing.sm, paddingVertical: 3, borderRadius: radius.pill },
  amtBadgeText: { ...typography.tiny, color: '#10B981', fontWeight: '700' },
  phoneHint: { ...typography.tiny, color: colors.textSecondary, marginBottom: spacing.sm },
  noPhoneHint: { ...typography.tiny, color: colors.textMuted, fontStyle: 'italic', marginBottom: spacing.sm },

  scroll: { flex: 1, minHeight: 0 },
  scrollContent: { paddingBottom: spacing.sm },

  bannerWrap: {
    borderRadius: 14,
    overflow: 'hidden',
    marginBottom: spacing.sm,
  },
  bannerOverlay: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'flex-end',
    paddingRight: spacing.md,
  },
  bannerLabelPill: {
    borderRadius: radius.lg,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    maxWidth: 180,
  },
  bannerLabelTitle: { ...typography.bodyBold, fontWeight: '800', fontSize: 13 },
  bannerLabelSub: { ...typography.tiny, marginTop: 2 },

  sectionLabel: {
    ...typography.small, color: colors.textSecondary,
    fontWeight: '700', marginBottom: spacing.xs, marginTop: spacing.sm,
  },

  themeScroll: { marginBottom: spacing.xs },
  themeScrollContent: { gap: spacing.sm, paddingVertical: 4 },
  themeChip: {
    alignItems: 'center',
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.divider,
    overflow: 'hidden',
    backgroundColor: colors.background,
  },
  thumbWrap: { width: 80, height: 50, overflow: 'hidden', position: 'relative' },
  thumbCheck: {
    position: 'absolute', top: 4, right: 4,
    width: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  thumbCheckMark: { color: '#fff', fontSize: 10, fontWeight: '900' },
  themeChipLabel: {
    ...typography.tiny, color: colors.textSecondary,
    paddingVertical: 4, paddingHorizontal: 4,
  },

  dueDateRow: { flexDirection: 'row', gap: spacing.xs, marginBottom: spacing.xs },
  dueChip: {
    paddingHorizontal: spacing.md, paddingVertical: spacing.xs + 2,
    borderRadius: radius.pill, borderWidth: 1,
    borderColor: colors.divider, backgroundColor: colors.background,
  },
  dueChipText: { ...typography.small, color: colors.textSecondary },
  customDateInput: {
    backgroundColor: colors.background, borderRadius: radius.md,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
    color: colors.textPrimary, ...typography.body,
    marginBottom: spacing.sm, borderWidth: 1, borderColor: colors.divider,
  },

  msgHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  resetText: { ...typography.tiny, color: colors.textSecondary, fontWeight: '600' },
  msgBox: {
    backgroundColor: colors.background, borderRadius: radius.md,
    padding: spacing.md, minHeight: 120,
    borderWidth: 1, borderColor: colors.divider,
    marginBottom: spacing.sm,
  },
  msgText: { ...typography.body, color: colors.textPrimary, lineHeight: 22 },

  galleryHint: {
    backgroundColor: '#25D36610',
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs + 2,
    marginTop: spacing.sm,
    borderWidth: 1,
    borderColor: '#25D36630',
  },
  galleryHintText: {
    ...typography.tiny,
    color: '#25D366',
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 16,
  },
  sendBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.sm, backgroundColor: '#25D366',
    borderRadius: radius.lg, paddingVertical: spacing.md, marginTop: spacing.sm,
  },
  sendBtnText: { color: '#fff', ...typography.bodyBold, fontWeight: '700' },
  cancelBtn:  { alignItems: 'center', marginTop: spacing.sm },
  cancelText: { ...typography.body, color: colors.textSecondary },
});

export default WhatsAppReminderModal;
