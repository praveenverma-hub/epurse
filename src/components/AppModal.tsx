import React from 'react';
import { Modal, Platform, type ModalProps } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AndroidSafeViewport from './AndroidSafeViewport';

/** Native modals have their own window, so they must measure their own insets
 * rather than inherit the already-consumed insets of the application root.
 */
export default function AppModal({ children, ...props }: ModalProps) {
  return (
    <Modal {...props}>
      {Platform.OS === 'android' ? (
        <SafeAreaProvider>
          <AndroidSafeViewport>{children}</AndroidSafeViewport>
        </SafeAreaProvider>
      ) : children}
    </Modal>
  );
}
