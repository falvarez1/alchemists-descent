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

An arcade cabinet's voice, entirely separate from the Docent (library "Daniel"): **David, the ElevenLabs library's "Sports Arena Announcer"** (`DduhIyyKkOosbP8VefhP`), `eleven_v3`, stability 0.5, every call tagged `[shouting]`.

The user's direction, 2026-10-03: "Everything about Duel mode should scream fast-paced, adrenaline-pumping ARCADE." So the shipped calls are read at eleven_v3's top speed (1.2) and mastered dense and loud: see "The recordings".

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

For scale, the narrator Daniel measures 115 Hz and −15.5 dB presence on his Bellows line. All the clips are in `audition/announcer/` (never shipped), and the audition page lists them in rank order. The casting was read at speed 1.0; the shipped calls at 1.2.

### The calls, each tied to a real moment

| Moment (event) | Call | Sound |
| --- | --- | --- |
| The lobby opens (`versusChanged`, from idle or after "Change fighters") | "Choose your fighter!" | — |
| A seat's fighter changes (`versusChanged`) | the full name, e.g. "Rusk Emberjaw!" (10 recorded); a new choice cuts the call in progress | — |
| The stage changes | "The Foundry!" / "The Kiln!" / "The Cistern!" / "The Gallery!" | `duel.stage` |
| A player's seat readies (never the CPU, which is always ready) | "Player one, ready!" / "Player two, ready!" | `duel.ready` |
| A CPU seat becomes a player's device | "Here comes a new challenger!" | `duel.join` (coin) |
| READY starts the match (`versusChanged` lobby → loading: the VS card) | "<P1 full name>! Versus! <P2 full name>!" (the card shows the stage), one call laid on the audio clock at once, so the stage build blocking the thread cannot stretch it; skipping the card (`cutVersus()`) fades it out, and "Three!" cuts any tail | `duel.stage` on "Versus!" |
| Each countdown beat (`stockMatchBeat`, three 40-tick beats: `config/stockRules` `stockCountdownBeat`) | "Three!" "Two!" "One!" (each read inside 0.6 s) | `duel.count` |
| The fight starts (`stockMatchBeat` fighting) | "Fight!" | `duel.fight` |
| An ultimate fires (`stockUltimate`, the 18-tick super freeze) | the ultimate's own name: "PHOENIX DRAFT!", "REDLINE!", "BLOODSENSE!", "DEAD CHIME!", "UPDRAFT!", "LONG NIGHT!", "ROSE WINDOW!", "MIRROR HUNT!", "KILN HEART!", "OVERGROWTH!" | `duel.super` |
| A ring-out (`fighterDown`) while the match goes on | "Ring out!" and "K.O.!" in turn; "Self-destruct!" when nobody's blow sent them out; then "Last stock!" if one is left | `duel.ko` (every ring-out) |
| A shield gives out (`stockShieldBreak`) | "Shield break!" (never over a bigger call) | the existing `arena.shield.break` |
| The match ends (`stockMatchBeat` finished) | "Game!" (or "Time!" when the clock ran out), then "<Name> wins!" (the results card's short name; 10 recorded) or "Draw game!" **exactly 950 ms later** (`RESULT_NAME_MS`), with the HUD's banner | `duel.game`, then `duel.results` with the name |
| A rematch's first countdown beat | "Rematch!" in place of "Three!" | `duel.count` |

**How a call plays.** Every call is laid on the AudioContext's clock the moment it is made, all its lines at once. A line with its own beat (the winner's name at +950 ms) cuts the one before it short rather than waiting.

Only one call plays at a time, on the engine's `voice` bus, under the Voice slider. It ducks the score (`TALK_DUCK`) while talking.

A call cuts the one in progress when it ranks as high: select < ring-out = ultimate < countdown and result. When a call is cut, the lines that had not begun are never said. A lower call is not voiced, but its sound still plays.

The select screen's own calls are dropped once the match is loading. The VS card is not a select-screen call. The select clips (with "Versus!") preload when the lobby opens, and the match clips when it starts.

**The VS card and its hold.** The call takes about 4.2 s at the fast read, so the card holds at least `VS_CARD_HOLD_MS` (4200 ms, `game/LocalVersus.ts`) from READY, and the match waits paused for it. The probe measured the whole call before "Three!", with the countdown starting 4.26 s after READY. A skip (`LocalVersus.skipIntro`: any key, click or pad button) calls `ctx.audio.duel.cutVersus()`, which fades the line in progress over 120 ms; lines that had not begun are never said. A click made while the stage build blocks the page lands when the build lets go, and the call is cut at that point.

**Code.** `audio/duelCalls.ts` decides (pure, tested) and `audio/DuelAnnouncer.ts` plays. The announcer subscribes to events and never polls. Two events were added: `stockMatchBeat` (ArenaSlots, the first tick each countdown number, FIGHT or the end holds) and `stockShieldBreak` (ArenaSlots `blockStockHit`). `stockUltimate` is the team lead's (FighterSystem).

### The screens' API (`ctx.audio.duel`, absent in test contexts)

- `menu('move' | 'confirm' | 'back')`: keyboard or pad navigation sounds. Pointer hovers and clicks already sound (UiSounds), so call it only for non-pointer navigation.
- `announceFighter(id)` / `announceStage(id)`: a cursor previewing a fighter or stage not chosen yet. Choosing calls the name by itself, and a repeat of the name in progress is ignored.
- `announceVersus(p1, p2)`: the VS card. The announcer already makes it on lobby → loading, and a repeat within 3 s is ignored, so screens should not call it.
- `cutVersus()`: the VS card was skipped. The VS call fades out; it does nothing if any other call is playing.
- `debugSnapshot()`: `{ said: [{ line, at, ended, cut }], sounds, speaking, busy, lobby }`, for probes. `at` is the line's time on the page clock, scheduled ahead for a call's later lines.

### The recordings

There are 52 lines (`src/content/audio/duelLines.ts`). Each has two takes, and a line with no take that speech-to-text confirms gets up to two more. The game plays the confirmed take whose names came back closest to their spelling ("Brian Rook" over "Fran Rooke"), then the brisker one. All 52 shipped takes are confirmed; `DUEL_CLIP_LINES` in the manifest records what was heard.

**Delivery:** eleven_v3 at speed 1.2 (accepted by v3: "Choose your fighter!" went from 1.68 s to 1.36 s raw).

**Mastering (`masterCall({ punch: true })`):**
- both ends are trimmed relative to the take's own peak (−30 dB at the head, −36 dB at the tail), so soft lead-ins go;
- a 70 Hz high-pass;
- a fast 4:1 compressor;
- the loudest momentary (400 ms) loudness is set to −12 LUFS;
- a −1.5 dBTP limiter, then mono 96 kbps.

Measured: momentary maxima −12.6 to −12.4 LUFS, true peaks −1.2 dBTP at most (MP3 overshoot). That is about 4–5 dB over the narrator, and the score ducks under it. Calls that must fit a 40-tick beat (`maxSeconds` 0.6: the three counts and "Rematch!") are sped up with `atempo` (pitch kept, at most 1.4×) when they run over. "Three!" took 1.15× to 0.61 s, "Two!" is 0.49 s, "One!" 0.57 s, and "Rematch!" took 1.4× to 0.69 s.

Pronunciation notes. The voice spells out any name written in capitals. The user heard "K. E. S. T." from the old `KEST REL!` and `KEST wins!` deliveries, which speech-to-text had written as "KEST". So:
- No delivery writes a name in capitals; a test holds that.
- The generator refuses any take with more voiced bursts (`voice-metrics.mjs` `bursts`: syllable nuclei under 900 Hz) than the line has syllables, plus 2. A spelled name is one burst a letter.
- Among confirmed takes, the one whose burst count is closest to the line's syllables wins.

**Kest Rel (2026-10-04).** For scale, "Sable" in "Sable Fen!" measures 520 ms with 2 bursts, and "Nox" (heard "Knox") 420–660 ms with 1–2 bursts. The candidates:

| Delivery | Model | Heard | Name (ms) | Name bursts | Verdict |
| --- | --- | --- | --- | --- | --- |
| `KEST REL!` (shipped before) | v3 | "KEST Rel" | 1200 | 5 | spelled, which is what the user heard |
| `Kesst Rell!` ×2 | v3 | "Castro", "Castrell" | 1020 | 2 | the wrong vowel |
| `Kehst Rel!` ×2 | v3 | "Kestrel" ×2 | 1080 / 1280 (whole) | 2 / 3 | right |
| `Kest-Rel!` ×2 | v3 | "Cast roll", "Castrell" | 680–1000 | 2–3 | the wrong vowel |
| **`Kest Rel!` ×2** | v3 | **"Kestrel" ×2** | 1320 / 1300 (whole) | **2** / 3 | **shipped, take 2: the plain spelling** |
| `Kest, Rel!` ×2 | v3 | "Cast, row" | 520–540 | 1 | the wrong vowel |
| `Kesst wins!`, `Kehst wins!`, `Kest wins!` (×2 each; also at stability 1.0 and `[excited]`) | v3 | "Cast wins" every time | 500–740 | 1–3 | the wrong vowel |
| `Kessst wins!` ×2 | v3 | "Undercast wins", "The cast wins" | 680–720 | 2 | no |
| `Kest... wins!` ×2 | v3 | "Cast wins" | 1340–1380 | 2–3 | no |
| `<phoneme ph="K EH1 S T">Kest</phoneme> wins!` ×2 | eleven_flash_v2 | "Kes wins", "Guess wins" | 340 | 1–2 | closest vowel, but not the shouting voice |
| the same phoneme tag ×2 | eleven_turbo_v2 | "Cast wins", "The guest wins" | 320–360 | 1–2 | no |
| **`Kest Rel wins!` ×2** | v3 | **"Kestrel wins" ×2** | 780 (take 2) | 3 | **shipped, take 2** |

Shouted on its own, "Kest" opens to "Cast" in every delivery and model tried. Said together, "Kest Rel" comes out as one word with the right vowel: "Kestrel", which is the name. So the winner's call for Kest uses the full name, "Kest Rel wins!" (`WINS_TEXT` in `duelLines.ts`). The HUD banner still shows the short "Kest wins". The ultimate's call ("Updraft!") never says the name.

**Rusk.** "Rusk wins!" lost its K: speech-to-text heard "Russ wins" in both takes, and the closure before the K's release was only 50 ms (`voice-metrics.mjs` `stopGap`; "Rusk Emberjaw!" measures 105 ms, "Brann wins!" 0). It is now delivered as `Rusk! Wins!`, which comes back "Rusk wins" in both takes with a 130–140 ms closure. `Russk wins!` gave "Rusk wins" and "Rose Quinns" (a 45 ms closure).

**The others:**
- **Edda:** heard as "Etta" (American English flaps both d and t). It is accepted as a homophone.
- **Kiln Heart:** heard as "Kilnhart" (heart and hart sound alike). It is accepted as a compound within 85% of its spelling.
- **Spelled-out letters never count.** A transcript of single letters ("K-E-S-T") is never accepted as the word.

The new tie-break moved 11 lines to their other confirmed take: Ilyra and Nox's names, The Gallery, "Player one, ready!", the challenger, K.O., Ring out, Self-destruct, and the Phoenix Draft and Redline calls. Each now has fewer stray bursts.

The payload is 936 KB in `public/audio/duel/`, fetched only in the Duel.

## LAN Duel (host and guest)

Checked on 5242 with a host page and a guest page (`scripts/verify-duel-lan.mjs`'s setup), 2026-10-04.

**The narrator.** `inArena` now covers the LAN session (`ctx.duel.active`). The LAN screen before anyone hosts is covered by `lanLobbyShown()`: `Play over LAN` closes the local lobby, and before this the title tagline was read over the LAN screen. Measured after the fix, neither page says a line.

**The host** runs the match, so its events fire and its announcer calls everything: the countdown, FIGHT, the ultimate, the ring-outs, GAME and the winner.

**The guest is a replica and does not tick ArenaSlots or FighterSystem**, so it never sees `stockMatchBeat`, `fighterDown`, `stockUltimate` or `stockShieldBreak` (measured: 0 of each).

- **No announcer voice on the guest.** Its voice is streamed audio, not a replicated sound.
- **No visuals hung on those events either.** The KO burst and the super cut-in depend on them.
- **The guest still hears the host's cabinet SFX.** The host's sampled sounds are recorded into each snapshot's `sounds`, and the guest replays them. That replay drops options, so the winner slam's 950 ms delay is lost and it plays with GAME. Sounds the host made before the guest's audio was ready are missed: one run lost the countdown and FIGHT.
- **No select-screen calls in the LAN lobby on either side.** The LAN lobby does not run on `versusChanged`, so there are no fighter names and no VS card. "Choose your fighter!" is heard only from the local lobby, before switching to LAN.

**What the guest would need** (not built; the network code is not this workstream's):

- **Record the moments.** The snapshot carries the match moments the way it already carries `sounds`: the host records `stockMatchBeat`, `fighterDown`, `stockUltimate` and `stockShieldBreak` as they are emitted, and `DuelRuntime.receive` re-emits them on the replica, in order. The announcer, the KO burst and the cut-in then work unchanged on the guest, one snapshot late.
- **Stop the doubled sounds.** Leave the cabinet's own `duel.*` sounds out of the replicated `sounds`, because the guest's announcer makes them from the re-emitted moments, with their timing. Otherwise they double.
- **Derive, as a fallback.** Diffing the replicated match view would also work (countdown, state, stocks, `bout.downs`, `ultimate.usedAt`), but its timing would ride the snapshot rate.
- **The LAN lobby.** It could call `ctx.audio.duel.announceFighter(id)` when a seat chooses.

## Arcade cabinet SFX

There are thirteen cues in the lazy `arena` pack (`duel.*` in `sfxCues.ts` and `sfx-prompts.mjs`). They are generated and mastered by the house chain (`gen-sfx.mjs`: QC, trim, loudest-100 ms at −15 LUFS, a −1 dBFS limiter), one take each, because a cabinet's sounds are always the same.

For the arcade direction every one is marked `fast`. `gen-sfx.mjs` refuses a `fast` take whose loudest 10 ms comes more than 40 ms after its onset, and buys the next variant. The prompts now open with "instant hard transient at full level from the very first millisecond, no fade-in, no build-up, no whoosh before it", and the tails are shorter. `scripts/audio/sfx-attack.mjs` measures attack times for any file.

| Cue | Use | Length (s) | Attack (ms) | Before |
| --- | --- | --- | --- | --- |
| `duel.ui.move` | cursor step (hover; `data-sfx="move"`; `menu('move')`) | 0.10 | 0 | 70 ms, 0.14 s |
| `duel.ui.confirm` | confirm | 0.35 | 0 | — |
| `duel.ui.back` | back | 0.28 | 0 | — |
| `duel.ui.pause` | the pause menu opens | 0.30 | 20 | 220 ms |
| `duel.ready` | a seat locks in | 0.55 | 30 | 100 ms |
| `duel.join` | coin in: a challenger | 0.70 | 0 | 210 ms |
| `duel.stage` | stage chosen; "Versus!" | 0.55 | 30 | 110 ms |
| `duel.count` | each countdown beat | 0.41 | 0 | — |
| `duel.fight` | FIGHT | 0.75 | 10 | 50 ms |
| `duel.super` | an ultimate fires (new) | 0.57 | 0 | — |
| `duel.ko` | every ring-out | 0.57 | 0 | 410 ms, 1.11 s |
| `duel.game` | GAME / TIME | 1.40 | 30 | — |
| `duel.results` | the winner banner's slam | 0.47 | 30 | 270 ms |

Generation notes:
- The super sting took six tries: a "whoosh-hit with a rising tail" peaks on the tail. The prompt now makes the impact the loudest moment.
- The first KO prompt's "crunchy distortion" was crushed on every take, so the KO prompt asks for "crunchy … plenty of headroom".

There is no separate results *jingle*: the score already plays the 12 s `arena-results` fanfare at the end, so `duel.results` is the banner's slam.

**Heavy hits.** Two of the three `arena.hit.heavy` takes reached their peak 120 and 80 ms after the blow, so the biggest hits landed late. They were swapped for re-rolls of the same prompt (variants 5 and 8, 20 ms each) with `gen-arena-sfx.mjs --only arena.hit.heavy --takes 1,3`, using the new `v` variant list in `sfx-prompts.mjs`. Take 2 (20 ms) is unchanged.

`arena.hit.light` (10–20 ms) was already immediate and is unchanged. Do not run `gen-arena-sfx.mjs` without `--only`: 20 of the 23 shipped arena takes' paid responses live only in the arena-stock-matches worktree's local cache, so a full run against the shared cache would re-buy and replace them.

No new music was made. The battle loop is already 156 BPM, and re-cutting a loop needs the beat analysis that set its seams, which we cannot check by ear.

## Costs (2026-10-03 to 2026-10-04)

The logged estimates come to 14,132 credits of the 25,000 allowance:

- voice, 12,406: speech 9,274 (the first recording, its casting, the fast re-recording, and the Kest and Rusk candidates), voice design 423, and speech-to-text 2,709;
- SFX, 1,492: requested seconds at 40/s, including QC rejects;
- heavy-hit re-rolls, 234, logged in `generation-log.arena-sfx.jsonl`.

The speech-to-text estimate was 4/s at first and is now 1/s. It measured about 0.5 credit/s on the counter, and 975 s were transcribed, so its true cost is about 490. That puts the real total at about 11,900. The account counter rose by about 45k over the session, but that includes other workstreams. Logs are `scripts/audio/generation-log.duel-voice.jsonl` and `generation-log.duel-sfx.jsonl`.

## Regenerating

Everything is cached in the shared content-addressed cache, so re-running with an unchanged script costs nothing. A re-master changes the bytes, though, and each re-master's speech-to-text check costs about 0.5 credit per second of audio:

```powershell
$env:ELEVENLABS_API_KEY_FILE='Y:\elevenlabs-api-key.txt'; $env:AUDIO_CACHE_DIR='Y:\Projects\alchemists-descent-worktrees\audio-cache'
$env:AUDIO_BUDGET_CREDITS=<prior logged duel-voice spend + allowance>
node scripts/audio/gen-duel-announcer.mjs --cast --design   # casting: audition/announcer, duel-announcer-cast.json
node scripts/audio/gen-duel-announcer.mjs                   # every line, speech-to-text checked: public/audio/duel, the manifest
$env:AUDIO_LOG_NAME='generation-log.duel-sfx.jsonl'; $env:AUDIO_BUDGET_CREDITS=<prior + allowance>
node scripts/audio/gen-sfx.mjs --only 'duel.*'
node scripts/audio/sfx-attack.mjs src/assets/audio/sfx/arena/duel.*.mp3
npx vitest run tests/duel-audio.test.ts tests/audio-sfx.test.ts tests/narrator.test.ts tests/arena-audio.test.ts
node scripts/verify-duel-audio.mjs http://127.0.0.1:5242/
```

- **Changing voices:** pass `--voice <key|voice_id>`, or change `ANNOUNCER` in the generator.
- **A new call:** add a line in `duelLines.ts` and a moment in `duelCalls.ts`, then run the generator.
- **After adding new SFX files:** touch `src/content/audio/sfxManifest.ts`. A running dev server can keep its old `import.meta.glob` and silently play the procedural fallback.

### The probe

`scripts/verify-duel-audio.mjs` drives the real title and lobby with real clicks, after a campaign session the moment before (the QA path). It checks:

- no narrator line after the Duel door;
- no floor bed and no descent cues;
- "Choose your fighter!";
- three names on three fast clicks, each within 400 ms, the first two cut;
- the stage and ready calls with their sounds;
- the whole VS call in order, its first name within 10 ms of READY, before "Three!";
- Three, Two, One, FIGHT within 10 ms of the ticks that changed them, on three equal 40-tick beats;
- an ultimate's name with the super sting;
- an attributed ring-out after a landed finisher ("Ring out!");
- an unforced one ("Self-destruct!", "Last stock!");
- GAME, then the winner's name 950 ms later (measured exactly 950);
- "Rematch!";
- the cabinet's pause;
- a skipped VS card cut where it stood.

That is 24 checks. Result: `evidence/duel-audio.json`. As with everything above, these are instruments, not ears: whether the fast shouted reads hit the arcade feel, and the Kest and Rusk names in particular, is the user's call. The audition page lists every call, and the casting, under "Duel announcer".
