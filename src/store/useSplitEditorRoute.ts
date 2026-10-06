// =============================================================================
// useSplitEditorRoute — opens the split editor as a real stack route
// ('SplitEditor'), while the split STATE stays in the form that owns it.
//
// The form stays mounted under the pushed route, so it keeps publishing its
// live SplitPage props here (every commit); SplitEditorScreen renders them.
// Callbacks / elements can't go through route params, hence this slot.
// One owner at a time: the form that called `open()`.
// =============================================================================
import { useLayoutEffect, useRef } from 'react';
import { create } from 'zustand';
import { useNavigation } from '@react-navigation/native';
import type { SplitPageProps } from '../components/SplitPage';

export interface SplitEditorSpec {
  page: Omit<SplitPageProps, 'onBack' | 'onDone' | 'headerRight'>;
  /** Done pressed — return false to stay on the page (e.g. shares don't add up). */
  onDone?: () => boolean | void;
  /** The route closed by ANY means (Done, back button, swipe-back). */
  onClose?: () => void;
  /** Shows a trash icon in the header; confirmed, it runs `onConfirm` and closes. */
  remove?: { message: string; onConfirm: () => void };
}

interface HostState {
  owner: object | null;
  spec: SplitEditorSpec | null;
}

export const useSplitEditorHost = create<HostState>(() => ({ owner: null, spec: null }));

/** `spec` null = nothing to edit (the route closes itself if it's open). */
export function useSplitEditorRoute(spec: SplitEditorSpec | null) {
  const navigation = useNavigation<any>();
  const owner = useRef({}).current;

  // Publish after every commit while this form owns the route.
  useLayoutEffect(() => {
    if (useSplitEditorHost.getState().owner === owner) useSplitEditorHost.setState({ spec });
  });

  useLayoutEffect(() => () => {
    if (useSplitEditorHost.getState().owner === owner) useSplitEditorHost.setState({ owner: null, spec: null });
  }, []);

  return {
    open: () => {
      if (!spec) return;
      useSplitEditorHost.setState({ owner, spec });
      navigation.navigate('SplitEditor');
    },
  };
}
