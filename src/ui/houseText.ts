/**
 * House-style text helpers for player-facing copy.
 *
 * Legacy systems still emit SHOUTED strings ("THE PORTAL AWAKENS"). The house
 * tone is sentence case with dry understatement, so the HUD calms any
 * all-caps line it is handed; words that must stay capitalised (numerals,
 * initialisms, key names) survive.
 */

const KEEP_UPPER = new Set([
  'HP', 'LMB', 'RMB', 'MMB', 'GPU', 'CPU', 'UI', 'OK', 'QA', 'II', 'III', 'IV', 'VI', 'VII', 'VIII', 'IX', 'XI', 'XII',
  'ESC', 'F12',
]);

/** True when a line has letters and none of them are lowercase. */
export function isShouting(text: string): boolean {
  return /[A-Z]{2}/.test(text) && !/[a-z]/.test(text);
}

/** Two or more adjacent SHOUTED words inside a line that also carries lowercase ("16 oz SCATTERS WHERE YOU FELL"). */
const SHOUTED_RUN = /\b[A-Z]{2,}(?:[ \t]+[A-Z]{2,})+\b/g;

/**
 * "THE MECHANISM GROANS — SOMETHING GIVES WAY" → "The mechanism groans — something gives way".
 * A mixed line keeps its own words but has any SHOUTED run calmed
 * ("SECRET ALCHEMY — Gunpowder Bloom" → "Secret alchemy — Gunpowder Bloom");
 * a run of initialisms and lone words ("LMB whip · RMB throw") stays as written.
 */
export function calmCase(text: string): string {
  if (!isShouting(text)) {
    return text.replace(SHOUTED_RUN, (run, offset: number) => {
      const atStart = offset === 0 || /[.!?:—–]\s*$/.test(text.slice(0, offset));
      const calmed = run.replace(/[A-Z]+/g, (word) => (KEEP_UPPER.has(word) ? word : word.toLowerCase()));
      return atStart ? calmed[0].toUpperCase() + calmed.slice(1) : calmed;
    });
  }
  let sentenceStart = true;
  return text.replace(/[A-Za-z0-9][A-Za-z0-9']*|[.!?:]/g, (token) => {
    if (token === '.' || token === '!' || token === '?' || token === ':') {
      sentenceStart = true;
      return token;
    }
    const upper = token.toUpperCase();
    let out: string;
    // Initialisms, depths ("D2") and lone key letters ("press B") keep their caps.
    if (KEEP_UPPER.has(upper) || /^D\d+$/.test(upper) || (upper.length === 1 && upper !== 'A' && /[A-Z]/.test(upper))) out = upper;
    else if (upper === 'OZ') out = 'oz';
    else out = sentenceStart ? token[0].toUpperCase() + token.slice(1).toLowerCase() : token.toLowerCase();
    sentenceStart = false;
    return out;
  });
}
