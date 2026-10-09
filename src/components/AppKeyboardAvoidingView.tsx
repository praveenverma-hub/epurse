import React, { createContext, useContext } from 'react';
import { KeyboardAvoidingView, Platform, View, type KeyboardAvoidingViewProps } from 'react-native';

const KeyboardBoundary = createContext(false);

type Props = KeyboardAvoidingViewProps & {
  /** Native modals have a separate window, even though they inherit React context. */
  independentWindow?: boolean;
};

/** One keyboard adjustment per native window. Android uses the native
 * adjustResize window mode; iOS reserves keyboard padding. Nested form wrappers
 * retain their layout without applying a second keyboard offset.
 */
export default function AppKeyboardAvoidingView({
  independentWindow = false, children, behavior, enabled,
  keyboardVerticalOffset, contentContainerStyle, ...props
}: Props) {
  const hasBoundary = useContext(KeyboardBoundary);
  if (hasBoundary && !independentWindow) return <View {...props}>{children}</View>;
  // Android's adjustResize already changes the window height. With no behavior,
  // KeyboardAvoidingView still subscribes to keyboard events and schedules a
  // layout animation, which can make an entire modal jump on input focus.
  if (Platform.OS === 'android' && behavior == null) {
    return <KeyboardBoundary.Provider value={true}><View {...props}>{children}</View></KeyboardBoundary.Provider>;
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
