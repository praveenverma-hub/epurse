// FaqAccordion — shared question/answer list; tapping one closes any other open.
import React, { useState } from 'react';
import { LayoutAnimation, Platform, StyleSheet, Text, TouchableOpacity, UIManager, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { StyleProp, TextStyle, ViewStyle } from 'react-native';

import { radius, spacing, typography as typographyBase } from '../constants/theme';
import { useTheme } from '../hooks/useTheme';

const typography = typographyBase as unknown as Record<string, TextStyle>;

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

/** One step in a short pictorial flow (e.g. "how a reminder fires"). */
export interface FaqFlowStep {
  /** Ionicons name — icons, not emoji (ui-consistency §5). */
  icon: string;
  label: string;
}

export interface FaqItem {
  id: string;
  question: string;
  /** Short lead-in line before the bullets/flow, or the whole answer if
   *  neither applies. */
  intro?: string;
  /** Preferred over `answer` whenever the content IS a list — a passage
   *  that's actually 2+ facts reads faster as points than as prose. */
  bullets?: string[];
  /** Trailing prose, or the entire answer for a single fact that isn't a list. */
  answer?: string;
  /** A short left-to-right step diagram for a flow (state machine, sequence). */
  flow?: FaqFlowStep[];
}

interface Props {
  items: FaqItem[];
  /** Bold heading above the card, e.g. "FAQs". Omit if the caller has its own. */
  title?: string;
  /** Outer spacing only — layout is the caller's job. */
  style?: StyleProp<ViewStyle>;
}

const FaqAccordion: React.FC<Props> = ({ items, title, style }) => {
  const theme = useTheme();
  const [openId, setOpenId] = useState<string | null>(null);

  const toggle = (id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpenId((cur) => (cur === id ? null : id));
  };

  return (
    <View style={style}>
      {title ? <Text style={[styles.title, { color: theme.textPrimary }]}>{title}</Text> : null}
      <View style={[styles.card, { borderColor: theme.divider, backgroundColor: theme.card }]}>
        {items.map((item, i) => {
          const isOpen = openId === item.id;
          return (
            <View
              key={item.id}
              style={i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: theme.divider }}
            >
              <TouchableOpacity
                style={styles.header}
                onPress={() => toggle(item.id)}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityState={{ expanded: isOpen }}
              >
                <Text style={[styles.question, { color: theme.textPrimary }]}>{item.question}</Text>
                <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} color={theme.textSecondary} />
              </TouchableOpacity>
              {isOpen ? (
                <View style={styles.answerWrap}>
                  {item.intro ? (
                    <Text style={[styles.answer, { color: theme.textSecondary }]}>{item.intro}</Text>
                  ) : null}
                  {item.bullets ? item.bullets.map((b, bi) => (
                    <View key={bi} style={styles.bulletRow}>
                      <View style={[styles.bulletDot, { backgroundColor: theme.textSecondary }]} />
                      <Text style={[styles.bulletTxt, { color: theme.textSecondary }]}>{b}</Text>
                    </View>
                  )) : null}
                  {item.answer ? (
                    <Text style={[styles.answer, { color: theme.textSecondary }]}>{item.answer}</Text>
                  ) : null}
                  {item.flow ? (
                    <View style={styles.flowRow}>
                      {item.flow.map((step, si) => (
                        <React.Fragment key={si}>
                          {si > 0 ? (
                            <Ionicons name="chevron-forward" size={14} color={theme.textMuted} style={styles.flowArrow} />
                          ) : null}
                          <View style={[styles.flowStep, { backgroundColor: theme.primary + '14', borderColor: theme.primary + '33' }]}>
                            <Ionicons name={step.icon as any} size={18} color={theme.primary} />
                            <View style={styles.flowLabelWrap}>
                              <Text style={[styles.flowLabel, { color: theme.textPrimary }]} numberOfLines={2}>
                                {step.label}
                              </Text>
                            </View>
                          </View>
                        </React.Fragment>
                      ))}
                    </View>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default FaqAccordion;

const styles = StyleSheet.create({
  title: { ...typography.h3, marginBottom: spacing.md },
  card: {
    borderWidth: 1,
    borderRadius: radius.lg,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  question: { ...typography.small, fontWeight: '600', flex: 1 },
  answerWrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    marginTop: -spacing.sm,
    gap: spacing.xs,
  },
  answer: { ...typography.small, lineHeight: 22 },
  bulletRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  bulletDot: { width: 5, height: 5, borderRadius: 2.5, marginTop: 8 },
  bulletTxt: { ...typography.small, lineHeight: 20, flex: 1 },
  flowRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  // Fixed width AND height — every chip is the same size regardless of how
  // long its own label runs, so a 1-line label doesn't sit in a shorter box
  // than a 2-line one beside it.
  flowStep: {
    width: 84,
    height: 78,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  // Reserves exactly two lines' worth of height so the label centres the
  // same way whether it wraps to one line or two.
  flowLabelWrap: { height: 26, justifyContent: 'center' },
  flowLabel: { ...typography.tiny, fontSize: 10, textAlign: 'center', lineHeight: 13 },
  flowArrow: { marginHorizontal: -2 },
});
