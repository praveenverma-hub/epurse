// =============================================================================
// Toast.tsx — outlined, theme-aware top-rendered toast + provider.
//
// Usage:
//   1. Wrap your app: <ToastProvider><App /></ToastProvider>
//   2. From any component: const toast = useToast(); toast.show({ ... });
//
// Behaviour:
//   • Renders from the top of the screen, just below the safe-area inset.
//   • Outlined surface that matches the active theme (uses theme.primary for
//     the default border + emphasis stripe; status variants override).
//   • Auto-hides after `durationMs` (default 4500). Tap-to-dismiss as well.
//   • Animations run entirely on the UI thread via Reanimated v3 shared values.
//   • Provider serialises toasts: showing a new one cancels the visible one
//     cleanly (no overlapping stack — keeps the UI predictable).
// =============================================================================

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { useTheme } from '../hooks/useTheme';

// ─── Public API ──────────────────────────────────────────────────────────────

export type ToastVariant = 'info' | 'success' | 'warning' | 'error';

export interface ToastOptions {
  /** Required. Bold one-liner that anchors the toast. */
  title:    string;
  /** Optional. Smaller line below the title for context. */
  message?: string;
  /** Visual tone. Default 'info' uses the active theme primary. */
  variant?: ToastVariant;
  /** Auto-hide delay in ms. Default 4500. Pass 0 for sticky (manual dismiss). */
  durationMs?: number;
}

export interface ToastApi {
  show:    (opts: ToastOptions) => void;
  hide:    () => void;
  success: (title: string, message?: string) => void;
  error:   (title: string, message?: string) => void;
  warning: (title: string, message?: string) => void;
  info:    (title: string, message?: string) => void;
}

// ─── Internal types ──────────────────────────────────────────────────────────

interface ActiveToast extends Required<Omit<ToastOptions, 'message'>> {
  message?: string;
  /** Monotonic id; flipping it forces the rendered toast to re-animate. */
  id: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_DURATION_MS = 4500;
const ENTER_MS            = 280;
const EXIT_MS             = 220;

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastApi | null>(null);

/** Throws when called outside a <ToastProvider> — that's a programmer error. */
export const useToast = (): ToastApi => {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    throw new Error('useToast() must be used within <ToastProvider>.');
  }
  return ctx;
};

// ─── Provider ────────────────────────────────────────────────────────────────

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [active, setActive] = useState<ActiveToast | null>(null);
  const seqRef              = useRef<number>(0);

  const hide = useCallback(() => {
    setActive(null);
  }, []);

  const show = useCallback((opts: ToastOptions) => {
    seqRef.current += 1;
    setActive({
      id:         seqRef.current,
      title:      opts.title,
      message:    opts.message,
      variant:    opts.variant     ?? 'info',
      durationMs: opts.durationMs  ?? DEFAULT_DURATION_MS,
    });
  }, []);

  const api: ToastApi = useMemo(() => ({
    show,
    hide,
    success: (title, message) => show({ title, message, variant: 'success' }),
    error:   (title, message) => show({ title, message, variant: 'error'   }),
    warning: (title, message) => show({ title, message, variant: 'warning' }),
    info:    (title, message) => show({ title, message, variant: 'info'    }),
  }), [show, hide]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {active ? (
        <ToastHost active={active} onDismiss={hide} />
      ) : null}
    </ToastContext.Provider>
  );
};

// ─── Host (the actual animated surface) ──────────────────────────────────────

const ToastHost: React.FC<{
  active:    ActiveToast;
  onDismiss: () => void;
}> = ({ active, onDismiss }) => {
  const theme = useTheme();

  const opacity   = useSharedValue<number>(0);
  const translate = useSharedValue<number>(-32);

  // Re-arm enter/exit whenever a new toast lands (id changes).
  useEffect(() => {
    opacity.value = withTiming(1, {
      duration: ENTER_MS,
      easing:   Easing.out(Easing.cubic),
    });
    translate.value = withSpring(0, {
      damping:        16,
      stiffness:      170,
      mass:           0.8,
      overshootClamping: false,
    });

    if (active.durationMs <= 0) {
      // Sticky — caller must call .hide() explicitly.
      return () => {
        cancelAnimation(opacity);
        cancelAnimation(translate);
      };
    }

    const t = setTimeout(() => {
      opacity.value = withTiming(0, { duration: EXIT_MS });
      translate.value = withTiming(
        -32,
        { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(onDismiss)();
        },
      );
    }, active.durationMs);

    return () => {
      clearTimeout(t);
      cancelAnimation(opacity);
      cancelAnimation(translate);
    };
  }, [active.id, active.durationMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleTapDismiss = useCallback(() => {
    cancelAnimation(opacity);
    cancelAnimation(translate);
    opacity.value = withTiming(0, { duration: EXIT_MS });
    translate.value = withTiming(
      -32,
      { duration: EXIT_MS, easing: Easing.in(Easing.cubic) },
      (finished) => {
        if (finished) runOnJS(onDismiss)();
      },
    );
  }, [opacity, translate, onDismiss]);

  const wrapStyle = useAnimatedStyle(() => ({
    opacity:   opacity.value,
    transform: [{ translateY: translate.value }],
  }));

  // Tone selection — variants override theme primary.
  const tone = useMemo(() => toneForVariant(active.variant, theme), [active.variant, theme]);

  return (
    <SafeAreaView
      edges={['top']}
      pointerEvents="box-none"
      style={styles.host}
    >
      <Animated.View style={[styles.wrap, wrapStyle]} pointerEvents="box-none">
        <Pressable
          onPress={handleTapDismiss}
          accessibilityRole="alert"
          accessibilityLiveRegion="polite"
          style={[
            styles.toast,
            {
              borderColor:     tone.border,
              backgroundColor: theme.card,
            },
          ]}
        >
          <View style={[styles.stripe, { backgroundColor: tone.stripe }]} />
          <View style={styles.body}>
            <Text style={[styles.title, { color: theme.textPrimary }]} numberOfLines={2}>
              <Text style={{ color: tone.glyph }}>{tone.icon}  </Text>
              {active.title}
            </Text>
            {active.message ? (
              <Text style={[styles.message, { color: theme.textSecondary }]} numberOfLines={3}>
                {active.message}
              </Text>
            ) : null}
          </View>
        </Pressable>
      </Animated.View>
    </SafeAreaView>
  );
};

// ─── Tone resolver ───────────────────────────────────────────────────────────

interface Tone {
  border: string;
  stripe: string;
  glyph:  string;
  icon:   string;
}

const toneForVariant = (
  variant: ToastVariant,
  theme:   ReturnType<typeof useTheme>,
): Tone => {
  switch (variant) {
    case 'success':
      return { border: theme.success, stripe: theme.success, glyph: theme.success, icon: '✓' };
    case 'error':
      return { border: theme.danger,  stripe: theme.danger,  glyph: theme.danger,  icon: '!' };
    case 'warning':
      return { border: theme.warning, stripe: theme.warning, glyph: theme.warning, icon: '⚠' };
    case 'info':
    default:
      return { border: theme.primary, stripe: theme.primary, glyph: theme.primary, icon: 'ⓘ' };
  }
};

// ─── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  host: {
    position:   'absolute',
    top:        0,
    left:       0,
    right:      0,
    zIndex:     1000,
    elevation:  1000,
  },
  wrap: {
    paddingHorizontal: 16,
    paddingTop:        6,
    width:             '100%',
    alignItems:        'center',
  },
  toast: {
    flexDirection:    'row',
    overflow:         'hidden',
    borderWidth:      1.5,
    borderRadius:     14,
    minHeight:        56,
    width:            '100%',
    maxWidth:         520,
    shadowColor:      '#000',
    shadowOpacity:    0.16,
    shadowRadius:     12,
    shadowOffset:     { width: 0, height: 6 },
    elevation:        10,
  },
  stripe: {
    width: 4,
  },
  body: {
    flex:              1,
    paddingHorizontal: 14,
    paddingVertical:   12,
    justifyContent:    'center',
  },
  title: {
    fontSize:      14,
    fontWeight:    '800',
    letterSpacing: -0.1,
    lineHeight:    20,
  },
  message: {
    fontSize:   13,
    lineHeight: 18,
    marginTop:  2,
  },
});

export default ToastProvider;
