import React, { createContext, useContext, useEffect, useReducer, useState } from 'react';
import { Keyboard, KeyboardAvoidingView, Platform, View, type KeyboardAvoidingViewProps } from 'react-native';

const KeyboardBoundary = createContext(false);

type Props = KeyboardAvoidingViewProps & {
  /** Native modals have a separate window, even though they inherit React context. */
  independentWindow?: boolean;
};

// Mounted modal boundaries, newest last. Only the front window moves, so the
// screen under an open modal doesn't shift behind its backdrop.
const modalWindows: number[] = [];
const listeners = new Set<() => void>();
let nextId = 1;
const changed = () => listeners.forEach((fn) => fn());

/** Android only. The app is edge-to-edge (Expo 57 / RN 0.86), and there the
 * window is NEVER resized for the keyboard — `softwareKeyboardLayoutMode:
 * resize` is ignored — so the inputs sat under it. RN reports the keyboard's
 * height above the navigation bar, which AndroidSafeViewport already reserves,
 * so that height is exactly the padding needed.
 */
function AndroidKeyboardView({ independentWindow, style, children, ...props }: Props) {
  const [id] = useState(() => nextId++);
  const [height, setHeight] = useState(() => (Keyboard.isVisible() ? Keyboard.metrics()?.height ?? 0 : 0));
  const [, rerender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    if (independentWindow) { modalWindows.push(id); changed(); }
    listeners.add(rerender);
    const show = Keyboard.addListener('keyboardDidShow', (e) => setHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
      listeners.delete(rerender);
      if (independentWindow) {
        modalWindows.splice(modalWindows.indexOf(id), 1);
        changed();
      }
    };
  }, [id, independentWindow]);

  const front = modalWindows.length ? modalWindows[modalWindows.length - 1] === id : !independentWindow;
  const inset = front ? height : 0;
  return <View {...props} style={[style, inset > 0 && { paddingBottom: inset }]}>{children}</View>;
}

/** One keyboard adjustment per native window: Android pads by the keyboard
 * height (above), iOS reserves keyboard padding. Nested form wrappers retain
 * their layout without applying a second keyboard offset.
 */
export default function AppKeyboardAvoidingView({
  independentWindow = false, children, behavior, enabled,
  keyboardVerticalOffset, contentContainerStyle, ...props
}: Props) {
  const hasBoundary = useContext(KeyboardBoundary);
  if (hasBoundary && !independentWindow) return <View {...props}>{children}</View>;
  if (Platform.OS === 'android' && behavior == null) {
    return (
      <KeyboardBoundary.Provider value={true}>
        <AndroidKeyboardView {...props} independentWindow={independentWindow}>{children}</AndroidKeyboardView>
      </KeyboardBoundary.Provider>
    );
  }
  return (
    <KeyboardBoundary.Provider value={true}>
      <KeyboardAvoidingView
        {...props}
        behavior={behavior ?? (Platform.OS === 'ios' ? 'padding' : undefined)}
        enabled={enabled ?? true}
        keyboardVerticalOffset={keyboardVerticalOffset}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </KeyboardAvoidingView>
    </KeyboardBoundary.Provider>
  );
}
