// =============================================================================
// useCategoryTree / useCategoryMaps
// -----------------------------------------------------------------------------
// The live two-tier category tree = built-in categories MERGED with the user's
// custom parents/children (from the store). Every category picker should read the
// tree from here (not the static PARENT_CATEGORIES import) so custom categories
// show up and stay in sync. useCategoryMaps() exposes the matching legacy lookup
// maps for screens that need to resolve a selection to a legacy categoryId.
// =============================================================================

import { useMemo } from 'react';
import { useEPurseStore } from '../store/ePurseStore';
import {
  buildCategoryTree,
  buildLegacyMaps,
  type ParentCat,
  type CategoryMaps,
} from '../constants/twoTierCategories';

export const useCategoryTree = (): ParentCat[] => {
  const customParents  = useEPurseStore((s: any) => s.customParents);
  const customChildren = useEPurseStore((s: any) => s.customChildren);
  return useMemo(
    () => buildCategoryTree(customParents ?? [], customChildren ?? []),
    [customParents, customChildren],
  );
};

export const useCategoryMaps = (): CategoryMaps => {
  const tree = useCategoryTree();
  return useMemo(() => buildLegacyMaps(tree), [tree]);
};
