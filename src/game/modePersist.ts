// Mode persistence across reloads (dev only).
//
// Boot always resets ctx.state.mode to its 'build' (Sandbox) default, so any
// reload — a manual browser refresh, or Vite's own full-reload when it can't
// hot-patch a change (Game.ts / Builder.ts ...) — used to dump you back in the
// Sandbox even when you were in Play or the Builder.
//
// We mirror the live top-level mode into sessionStorage on every change and
// restore it on the next boot, so a refresh returns you to where you were.
// Dev only (import.meta.env.DEV): production keeps its canonical Sandbox-first,
// launcher-gated boot. sessionStorage is per-tab and clears with the tab, so
// this never leaks across browser sessions or to other origins.
//
// Only the top-level mode is restored — not the descent's level, the player's
// position, or the open Builder document. A reload regenerates the world, so
// deeper state could not survive anyway; this just reopens the right room.

export type AppMode = 'sandbox' | 'play' | 'builder';

// Headless probes that reset to a clean slate (e.g. verify-run-launcher's
// resetLauncherStorageAndReload) must clear this key so their reload still
// boots into the Sandbox.
const KEY = 'ad-mode';

/**
 * Derive the current top-level app mode. The Builder rides on top of build mode
 * (it only adds a body class), so it wins over the underlying play/build state.
 */
export function currentAppMode(stateMode: 'build' | 'play'): AppMode {
  if (document.body.classList.contains('builder-open')) return 'builder';
  return stateMode === 'play' ? 'play' : 'sandbox';
}

/**
 * Mirror the live mode into sessionStorage. Sandbox is the default boot mode,
 * so it clears the key instead of storing it (keeps a fresh tab clean).
 */
export function saveAppMode(mode: AppMode): void {
  try {
    if (mode === 'sandbox') sessionStorage.removeItem(KEY);
    else sessionStorage.setItem(KEY, mode);
  } catch {
    // sessionStorage can throw in sandboxed/private contexts — never fatal.
  }
}

/** The mode to restore on boot, or null for the default Sandbox. */
export function readAppMode(): AppMode | null {
  try {
    const value = sessionStorage.getItem(KEY);
    return value === 'play' || value === 'builder' ? value : null;
  } catch {
    return null;
  }
}
