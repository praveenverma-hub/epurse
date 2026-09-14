// AppSwitch — iOS's Switch renders larger than Android's; scale it down on iOS only.
import React from 'react';
import { Platform, StyleSheet, Switch, SwitchProps } from 'react-native';

const AppSwitch: React.FC<SwitchProps> = ({ style, ...props }) => (
  <Switch style={[Platform.OS === 'ios' && styles.ios, style]} {...props} />
);

export default AppSwitch;

const styles = StyleSheet.create({
  ios: { transform: [{ scale: 0.85 }] },
});
