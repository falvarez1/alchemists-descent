# Arena music and combat audio

Generated and integrated on 2026-10-03. Arena previously borrowed the slow Bellows campaign cue because the music director had no competitive-mode route. Solo Proving Yard, stock Duel, and health Duel now select an original orchestral rock battle score. Campaign music remains separate.

## Score

| Cue | Use | Mastered length | Direction |
| --- | --- | --- | --- |
| Foundry clash | Arena and Duel battle | 110.77 s loop | 156 BPM, bold brass melody, racing strings, rock drums and guitar, D minor with F major lifts |
| Challengers assemble | Duel select and rematch | 30.48 s loop | 126 BPM, lighter horn hook and bass groove |
| A worthy challenger | Match results | 12.04 s | Immediate brass fanfare and natural final decay |

The copper Foundry concepts informed the orchestration and bright metallic accents. The prompts request original melodies and performances; they contain no artist, song, or franchise names and use no reference recordings. ElevenLabs `music_v2_5` generated the three cues with instrumental output enforced through the [official compose API](https://elevenlabs.io/docs/api-reference/music/compose).

The runtime files are in `public/audio/music/arena/`. `scripts/audio/arena-music-prompts.mjs` holds the complete prompts and loop edits. `scripts/audio/arena-music-report.json` records song IDs, source cache keys, mastered SHA-256 hashes, timing, loudness and true peak. The generated catalogue is `src/content/audio/arenaScore.generated.ts`.

The score is mastered near -16 LUFS, with measured true peaks below -4.7 dBTP. Beat analysis found approximately 156.6 and 126.0 BPM. The delivered loops retain whole 4/4 bar counts at their requested tempos, 72 and 16 bars, with a 40 ms offline seam. Browser media looping owns the wrap, so the 250 ms music-director timer cannot interrupt the beat by starting another track copy. The original 120 s and 36 s paid responses remain in the ignored generation cache.

Music starts after a user gesture. Lobby-to-battle fades take 650 ms. The results fanfare enters in 160 ms and plays once, then the rematch groove starts. A rematch restarts the battle opening. Pause lowers the music; an individual fighter's stock loss or ice status does not lower or detune the shared competitive score. Leaving the session restores title or campaign routing. The existing Music slider, narration duck, limiter and hidden-tab pause still apply.

## Hits and hurt performances

The [official sound-effects API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert) exposes `eleven_text_to_sound_v2` as its current dedicated sound-effects model. All 23 new takes used that model explicitly at 44.1 kHz / 192 kbps source quality. No fallback generation model was used. Runtime mono MP3s use 160 kbps; short files preserve attack detail without stereo placement baked into the recording.

| Cue family | Takes | Contact |
| --- | --- | --- |
| `arena.hit.light` | 3 | Opener, launcher, aerial and ordinary accepted damage |
| `arena.hit.heavy` | 3 | Finisher and up smash |
| `arena.shield.block` | 2 | Absorbed shield contact |
| `arena.shield.break` | 2 | Shield exhaustion |
| `arena.grab` | 2 | Successful capture |
| `arena.throw` | 2 | Throw release |
| `arena.hurt.agile` | 3 | Original athletic, brighter adult voice |
| `arena.hurt.armored` | 3 | Original low, chesty adult voice |
| `arena.hurt.duelist` | 3 | Original clipped, husky adult voice |

These are newly generated nonverbal performances, not cloned actor voices. Ilyra, Brann and Mara use different timbres. The full roster maps to these three sets with at most two semitones of character tuning. Each cue chooses a nonrepeating take with small pitch variation. Hurt voices have a 100 ms cooldown and two-instance cap; the existing global voice pool caps all sampled effects at 40. Same-timbre fighters currently share that per-cue cooldown.

`AudioDirector` supplies the currently bound fighter to `SfxAudioEngine.hurt()`. Stock melee and throws emit contact at resolution, so hurt adds only the victim's performance. Other accepted Arena damage supplies a light impact too. Shield absorption emits no hurt voice. The old `player.hurt` recording no longer layers over Arena damage. Legacy kick misses use the existing air-only swing cue; the old generic kick impact remains for campaign play.

Files live in `src/assets/audio/sfx/arena/` and load as one Arena pack during the lobby or Arena play. The campaign does not request that pack. `scripts/audio/sfx-prompts.mjs` contains the full prompts; `scripts/audio/arena-sfx-report.json` records each take's source cache key, mastered hash, duration and measured peak. Leading dead air is removed, tails are limited to 0.25–0.65 s, and decoded true peaks stay below -3 dBTP. Integrated LUFS is recorded as null where EBU's 400 ms gate is too long for the clip.

## Evidence and audition

- `scripts/verify-arena-music.mjs` drives the visible Duel lobby and match in Edge, checks decoded WebAudio signal, native loop wrapping, pause, stock loss, ice status, result completion, rematch, title restoration, solo Arena and campaign routing. Result: `evidence/arena-music.json`.
- `scripts/verify-arena-sfx.mjs` lands real stock opener/finisher attacks, checks both victim timbres, shield block/break, capture/throw and absence of duplicate old cues. Standing idle for 300 ticks produces no hurt/contact sounds. It renders each new cue through the real mix graph and stresses the voice pool; the 180-request stress peak was 0.61, below digital clipping. Result: `evidence/arena-sfx.json`.
- `scripts/verify-arena-audio-production.mjs` uses only the visible release UI and real media elements. It verified lobby and battle playback, a 110.769 s native loop, all 23 hashed production SFX assets, successful responses, title restoration, no debug API and no browser exceptions. Result: `evidence/arena-audio-production.json`.
- `tests/arena-music.test.ts` covers routing precedence and competitive music rules. `tests/arena-audio.test.ts` covers hurt deduplication, full-roster pitch bounds, premium model provenance and mastered peaks. Existing music/catalogue tests cover the rest of the score and cue table.
- Open `audition.html` on the local dev server and filter `arena` to play every score and effect take. Music files can also be opened directly from `public/audio/music/arena/`.

Browser probes verify actual playback and sample output, not just downloaded URLs. They are headless and do not constitute a human listening review. Instrumentation cannot prove that the melody, vocal acting, or musical seam meets a listener's taste; final subjective audio approval remains open. No claim of matching Nintendo recordings is made.

## Provenance and generation

The user explicitly authorized use of their ElevenLabs account for these assets. The API key is read privately from the user-owned file into process memory and is not in the repository, prompts, logs, browser code or artifacts. Generation logs contain prompts and cache IDs only. Re-running the generators reuses content-addressed paid responses unless a prompt changes.

Use is governed by the account's applicable [ElevenLabs terms](https://elevenlabs.io/terms-of-use), [Music terms](https://elevenlabs.io/music-terms), and [Music model-specific terms](https://elevenlabs.io/eleven-music-model-specific-terms). The reports document generation provenance; they do not assert exclusive copyright ownership or replace the account's commercial-use terms.

Offline rebuild commands, with `ELEVENLABS_API_KEY_FILE` set privately when a new generation is needed:

```powershell
node scripts/audio/gen-arena-music.mjs
node scripts/audio/gen-arena-sfx.mjs
npx vitest run tests/arena-music.test.ts tests/arena-audio.test.ts tests/music-director.test.ts tests/audio-sfx.test.ts
node scripts/verify-arena-music.mjs http://127.0.0.1:5217/
node scripts/verify-arena-sfx.mjs http://127.0.0.1:5217/
node scripts/verify-arena-audio-production.mjs http://127.0.0.1:5218/
```
