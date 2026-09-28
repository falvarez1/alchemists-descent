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

/**
 * A story line's recording key. The Docent is the narrator, so his lines key
 * by their text alone (one recording serves a pipe and a toast alike); Pell
 * and Matron Ash key by speaker and text, so the same words in another mouth
 * are another recording.
 */
export function speakerKey(speaker: string | undefined, text: string): string {
  return !speaker || speaker === 'docent' ? narrationKey(text) : narrationKey(`${speaker}: ${text}`);
}

/** Seconds a caption stays readable when no recording carries it (≈ 2.6 words/s, never under 2 s). */
export function readingSeconds(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(2, Math.min(9, 0.9 + words * 0.38));
}
