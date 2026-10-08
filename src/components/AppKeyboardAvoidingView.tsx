import React, { createContext, useContext } from 'react';
import { KeyboardAvoidingView, Platform, View, type KeyboardAvoidingViewProps } from 'react-native';

const KeyboardBoundary = createContext(false);

type Props = KeyboardAvoidingViewProps & {
  /** Native modals have a separate window, even though they inherit React context. */
  independentWindow?: boolean;
};

/** One keyboard adjustment per native window. Android bounds the available
 * height; iOS reserves keyboard padding. Nested form wrappers retain their layout
 * without applying a second keyboard offset.
 */
export default function AppKeyboardAvoidingView({
  independentWindow = false, children, behavior, enabled,
  keyboardVerticalOffset, contentContainerStyle, ...props
}: Props) {
  const hasBoundary = useContext(KeyboardBoundary);
  if (hasBoundary && !independentWindow) return <View {...props}>{children}</View>;
  return (
    <KeyboardBoundary.Provider value={true}>
      <KeyboardAvoidingView
        {...props}
        behavior={behavior ?? (Platform.OS === 'ios' ? 'padding' : 'height')}
        enabled={enabled ?? true}
        keyboardVerticalOffset={keyboardVerticalOffset}
        contentContainerStyle={contentContainerStyle}
      >
        {children}
      </KeyboardAvoidingView>
    </KeyboardBoundary.Provider>
  );
}
