// Mode persistence across Vite HMR full-reloads.
//
// While you edit source, Vite often can't hot-patch a change (nothing in the
// module graph accepts it — e.g. Game.ts / Builder.ts) and falls back to a FULL
// page reload. That re-runs main.ts -> new Game -> the hard-coded `mode: 'build'`
// default, dumping you back in the Sandbox no matter what you were doing.
//
// We hook Vite's `vite:beforeFullReload` HMR event (see Game.wireModePersistence)
// to snapshot the live mode into sessionStorage just before that reload, then
// restore it one-shot on the next boot. The event fires ONLY for Vite's own
// reloads: a manual refresh (F5 / location.reload), a fresh navigation, or a
// headless `page.reload()` never emits it, so the token is absent and boot
// behaves exactly as before (Sandbox). That keeps the verification suite — which
// relies on reload == clean boot — unaffected, and the whole thing is inert in
// production (import.meta.hot is undefined there, so nothing is ever saved).
//
// Only the top-level mode is preserved, not the descent's level, the player's
// position, or the open Builder document — a reload regenerates the world, so
// deeper state could not survive anyway; this just reopens the right room.

export type AppMode = 'sandbox' | 'play' | 'builder';

const KEY = 'ad-mode-before-reload';

/**
 * Derive the current top-level app mode. The Builder rides on top of build mode
 * (it only adds a body class), so it wins over the underlying play/build state.
 */
export function currentAppMode(stateMode: 'build' | 'play'): AppMode {
  if (document.body.classList.contains('builder-open')) return 'builder';
  return stateMode === 'play' ? 'play' : 'sandbox';
}

/**
 * Snapshot the mode just before a Vite full-reload. Sandbox is the default boot
 * mode, so it clears the token instead of storing it.
 */
export function saveModeForReload(mode: AppMode): void {
  try {
    if (mode === 'sandbox') sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, mode);
  } catch {
    // sessionStorage can throw in sandboxed/private contexts — never fatal.
  }
}

/**
 * Read and clear the snapshot (one-shot, so a later manual reload boots clean).
 * Returns null when there is nothing to restore.
 */
export function takeSavedMode(): AppMode | null {
  try {
    const value = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    return value === 'play' || value === 'builder' ? value : null;
  } catch {
    return null;
  }
}
