// =============================================================================
// SplitEditorScreen — the 'SplitEditor' stack route. Renders the shared
// SplitPage from whatever form opened it (see store/useSplitEditorRoute).
// =============================================================================
import React, { useEffect, useRef, useState } from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import SplitPage from '../components/SplitPage';
import CenterModal from '../components/CenterModal';
import { colors } from '../constants/theme';
import { useSplitEditorHost } from '../store/useSplitEditorRoute';

export default function SplitEditorScreen({ navigation }: { navigation: any }) {
  const spec = useSplitEditorHost((s) => s.spec);
  const [confirmRemove, setConfirmRemove] = useState(false);
  // One goBack only — a second would pop the form underneath too.
  const leaving = useRef(false);
  const leave = () => {
    if (leaving.current) return;
    leaving.current = true;
    navigation.goBack();
  };

  // Nothing to edit (owner form gone) → leave.
  useEffect(() => {
    if (!spec) leave();
  }, [!spec]);

  // Back button / swipe-back / Done all end here.
  useEffect(() => () => useSplitEditorHost.getState().spec?.onClose?.(), []);

  if (!spec) return null;

  return (
    <>
      <SplitPage
        {...spec.page}
        onBack={leave}
        onDone={() => {
          if (spec.onDone?.() === false) return;
          leave();
        }}
        headerRight={
          spec.remove ? (
            <TouchableOpacity
              onPress={() => setConfirmRemove(true)}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Remove split"
            >
              <Ionicons name="trash-outline" size={22} color={colors.danger} />
            </TouchableOpacity>
          ) : undefined
        }
      />
      <CenterModal
        visible={confirmRemove && !!spec.remove}
        title="Remove split?"
        message={spec.remove?.message}
        primaryText="Remove"
        secondaryText="Cancel"
        destructive
        onPrimary={() => {
          setConfirmRemove(false);
          spec.remove?.onConfirm();
          leave();
        }}
        onSecondary={() => setConfirmRemove(false)}
        onClose={() => setConfirmRemove(false)}
      />
    </>
  );
}
