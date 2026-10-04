/**
 * The Duel announcer on the dev-only audition page (audition.html): every call
 * the cabinet makes, with what speech-to-text heard in the shipped take, and the
 * casting (every candidate reading the same script, ranked by what we could
 * measure: scripts/audio/gen-duel-announcer.mjs). The arcade SFX (`duel.*`)
 * are listed by sfxManifest with the rest of the arena pack. Nothing in the
 * game imports this module.
 */
import { DUEL_ANNOUNCER_CAST, DUEL_ANNOUNCER_VOICE, DUEL_CAST_RULE, DUEL_CAST_SCRIPT, DUEL_CLIP_LINES, DUEL_CLIPS } from '@/content/audio/duelAnnouncer.generated';

interface AuditionEntry { id: string; group: string; label: string; prompt: string; urls: string[]; loop?: boolean }

const GROUP_LABEL: Readonly<Record<string, string>> = { select: 'select screen', match: 'match', result: 'result' };

export const AUDITION_ENTRIES: AuditionEntry[] = [
  ...DUEL_CLIP_LINES.map((line) => ({
    id: `duel-voice-${line.id}`,
    group: `Duel announcer · ${GROUP_LABEL[line.group] ?? line.group} (${DUEL_ANNOUNCER_VOICE.name})`,
    label: `${line.text}  — speech-to-text heard “${line.heard}”${line.confirmed ? '' : '  (NOT CONFIRMED)'}`,
    prompt: line.id,
    urls: [`${import.meta.env.BASE_URL}${DUEL_CLIPS[line.id].url}`],
  })),
  ...DUEL_ANNOUNCER_CAST.map((c) => ({
    id: `duel-cast-${c.key}`,
    group: 'Duel announcer · casting (same script, ranked)',
    label: `${c.rank}. ${c.name} — ${c.f0Median} Hz ±${c.f0RangeSt} st · presence ${c.presenceDb} dB · S ${c.sibilantPerSecond}/s · ${c.seconds} s${c.excluded ? ` · EXCLUDED: ${c.excluded}` : ''}`,
    prompt: `“${DUEL_CAST_SCRIPT}” — heard: “${c.heard}”. Rule: ${DUEL_CAST_RULE}`,
    urls: [`${import.meta.env.BASE_URL}${c.url}`],
  })),
];
