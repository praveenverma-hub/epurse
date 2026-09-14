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

export interface FaqItem {
  id: string;
  question: string;
  answer: string;
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
              {isOpen ? <Text style={[styles.answer, { color: theme.textSecondary }]}>{item.answer}</Text> : null}
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
  question: { ...typography.bodyBold, flex: 1 },
  answer: {
    ...typography.small,
    lineHeight: 22,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    marginTop: -spacing.sm,
  },
});
