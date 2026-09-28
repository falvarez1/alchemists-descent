/**
 * Player-facing identity. Every surface that names the game (title screen,
 * document title, run summary, share text) reads these constants, so a name
 * change is one edit here. Internal identifiers — package name, save keys,
 * storage prefixes — deliberately do NOT follow the brand: renaming them
 * would orphan every player's saves.
 */
export const GAME_TITLE = 'Breathing Works';
export const GAME_SUBTITLE = 'An Alchemist’s Descent';
export const GAME_TAGLINE = 'Something is alive in the old refinery. Listen. Experiment. Find your way down.';
/** Short, lowercase slug for share codes and downloaded clip filenames. */
export const GAME_SLUG = 'breathing-works';
