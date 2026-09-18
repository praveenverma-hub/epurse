// =============================================================================
// empty.ts — stable empty collections.
//
// Exists for one reason: a zustand selector must never ALLOCATE.
//
//   useEPurseStore((s) => s.maybeMissing ?? [])   // ✗ new [] on every call
//
// zustand v5 reads through a plain `useSyncExternalStore`, which compares
// snapshots by reference. A selector that builds a fresh array or object each
// call never compares equal to itself, so React re-renders, re-reads, and loops
// — "The result of getSnapshot should be cached to avoid an infinite loop",
// then "Maximum update depth exceeded". v4 memoised the selector and hid this.
//
// Default OUTSIDE the selector against one of these instead:
//
//   useEPurseStore((s) => s.maybeMissing) ?? EMPTY_ARRAY   // ✓ stable
//
// Frozen so an accidental push fails loudly rather than leaking shared state
// into an unrelated screen.
// =============================================================================

export const EMPTY_ARRAY: any[] = Object.freeze([]) as any[];

export const EMPTY_OBJECT: Record<string, any> = Object.freeze({});
