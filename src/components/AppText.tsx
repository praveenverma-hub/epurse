// The app's Text and TextInput: react-native's, with the OS font-size multiplier
// capped at FONT_SCALE_MAX. Import these, never react-native's (test:parse
// enforces it). A wrapper because React 19 ignores `defaultProps` on function
// components, so RN's Text can't be given a default globally.
import React, { createContext, useContext } from 'react';
import { Text as RNText, TextInput as RNTextInput } from 'react-native';
import { FONT_SCALE_FIXED, FONT_SCALE_MAX } from '../constants/layout';

const MaxScale = createContext(FONT_SCALE_MAX);

/**
 * Text inside stops growing with the OS font size. Wrap a box whose size
 * doesn't follow its content (tab bar, carousel card, bank card) once, rather
 * than tagging every Text in it.
 */
export const FixedTextScale = ({ children }: { children: React.ReactNode }) => (
  <MaxScale.Provider value={FONT_SCALE_FIXED}>{children}</MaxScale.Provider>
);

export const Text = (props: React.ComponentPropsWithRef<typeof RNText>) => (
  <RNText maxFontSizeMultiplier={useContext(MaxScale)} {...props} />
);

export const TextInput = (props: React.ComponentPropsWithRef<typeof RNTextInput>) => (
  <RNTextInput maxFontSizeMultiplier={useContext(MaxScale)} {...props} />
);

// So `useRef<TextInput>(null)` still types as the instance.
export type Text = RNText;
export type TextInput = RNTextInput;
