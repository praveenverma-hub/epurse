import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { useTheme } from '../hooks/useTheme';

/** Reserve system navigation space once for the entire Android surface.
 * The inner native provider measures the reduced viewport: existing screen
 * SafeAreaViews and inset-based footers then see zero for consumed edges.
 * Top remains screen-owned. Side edges also protect landscape navigation.
 */
export default function AndroidSafeViewport({ children, fillBackground = false }: React.PropsWithChildren<{ fillBackground?: boolean }>) {
  const theme = useTheme();
  if (Platform.OS !== 'android') return <>{children}</>;
  return (
    <SafeAreaView
      style={[styles.fill, fillBackground && { backgroundColor: theme.card }]}
      edges={['left', 'right', 'bottom']}
    >
      <SafeAreaProvider>{children}</SafeAreaProvider>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({ fill: { flex: 1 } });
