/**
 * How the narrator finds a recording for a line of text. Clips are keyed by a
 * hash of the NORMALISED text, so the narrator can voice whatever the UI
 * actually shows: if the copy changes and nobody re-voices it, the key misses
 * and the narrator simply stays silent (never the wrong words).
 *
 * The generator (scripts/audio/voice-lines.mjs) bundles this very module, so
 * the offline side and the game can never disagree about a key.
 */

/** Case, curly punctuation, ellipses and spacing do not change what is said. */
export function normalizeNarration(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[‘’ʼ′]/g, "'")
    .replace(/[“”″]/g, '"')
    .replace(/…/g, '...')
    .replace(/[–—]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/** FNV-1a (32-bit) of the normalised text, as 8 hex digits. */
export function narrationKey(text: string): string {
  const s = normalizeNarration(text);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** A floor's arrival as spoken: its name, then the title card's epigraph. */
export function arrivalLine(floorName: string, epigraph: string): string {
  return `${floorName}. ${epigraph}`;
}
