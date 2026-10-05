import React from 'react';
import { Modal, Platform, type ModalProps } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AndroidSafeViewport from './AndroidSafeViewport';
import { useStoreHydrated } from '../hooks/useStoreHydrated';
import { useEPurseStore } from '../store/ePurseStore';
import { useAppLockSession } from '../store/useAppLockSession';

/** Native modals have their own window, so they must measure their own insets
 * rather than inherit the already-consumed insets of the application root.
 */
export default function AppModal({ children, ...props }: ModalProps) {
  const hydrated = useStoreHydrated();
  const lockEnabled = useEPurseStore((s) => s.appLockEnabled);
  const unlocked = useAppLockSession((s) => s.unlocked);
  // Unmount the native window immediately, without a dismissal animation or
  // invoking the owner's dismiss handler. Its pending state survives unlock.
  if (!hydrated || (lockEnabled && !unlocked)) return null;

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
