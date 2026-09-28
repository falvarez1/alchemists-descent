/**
 * Narrator voice comparison for the dev-only audition page (audition.html).
 * The same three lines read by six voices, raw from ElevenLabs (eleven_v3,
 * 192 kbps). The files live in /audition/voices at the repo root — outside
 * public/, so they never reach a production build. Nothing in the game
 * imports this module.
 *
 * Why it exists (2026-09-27): the designed "Docent" reads S sounds soft and
 * mushy (a lisp baked into the voice, not the encoding). Sibilance scores are
 * frames where the S hiss dominates, on the Bellows line.
 */
interface AuditionEntry { id: string; group: string; label: string; prompt: string; urls: string[]; loop?: boolean }

const VOICES = [
  { id: 'docent', name: 'Docent (previous narrator)', note: 'designed voice · soft, lisp-like S · 5 sibilant frames · 17.3 s' },
  { id: 'daniel', name: 'Daniel — the gruff old British wizard (NOW THE NARRATOR)', note: 'library · crispest S · 190 frames · 17.4 s (same unhurried pace)' },
  { id: 'david', name: 'David — engaging wildlife narrator', note: 'library · crisp S · 230 frames · 13.6 s' },
  { id: 'ak', name: 'AK — British posh well-spoken old man', note: 'library · crisp S · 223 frames · 13.0 s' },
  { id: 'oliver', name: 'Oliver — clean, British and steady', note: 'library · clean S · 83 frames · 11.2 s' },
  { id: 'george', name: 'George — warm, captivating storyteller', note: 'premade · clean S · 61 frames · 10.1 s' },
] as const;

const LINES = [
  { id: 'bellows', label: 'Bellows line', text: 'The Bellows. The Works draw breath. Mind the pressure. And please, do mind the duck: it has been here longer than you have, and it knows where the tea is kept.' },
  { id: 'stest', label: 'S test', text: 'Six sly salesmen slowly sipped sweet sassafras. Still, the Sanctum insists: please mind the duck.' },
  { id: 'bat', label: 'Bat line (in game)', text: 'A bat cashed in the smallest possible assassination.' },
] as const;

/**
 * The story's cast (2026-09-27, scripts/audio/cast-voices.mjs; the numbers are
 * scripts/audio/cast-report.json): each candidate reads the same lines.
 * Characters a second, then sibilant frames a second (Daniel measures 5.8).
 */
const CAST = {
  pell: {
    brief: 'Pell: young, warm, a little anxious, British, crisp',
    lines: ['[nervous] Oh! Oh, thank goodness. You’re a person. Sorry. I’ve been talking to a duck all week.', 'Pell. Guild surveyor. I came down a year ago to finish the map, and I have very nearly finished being frightened.'],
    ids: ['duck', 'map'],
    voices: [
      { id: 'stephen', name: 'Stephen — well spoken, kind (CAST)', note: '12.2/13.1 ch/s · S 3.9/3.4 · pitch lifts on [nervous]' },
      { id: 'cameron', name: 'Cameron — young British (characters)', note: '10.0/10.7 ch/s · S 4.4/4.6' },
      { id: 'john', name: 'John — fresh, natural, approachable', note: '13.3/16.2 ch/s · S 4.5/4.0 · hurries' },
      { id: 'henry', name: 'Henry — expressive, character voices', note: '11.8/13.8 ch/s · S 4.3/5.0' },
      { id: 'luca', name: 'Luca — calm, clear, 24', note: '12.0/12.4 ch/s · S 5.8/3.5 · uneven S' },
    ],
  },
  ash: {
    brief: 'Matron Ash: old, whispery, kind (the chorus is added in mastering; these are raw)',
    lines: ['[softly] Come in, little breath. We are the Old Ones. We were the Guild, once. Now we are what the Works kept.'],
    ids: ['greet'],
    voices: [
      { id: 'beatrice', name: 'Beatrice — mature, gentle, British (CAST)', note: '10.3 ch/s · S 2.5 · softest S' },
      { id: 'maria', name: 'Maria Moody — grandmotherly storykeeper', note: '9.1 ch/s · S 3.8' },
      { id: 'morganna', name: 'Seer Morganna — old, wise', note: '8.8 ch/s · S 4.8 · slowest, most sibilant' },
      { id: 'eleanor', name: 'Eleanor — gracious, older British', note: '11.7 ch/s · S 4.2' },
    ],
  },
} as const;

export const AUDITION_ENTRIES: AuditionEntry[] = [
  ...VOICES.map((v) => ({
    id: `voice-${v.id}`,
    group: 'Narrator · voice comparison (pick one)',
    label: `${v.name} — ${v.note}`,
    prompt: LINES.map((l, i) => `${i + 1}. ${l.label}: “${l.text}”`).join('  '),
    urls: LINES.map((l) => `/audition/voices/${v.id}-${l.id}.mp3`),
  })),
  ...(['pell', 'ash'] as const).flatMap((role) => CAST[role].voices.map((v) => ({
    id: `cast-${role}-${v.id}`,
    group: `Story cast · ${CAST[role].brief}`,
    label: `${v.name} — ${v.note}`,
    prompt: CAST[role].lines.map((l, i) => `${i + 1}. “${l}”`).join('  '),
    urls: CAST[role].ids.map((l) => `/audition/voices/cast-${role}-${v.id}-${l}.mp3`),
  }))),
];
