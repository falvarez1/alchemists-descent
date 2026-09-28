/** One recorded narrator line (written by scripts/audio/gen-voice.mjs). */
export interface NarrationClip {
  /** Relative to the site base (import.meta.env.BASE_URL). */
  url: string;
  seconds: number;
  /** The line has no on-screen text of its own where it is spoken: show it as a caption. */
  captioned?: boolean;
}

/** A catalogued line with its takes, for the audition page. */
export interface NarrationLine {
  key: string;
  /** The text as the game shows it (the key's source). */
  text: string;
  /** What the narrator was asked to read (sentence case, sparing eleven_v3 audio tags). */
  say: string;
  group: string;
  seconds: number;
  urls: string[];
  /** Who reads it (the Docent unless the story says otherwise). */
  speaker?: 'docent' | 'pell' | 'ash';
}

/** A narrator voice candidate reading the shared sample line. */
export interface NarrationCandidate {
  id: string;
  label: string;
  url: string;
}
