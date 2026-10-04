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

## The descent stays out of the Duel

QA, 2026-10-03: the user heard "The Bellows. The Works draw breath. Mind the pressure." every time a Duel started. The cause, reproduced in Edge: after any campaign session (a run, or a title boot over a saved run), `Narrator.onLevelChanged` schedules the floor's arrival about 1.7 s after the curtain lifts. Nothing cancelled it when the player went to the title and opened the Duel, so the narrator read it over the lobby. A fresh visitor got the title tagline over the lobby the same way. The Duel stage also inherited the Bellows' ambience bed, because it borrows the earthen biome.

The fix is one gate, `inArena()` in `src/audio/arenaAudio.ts`. It is true for the Duel's lobby (`versus.active`) and a stock match, and in play on the arena levels (`fighter-duel`, `fighter-test`). Outside play the gate is never set by the level alone, so the title after a Duel is not the arena.

- **Narrator:** `say()`, `speak()` (story lines) and its queue refuse in the arena, and `versusChanged` drops a pending arrival and fades whatever was being said. The arrival, tagline, toasts, callouts, objectives, death and ledger lines all go through these paths.
- **AudioDirector:** no floor bed in the arena, and no floor roster or fauna packs. Only the `arena` pack and whatever is really there load.
- **UiSounds:** the descent's run cues (toast tick, objective tube, curtain sweep, hint, Grimoire) are silent in the arena. Pointer hovers and clicks there play the cabinet's set instead of the brass ticks: `duel.ui.move` on hover or on `[data-sfx="move"]`, `duel.ui.back` on a back or close control, `duel.ui.confirm` otherwise. The pause overlay plays `duel.ui.pause` and `duel.ui.back`.
- **Stingers:** the phials' crack and fill and the run's verdict fanfares are silent in the arena.
- **Music** already had its own arena routing (above). World sounds (materials, spells, footsteps, fighters) are real cells and real moves, so they stay.

`tests/duel-audio.test.ts` holds the gate. It replays the QA sequence (a d1 arrival pending, then the lobby opens) against a voiced fake context and expects nothing said, with a control that the same arrival IS read in the descent. With the gate mocked away, those tests fail.

## The Duel announcer

An arcade cabinet's voice, entirely separate from the Docent (library "Daniel"): **David, the ElevenLabs library's "Sports Arena Announcer"** (`DduhIyyKkOosbP8VefhP`), `eleven_v3`, stability 0.5, with every call tagged `[shouting]`.

### Casting (measured, since we cannot listen)

Every candidate read the same script: "Choose your fighter! Selene Wraith! Three! Two! One! Fight! Here comes a new challenger! Last stock! Self-destruct! Game! Father Thorne wins!". There were six library announcers, three designed voices (`eleven_ttv_v3`, from a "booming arcade fighting game announcer" brief) and two deliveries of the first pick.

Candidates were dropped if speech-to-text did not hear the script back word for word (an invented name may be within 60% of its spelling) or if their S sounds scored under 60% of the field median (the Docent's lisp lesson). The rest were ranked by **boom and hype**: z(presence: 1–5 kHz over 80 Hz–1 kHz, vocal effort) + z(pitch range: a lively read) − z(median pitch: a booming register).

| Rank | Candidate | Median F0 (Hz) | Range (st) | Presence (dB) | S /s | Length (s) | Result |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | David — sports arena, `[shouting]` | 172 | 14.7 | −1.7 | 4.62 | 11.7 | **chosen** (1.39) |
| 2 | David — sports arena | 205 | 16.2 | −2.4 | 5.24 | 12.8 | 1.22 |
| 3 | Designed preview 2 | 286 | 11.6 | +6.5 | 3.38 | 17.2 | 0.77 (a near-scream) |
| 4 | David, creative (stability 0) | 184 | 11.7 | −2.2 | 5.85 | 12.7 | 0.29 |
| 5 | Grant — hyper, over-the-top | 320 | 17.0 | −4.7 | 10.32 | 10.6 | −0.58 |
| 6 | Tyler — energetic arena | 158 | 6.1 | −0.6 | 4.93 | 13.6 | −0.58 (flat read) |
| 7 | Designed preview 1 | 364 | 11.1 | +4.7 | 4.67 | 20.8 | −0.78 |
| 8 | Ryan — event voice of god | 167 | 10.8 | −7.8 | 7.06 | 13.5 | −0.93 |
| 9 | Designed preview 3 | 340 | 10.9 | +1.8 | 5.32 | 19.0 | −1.15 |
| 10 | Jerry B. — broadcast | 267 | 13.6 | −6.7 | 6.12 | 15.0 | −1.24 |
| 11 | Xavier — dominating, metallic | 157 | 20.0 | −8.6 | 4.85 | 20.2 | dropped: "Selene Wraith" heard as "Sameen, Rafe" |

For scale, the narrator Daniel measures 115 Hz and −15.5 dB presence on his Bellows line. All the clips are in `audition/announcer/` (never shipped), and the audition page lists them in rank order.

### The calls, each tied to a real moment

| Moment (event) | Call | Sound |
| --- | --- | --- |
| The lobby opens (`versusChanged`, from idle or after "Change fighters") | "Choose your fighter!" | — |
| A seat's fighter changes (`versusChanged`) | the full name, e.g. "Rusk Emberjaw!" (10 recorded); a new choice cuts the call in progress | — |
| The stage changes | "The Foundry!" / "The Kiln!" / "The Cistern!" / "The Gallery!" | `duel.stage` |
| A player's seat readies (never the CPU, which is always ready) | "Player one, ready!" / "Player two, ready!" | `duel.ready` |
| A CPU seat becomes a player's device | "Here comes a new challenger!" | `duel.join` (coin) |
| Each countdown beat (`stockMatchBeat`, `config/stockRules` `stockCountdownBeat`, the HUD's own number) | "Three!" "Two!" "One!" | `duel.count` |
| The fight starts (`stockMatchBeat` fighting) | "Fight!" | `duel.fight` |
| A ring-out (`fighterDown`) while the match goes on | "Ring out!" and "K.O.!" in turn; "Self-destruct!" when nobody's blow sent them out; then "Last stock!" if one is left | `duel.ko` (every ring-out) |
| A shield gives out (`stockShieldBreak`) | "Shield break!" (never over a bigger call) | the existing `arena.shield.break` |
| The match ends (`stockMatchBeat` finished) | "Game!" (or "Time!" when the clock ran out), then "&lt;Name&gt; wins!" (the results card's short name; 10 recorded) or "Draw game!" | `duel.game`, then `duel.results` with the name |
| A rematch's first countdown beat | "Rematch!" in place of "Three!" | `duel.count` |

Only one call plays at a time, on the engine's `voice` bus, under the Voice slider. It ducks the score (`TALK_DUCK`) while talking. A call cuts the one in progress when it ranks as high: select < ring-out < countdown and result. A lower call is not voiced, but its sound still plays. The select screen's calls are dropped once the match is loading. The select clips preload when the lobby opens, and the match clips when it starts.

`audio/duelCalls.ts` decides (pure, tested) and `audio/DuelAnnouncer.ts` plays. The announcer subscribes to events and never polls. Two events were added: `stockMatchBeat` (ArenaSlots `tickStockMatch`, the first tick each countdown number, FIGHT or the end holds) and `stockShieldBreak` (ArenaSlots `blockStockHit`).

### The screens' API (`ctx.audio.duel`, absent in test contexts)

- `menu('move' | 'confirm' | 'back')`: keyboard or pad navigation sounds. Pointer hovers and clicks already sound (UiSounds), so call it only for non-pointer navigation.
- `announceFighter(id)` / `announceStage(id)`: a cursor previewing a fighter or stage not chosen yet. Choosing calls the name by itself, and a repeat of the name in progress is ignored.
- `debugSnapshot()`: `{ said: [{ line, at, ended, cut }], sounds, speaking, lobby }`, for probes.

### The recordings

There are 41 lines (`src/content/audio/duelLines.ts`). Each has two takes, and a line with no take that speech-to-text confirms gets up to two more. The game plays the confirmed take whose names came back closest to their spelling ("Brian Rook" over "Fran Rooke"), then the brisker one. All 41 shipped takes are confirmed; `DUEL_CLIP_LINES` in the manifest records what was heard. Two notes:

- "Kest" came back as "Cast" ("Kest Rel" as "Castrol") in every plain take, so both Kest lines are delivered in capitals, `KEST REL!` and `KEST wins!`. With the caps, three takes of the name line were spelled out letter by letter ("K-E-S-T"), and take 4 came back as the words "KEST Rel" (0.74 s for "KEST", a held syllable).
- "Edda" is heard as "Etta" (American English flaps both d and t). That is accepted as a homophone, written into the generator.

Mastering: both ends trimmed, the loudest momentary (400 ms) loudness set to −13 LUFS, a −1.5 dBTP ceiling, mono 96 kbps. Measured, the shipped momentary maxima are −13.5 to −13.4 LUFS and the true peaks −2.4 dBTP or lower. That sits about 3 dB over the narrator's −17 LUFS integrated, on purpose: shouted calls over the battle score, which ducks under them. The payload is 792 KB in `public/audio/duel/`, fetched only in the Duel.

## Arcade cabinet SFX

There are twelve cues in the lazy `arena` pack (`duel.*` in `sfxCues.ts` and `sfx-prompts.mjs`). They were generated and mastered by the house chain (`gen-sfx.mjs`: QC, trim, loudest-100 ms at −15 LUFS, a −1 dBFS limiter), one take each, because a cabinet's sounds are always the same:

`duel.ui.move` (cursor blip, 0.14 s), `duel.ui.confirm` (0.35 s), `duel.ui.back` (0.28 s), `duel.ui.pause` (0.45 s), `duel.ready` (lock-in slam, 0.8 s), `duel.join` (coin in, 0.86 s), `duel.stage` (whoosh and impact, 0.69 s), `duel.count` (countdown tick, 0.41 s), `duel.fight` (round-start sting, 0.75 s), `duel.ko` (knockout blast, 1.11 s), `duel.game` (match-end sting, 1.4 s) and `duel.results` (the results card's slam, 0.61 s).

The KO blast's first prompt asked for "crunchy distortion", and all five takes failed QC as crushed. The rewrite asks for "clean … plenty of headroom" and passed first time.

There is no separate results *jingle*: the score already plays the 12 s `arena-results` fanfare at the end, so `duel.results` is the card's slam under the winner's name. The Duel's hit sounds (`arena.hit.light`/`heavy`) were left alone, because nothing measurable showed new takes would beat them. The lobby and battle music loops also already existed (above).

## Costs (2026-10-03)

The logged estimates are 7,697 credits of the 25,000 allowance:

- voice, 6,717: speech 4,315 including casting, voice design 423, and speech-to-text 1,979 estimated at 4/s;
- SFX, 980: 24.5 s requested at 40/s, including the five crushed KO takes.

Speech-to-text measured about 0.5 credit/s on the counter (12.8 s cost 6), so its true cost was roughly 250, and the client now estimates 1/s. The account counter rose from 188,065 to 233,264 over the same session, but that includes other workstreams' spend. Logs are `scripts/audio/generation-log.duel-voice.jsonl` and `generation-log.duel-sfx.jsonl`.

## Regenerating

Everything is cached in the shared content-addressed cache, so re-running with an unchanged script costs nothing:

```powershell
$env:ELEVENLABS_API_KEY_FILE='Y:\elevenlabs-api-key.txt'; $env:AUDIO_CACHE_DIR='Y:\Projects\alchemists-descent-worktrees\audio-cache'
$env:AUDIO_BUDGET_CREDITS=<prior logged duel-voice spend + allowance>
node scripts/audio/gen-duel-announcer.mjs --cast --design   # casting: audition/announcer, duel-announcer-cast.json
node scripts/audio/gen-duel-announcer.mjs                   # every line, speech-to-text checked: public/audio/duel, the manifest
$env:AUDIO_LOG_NAME='generation-log.duel-sfx.jsonl'; $env:AUDIO_BUDGET_CREDITS=<prior + allowance>
node scripts/audio/gen-sfx.mjs --only 'duel.*'
npx vitest run tests/duel-audio.test.ts tests/audio-sfx.test.ts tests/narrator.test.ts
node scripts/verify-duel-audio.mjs http://127.0.0.1:5242/
```

To change voices, pass `--voice <key|voice_id>`, or change `ANNOUNCER` in the generator. A new call needs a line in `duelLines.ts`, a moment in `duelCalls.ts`, and a generator run.

`scripts/verify-duel-audio.mjs` drives the real title and lobby with real clicks, after a campaign session the moment before (the QA path). It checks:

- no narrator line after the Duel door;
- no floor bed and no descent cues;
- "Choose your fighter!";
- three names on three fast clicks, each within 400 ms, the first two cut;
- the stage and ready calls with their sounds;
- Three, Two, One, FIGHT within 250 ms of the ticks that changed them, on three equal 40-tick beats;
- an attributed ring-out after a landed finisher ("Ring out!"), an unforced one ("Self-destruct!", "Last stock!"), and GAME plus the winner;
- "Rematch!";
- the cabinet's pause.

Result: `evidence/duel-audio.json`. As with everything above, these are instruments, not ears: whether David's shout is the right arcade voice is the user's call. The audition page lists every call, and the casting, under "Duel announcer".
