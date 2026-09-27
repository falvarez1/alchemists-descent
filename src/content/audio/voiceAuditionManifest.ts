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
  { id: 'docent', name: 'Docent (current)', note: 'designed voice · soft, lisp-like S · 5 sibilant frames · 17.3 s' },
  { id: 'daniel', name: 'Daniel — the gruff old British wizard', note: 'library · crispest S · 190 frames · 17.4 s (same unhurried pace)' },
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

export const AUDITION_ENTRIES: AuditionEntry[] = VOICES.map((v) => ({
  id: `voice-${v.id}`,
  group: 'Narrator · voice comparison (pick one)',
  label: `${v.name} — ${v.note}`,
  prompt: LINES.map((l, i) => `${i + 1}. ${l.label}: “${l.text}”`).join('  '),
  urls: LINES.map((l) => `/audition/voices/${v.id}-${l.id}.mp3`),
}));
