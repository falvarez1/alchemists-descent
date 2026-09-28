# AUDIO — the sound bible

Every sound Breathing Works makes: what it should sound like, where it comes
from, how it is mixed and loaded, and how to change it. Music and narration
are a separate workstream (their own buses and director); this document is
the sound effects and ambience.

- **447 cues, 838 takes, 7.7 MB** of mastered MP3 (`src/assets/audio/`),
  generated with ElevenLabs text-to-sound and mastered offline.
- **Nothing is fetched before the first gesture.** Then the core packs load in
  about two seconds; each floor's creatures and bed load with the floor; the
  Sanctum prefetches the next floor.
- **Fail-open:** until a cue's sample has decoded, the procedural voice it
  replaced plays instead. Never silence, never an error.

## 1. The palette

The Works is a living Victorian refinery — bellows for lungs, rot gardens for
a gut, cisterns for veins, a kiln for a heart — and it sounds like the things
it is built from:

| material | where you hear it | how it should sound |
| --- | --- | --- |
| **wet slate** | footsteps, stone bodies, the Stone Maw, the caves | close, dry, a little grit; no hall reverb on one-shots |
| **worn copper** | pipes, the Breathing Chamber, generators, the kiln | warm, resonant, slightly detuned; steam hiss is copper's breath |
| **brass** | the interface, levers, bells, the Tea Engine | small, precise, satisfying — a switch, a counter bell, a ratchet |
| **glass** | phials, flasks, ice, vitrify, the alchemy chime | bright and clean; shards tinkle, never shriek |
| **ivory chitin** | the Weaver and its kin | dry clicks and stridulation — never wet |

House rules:

- **If the grid can't explain it, it doesn't sound.** Material beds are driven
  by the cells on screen (see §3); a creature's voice is its body; a rigid body
  clanks in its own material.
- **Dry Victorian-industrial wit** over grim: a pneumatic tube delivers the
  objective, a steam valve closes when you pause, the Tea Engine's finale is a
  kettle whistle and a bell. Understatement, not jump scares.
- **No music in the effects**, except the deliberately musical stingers (the
  alchemy chime, phial fill, victory/fallen, the ledger's chords).
- **Wordless voices.** Creatures and the alchemist grunt, gasp and chitter;
  they never speak.
- **Placement is part of the sound.** Everything in the world is panned by its
  bearing from the camera centre and attenuated with distance
  (`audio/mix.ts placeSound`); far sounds lose their top end.

## 2. How it is built

```
src/content/audio/sfxCues.ts      THE catalog: id → pack, family, runtime overrides
src/content/audio/sfxCatalog.ts   the catalog resolved for the runtime (family defaults folded in), packs
src/content/audio/sfxManifest.ts  files (import.meta.glob ?url&no-inline) + AUDITION_ENTRIES — a LAZY chunk
src/assets/audio/sfx/<pack>/<id>-<n>.mp3        one-shots and sustained loops
src/assets/audio/ambience/<pack>/<id>-<n>.mp3   floor beds and the Breathing Chamber
src/audio/AudioEngine.ts   the procedural engine: mix graph, placement, trace — and the fallback voices
src/audio/SfxEngine.ts     SfxAudioEngine extends it: every AudioApi preset plays samples; sfx(), creature()
src/audio/SampleBank.ts    lazy fetch + decode per pack, released when unneeded
src/audio/LoopVoice.ts     crossfaded loops (MP3 is not gapless)
src/audio/paramRamps.ts    overlap-proof gain automation (equal-power segments, loop-pass envelopes)
src/audio/failSafe.ts      no audio error reaches the game: failSafe(), listen(), audioFault()
src/audio/sfxFallbacks.ts  the original procedural recipes, per cue
src/audio/AudioDirector.ts which packs and which bed, per floor; Sanctum prefetch; release
src/audio/UiSounds.ts      hover/click on every button, overlay open/close, run-event cues
src/audio/HabitatAudio.ts  stride layer, creature idles and hops, projectile travel, the material scanner,
                           moths at the lantern, a stomp's running shockwaves
src/audio/EventCues.ts     announced moments → cues: the light devices, organisms, boss-move tells (§3)
src/audio/Stingers.ts      run events → stingers (unchanged; the engine samples them)
scripts/audio/sfx-prompts.mjs  one prompt per cue (+ duration, takes, influence)
scripts/audio/gen-sfx.mjs      buy → QC → master → encode; take choice in sfx-takes.json
audition.html + src/app/audition.ts   dev-only audition page
```

**Calling a sound.** Gameplay never builds audio: it names a cue.

```ts
ctx.audio.sfx('mech.plate', m.x, m.y);            // placed at the cue's range
this.voice(e, () => ctx.audio.sfx('creature.golem.jet'));   // inside at(): the creature's placement
ctx.audio.creature(e.kind, 'alert');              // the kind's own voice, generic fallback
ctx.audio.sfx('spell.vitriol.loop');              // a loop cue SUSTAINS while called, fades when not
```

The older presets (`boom`, `zap`, `footstep`, `landThud`, `deathCry`…) remain
and are sampled too — `boom(size)` picks small/medium/large and scales within
the tier, `coin(streak)` climbs a semitone per coin, `chirr(dur, pitch)` plays
the Weaver's chirr at `pitch`, `landThud(k)` chooses soft or hard. Raw
`tone()`/`noiseBurst()` are the fallback's primitives; a test forbids them
outside `src/audio`.

**Per voice** (SfxEngine): a random take that is never the one just played,
±1.2 dB and a per-family pitch spread (footsteps ±110 cents, UI ±20), a per-cue
cooldown (retriggers inside it are dropped) and instance cap (the oldest is
stolen with a 30 ms fade), and a **40-voice pool**: when full, a newcomer
steals the lowest-ranked oldest voice that does not outrank it, and is
dropped if every voice does (explosions and stingers rank highest, critters
lowest). The existing glue compressor → limiter → soft clip still sits on the
master: eighty sampled blasts at once peak at 0.60.

**Loops** (`LoopVoice`): each pass starts before the previous one ends and the
two cross with equal-power fades (0.35 s for sustained sounds, 2.5 s for
beds). A loop cue played through `sfx()` fades in on the first call, follows
level/pan/muffle on each call, and fades out ~0.2 s after the calls stop
(`keepAliveMs`). Beds crossfade when the floor changes. Passes are scheduled
~1.2 s ahead by a 200 ms timer; if the timer could not run while the audio
clock did (a blocked main thread — a probe stepping hundreds of ticks in one
task — or a throttled hidden tab), the schedule resyncs to "now" and fades
back in rather than scheduling in the past.

**Fail-safe** (`audio/failSafe.ts`). Audio is reached from inside the game
tick, so no audio error may escape into it: `sfx()`, `creature()`,
`stinger()`, the sampled presets' fallbacks, `HabitatAudio.update`, every
audio event listener (`listen()`), and the score's and narrator's timers
catch, report once to the console (`[audio] …`) and carry on without that
sound. Gain automation never uses `setValueCurveAtTime`: Chromium clamps a
curve's start to the live clock, so two curves computed from a stale clock
reading collide and throw ("overlaps"). Fades are chains of short linear
segments instead (`audio/paramRamps.ts`: `equalPowerRamp` for the score,
`passEnvelope` for loop passes), which cannot overlap anything. Tests:
`tests/audio-safety.test.ts` drives LoopVoice, the MusicDirector and a
`playerDied` emit against a fake AudioParam that enforces Chromium's rules.

## 3. The world's own voices (HabitatAudio)

- **Material scanner.** Every 8 ticks it samples every 3rd cell of the view
  and counts fire/ember, lava, *flowing* water (water that moved this
  substep), acid, steam, live charge and fire eating gunpowder (a fuse). Each
  material drives its loop at `√(count / full)` (a torch flickers, a burning
  room roars, nothing runs away), panned to the centroid. Put lava on screen
  and you hear it; freeze the stream and it goes quiet.
- **Stride layer.** Every ~13 cells walked: the satchel's phials clink; on an
  iron grate the boots ring; waist-deep, the water sloshes.
- **Projectiles in flight** carry loops (bomb fuse, singularity — swelling with
  its radius — wisp, meteor, hostile fireball), the five nearest at once.
- **Creatures** mutter when unbothered and in earshot (every 4–11 s each),
  Weavers and Rillbacks sound their movement, slimes announce each hop.
- **The Breathing Chamber** draws a long breath at the start of the inhale
  (placed at the chamber) and exhales with the jets; the jets roar as a loop
  while the Works exhale.
- **Moths at the lantern.** Three or more moths (or ash moths) circling the
  wand tip flutter as a soft papery loop at the swarm's centroid, swelling
  with its size; hood the lantern and the swarm — and the sound — drifts off.
- **A stomp's shockwaves** each carry a gritty rumble that runs with the ridge
  along the real floor and thins as it dies: the jump can be timed by ear.
- **A photocell under a held beam** hums, swelling as it fills; it latches
  with a brass click and a glass chime.
- **Fire in the brush.** The scanner also counts flame within two cells of a
  leaf, a vine, a pod or living wood (and a trunk smouldering in place). The
  moment a thicket, a fallen crown or a bed of grass catches is a dry
  whoomph (`flora.catch`; in the Kiln its blooms flare, `flora.firelily.flare`),
  once per fire — it re-arms after a second with none. Then a brushy crackle
  (`flora.burn.loop`) rides over the fire's own roar while plants burn, held
  a moment past the last leaf (leaves go up in a flash; the scan only looks
  every 8 ticks). When only the bramble wood is left, the bonfire loop alone
  carries it.
- **Brushing past plants.** Every 14 cells walked, and never closer than
  a third of a second, the cells his body is pushing through decide the
  sweep: under water, kelp; thin stems standing in the Cisterns, reeds;
  anything else leafy (grass tufts, fern beds, fire-lilies, fallen crowns,
  litter), a soft sweep of blades. Level follows how much foliage and how
  fast. A meadow is a hush, not a drum.

### Announced moments (EventCues)

The light devices, the organisms, the bosses and the plants announce what
they do on the event bus and never touch audio; `audio/EventCues.ts` is the one table that
decides how each moment sounds, placed at the event's position (the cue's own
range) and held in check by each cue's cooldown and instance cap, so a floor of
isopods curling in one gust is one clatter, not eighteen.

| event | what you hear |
| --- | --- |
| `lanternHooded` | the brass hood dropping (a click, the flame's last breath) or flipping open (a click, a warm whoomph); a floor change or a death lifts the hood silently (`quiet`) |
| `darkZoneEntered` | a low hush as the air goes still — once per entry, unplaced |
| `eyeshineCaught` | a tiny glassy glint where the eyes flash back |
| `lightDevice` | a photocell's latch and chime; a lumen bloom's glass petals unfurling, or folding shut |
| `organism` | snapjaw snap (and the swallow a beat later), puffer ripe/burst, glow-worm lower/retract/snare, leech latch/drink/shed, isopod curl, ash moth flare, a fish school bolting, a bat roost scattering, an imp snapping an ash moth |
| `bossMove` | every tell as the move commits: the Colossus heaving its fists up (slam, stomp), scooping melt (throw), grinding its vents open, its phase roar, the kneel after a thermal-shock crack, the long groan as it goes down; the Leviathan's lure going dark before a lunge or a dive, the coil before a thrash |
| `floraMoment` | a tree's whole fall, in order: a notched trunk straining (`creak`, louder when nearly through), the cut going through (`crack`, by the stand's size), the long groan of the hold and lean (`lean`), the hinge fibres tearing (`snap` ≥ 0.6) or a sapling snapping at the boot (`snap` < 0.6), the crown rushing down (`whoosh`), the canopy thrown onto the ground (`shed`), the log rolling to rest (`settle`); leaves shaken by a kick (`rustle`), pods letting go (`podDrop`); a thirsty seed drinking (`soak`), sprouting (`sprout`), its root ladder knocking up rung by rung over a creaking growth loop (`rung`) and opening its crown (`bloom`) |
| `telekinesis` | the wand's grip (combat/Telekinesis): a taut brass twang and tug as it takes hold, the thread's steady hum while a body hangs on it (louder for a heavier one, on the body), a slack sigh as it lets go, a whip-crack and rush of air for a hurl (lower for a heavy one), a sputtering fizzle when the grip fails, a creaking groan when the wand strains at something far too heavy (a nudge); a crate keeps its own lift/throw/drop sounds and shares only the hum |
| `corpseMoment` | the dead as mass (creatures/corpseWorld): a thud, light or heavy by the body (lighter bodies ring higher); a body bowled into a creature; a belly-flop into a pool; a carcass catching fire, or put out (the material sizzle); lava taking it; acid eating it; frost racing over it; a frozen carcass shattering; the galvanic twitch |
| `treeLanded` | the fall itself, in the floor's own wood (the biome names the species world/floraPass planted): pale birch on the Bellows, a giant mushroom's stem in the Rot Gardens, a waterlogged mangrove in the Cisterns, charred ember-bark in the Kiln; a bounce after the first strike is the same wood, lighter |

The flora call sites stay silent: the events carry the sound (a felled tree's
rigid body skips the generic crate knock, and a glowseed pod plucked from the
ground and a trunk flexing under the boot, which have no event, call
`flora.glowseed` and `flora.creak` directly). The blows themselves sound at
the tick they land, in the boss and organism
modules (a slam's stone-on-stone over the blast, a stomp's thud, the vent's
roar, the plates bursting off, the rubble; the tail's sheet of water, the
surge, the shock; a snapjaw's tell, chew and death, an ember beetle's crunch
and pop, a beached fish's flop). Idle-life fidgets and staggers stay silent on
purpose: the hit and the creature's own idle mutter already carry them.

The score reacts too (audio/MusicDirector, pure rules in musicRules): when a
boss breaks into a new phase the music drops to 0.42 for 1.5 s under the roar
and swells back, and in a designed deep-dark zone a floor's calm cue thins to
0.62 (never a hunt or a boss theme).

## 4. The mix

Files are all mastered to one loudness (K-weighted: the loudest 100 ms of a
one-shot at −15 LUFS, loops −21, beds −24; transients never limited more than
3 dB), so the per-family gain in `sfxCues.ts` IS the mix. It was calibrated
(`scripts/calibrate-audio-sfx.mjs`) by rendering each cue through the real
master chain against these targets (peak at the listener, default volumes):

| family | bus | gain | design target |
| --- | --- | --- | --- |
| explosion | fx | 1.12 | small 0.24 · medium 0.30 · large 0.40 (limited) |
| spell | fx | 0.44 | cast ≈ 0.08, lightning 0.25, implosion 0.21 |
| boss | voices | 0.80 | a roar sits just under a blast |
| creature | voices | 0.21 | alert 0.07, chatter 0.05, steps 0.03 — readable at distance |
| impact / material | fx | 0.38 / 0.30 | hits 0.07–0.13, splashes 0.04–0.075 |
| mechanism / tea | fx | 0.35 / 0.36 | lever 0.07, door and groan 0.10 |
| player | fx | 0.24 | hurt 0.13, kick 0.09, jump 0.045 |
| step | fx | 0.07 | footsteps 0.025–0.03: felt, not heard |
| pickup | ui | 0.25 | 0.06–0.09 |
| ui | ui | 0.14 | click 0.035, hover 0.015: quiet |
| stinger | ui | 0.48 | chime 0.12 |
| critter | ambience | 0.10 | 0.015 — the caves' life, under everything |
| loop / bed | fx·ambience / ambience | 0.34 / 0.50 | a stream ≈ a spark cast; a bed ≈ 9 dB under it |

The buses, sliders, duck and limiter are `audio/mix.ts` (unchanged by this
layer). To re-tune: edit a target in the calibration script, run it with
`--write` (dev server up), then `npm run verify:audio-sfx`.

## 5. Loading and memory

| when | what | size |
| --- | --- | --- |
| page load, title screen | no audio and no URL table: only the engine code (+14 KB gzipped of JS; same 14 requests as before this layer) | 0 audio bytes |
| first gesture | the lazy `sfxManifest` chunk (the URL table, 64 KB) | |
| first gesture + 0.3 s | `ui`, `player`, `spells`, `world` (3 lanes, ~2 s) | 3.1 MB MP3 → ~42 MB PCM |
| a floor loads | its bed (`amb-dN`), a pack per creature kind living there + its boss, a pack per organism kind in its census (`org-<kind>`, game/organisms FLOOR_FAUNA, plus any organism actually present), `flora` (every floor grows plants), `tea` on floor 1 | 0.7–1.5 MB MP3 |
| the Sanctum opens | the next floor's bed, roster and organisms (prefetch) | |
| 30 s after a pack is last needed | released | |

Decoded PCM is the cost of sampled audio, so buffers decode at the rate their
family needs: 44.1 kHz for the sparkly ones (UI, pickups, spells, glass,
sizzle), 32 kHz for bodies (the MP3s are band-limited near 15 kHz, so nothing
audible is lost), 24 kHz for the long stereo beds. Measured
(`verify:audio-sfx`): ~50 MB for the core packs alone, ~66 MB on floor 1
(core + bed + Tea Engine + creatures + plants), ~64 MB steady on floor 4 (its
organisms and plants included), 101 MB peak while racing through all four
floors before the releases land.

## 6. Workflow

**Generate / re-master** (Node 23+; the key never leaves the machine and
nothing client-side talks to ElevenLabs — `tests/audio-bundle.test.ts` scans
the production bundle for `sk_` tokens and `api.elevenlabs.io`):

```bash
ELEVENLABS_API_KEY_FILE='Y:\elevenlabs-api-key.txt' AUDIO_CACHE_DIR='Y:\Projects\alchemists-descent-worktrees\audio-cache' \
AUDIO_LOG_NAME='generation-log.sfx.jsonl' AUDIO_BUDGET_CREDITS=80000 \
node scripts/audio/gen-sfx.mjs [--only id,prefix.*,/regex/] [--dry] [--offline]
```

Sound effects cost 40 credits per requested second (minimum 0.5 s). Every
paid response is cached content-addressed, so changing the mastering chain
and re-running is free (`--offline` never calls the API). The QC refuses weak
takes (peak under −32 dBFS: mostly noise floor), crushed takes (>8 % of
samples at full scale — ElevenLabs masters hot, peaks of ~1.4 are normal),
late onsets, and loops whose quarters differ by >15 dB; a refused slot is
refilled from takes already paid for (best score first) before a new variant
is bought. Spend so far: **43,320 credits** for 948 generations (telekinesis
and the physical corpses were 1,580 of them; the wave-2
pass — light, organisms, the rebuilt bosses — was 5,112 of them; the flora
pack 3,080).

**The story's voices** (`gen-voice.mjs`, the same catalog as the narrator):
every story line carries a speaker. The Docent is the narrator (Daniel) and
keys by text alone; **Pell** (ElevenLabs "Stephen": young, warm, a little
anxious, crisp) and **Matron Ash** ("Beatrice", mastered through a soft
three-voice chorus, `ASH_CHORUS`) key by `speaker: text` (`speakerKey`).
Casting is `node scripts/audio/cast-voices.mjs`: each candidate reads the
same lines, scored for pitch, pace and sibilance (frames where 3.5–12 kHz
outweighs the band below; Daniel measures 5.8/s, the chosen Pell 3.4–3.9/s)
in `scripts/audio/cast-report.json`, takes in `audition/voices/cast-*.mp3`.
A story line the voice rushes gets a second take (`RETAKE`: the manifest
plays the take nearest 13 characters a second) or its own reading
(`STORY_SAY` in `voice-lines.mjs`). Generators budget against ALL logged
spend of their kind (`LedgerBudget`), so `AUDIO_BUDGET_CREDITS` is prior
spend plus the allowance.

**Audition** (dev server running): open `/audition.html`. Every cue from every
`src/content/audio/*Manifest.ts` that exports `AUDITION_ENTRIES` (the score
workstream's music and voice too), grouped, with its prompt and every take;
play, loop, "at mix level"; tick **reject** on bad takes (kept in the
browser), **Export rejects**, save as `scripts/audio/sfx-rejects.json`, re-run
the generator: exactly those takes are replaced (spare paid takes first), the
rejected variants are never used again, and the rejects file is consumed.

**Verify:** `npx vitest run tests/audio-sfx.test.ts tests/audio-event-cues.test.ts tests/audio-bundle.test.ts`,
then with the dev server up `npm run verify:audio-sfx` (sampled layer),
`npm run verify:audio` (buses, sliders, limiter, stingers) and
`npm run verify:audio-life -- <url>` (the wave-2 moments: every announced
event plays its own cue, placed, sampled; the L key, spawned organisms, a
photocell, the Colossus's stomp, phases and long death, the Leviathan's
thrash and surge, each floor's organism packs, the score's phase dip and dark
thinning) and `npm run verify:audio-flora -- <url>` (every plant moment's own
cue; in the Rot Gardens a tree felled by the dig beam, a pod tree kicked, the
seed bed watered, the thicket lit, leaves walked through; a death with the
AudioContext suspended running its whole flow to the respawn; a 6.5 s
main-thread block with loops sustained).

**Add a cue:** add it to `sfxCues.ts` (pack, family, overrides) and
`sfx-prompts.mjs` (prompt, duration, takes), run the generator with
`--only <id>`, call `ctx.audio.sfx('<id>')` (or give it a fallback recipe in
`sfxFallbacks.ts` if it replaces an old sound), audition, and regenerate this
table with `node scripts/audio/sfx-doc.mjs`. A moment the game already
announces on the bus (an organism's action, a boss move's tell, a light
device) gets its cue in `audio/EventCues.ts`'s tables, not at the call site;
a blow that lands on a particular tick is called where it lands. A new
organism kind's cues go in its own `org-<kind>` pack (the director loads it
with the floors whose census lists it).

## 7. Coverage

| pack | cues | takes | what |
| --- | --- | --- | --- |
| ui | 31 | 65 | hover, click, back, ledger open/close, pause/resume valve, toast, objective tube, hint, grimoire quill, card reveal/choose/pick/slot, bench drawer, coins, tally, learn, curtain, phial refill/drain, run over, summary chords; stingers: alchemy, phial crack/fill, victory, fallen, shutter |
| player | 55 | 120 | the lantern's brass hood (down/up), steps ×5 surfaces, gear, wade, crawl, jump, landings, skid, grab, pull-up, cramped, kick, dive, slam, stomp, hurt, death, corpse wand + knell, heartbeat, sputter, levitation loop, vine, teleport, heal, drink, communion, staff, glowseed, leg club ×3; flask siphon/pour loops, throw, shatter, dry; wand swap/dry; pickups ×9 (gold, coin, heart, chest, potion, key, the brass bell…) |
| spells | 32 | 59 | per card family: spark cast/impact, bomb cast + fuse loop, lightning, flame ignite + loop, dig loop, warp, singularity loop + implosion, vitriol/cryo/aqua loops, frost shard, ice lance, ice impact, freeze, wisp cast + loop, meteor cast + loop, conjure, vitrify, ember storm, three crits, two charge payoffs, the Trickshot whip and shell crack |
| world | 94 | 179 | the light wave (the deep dark's hush, eyeshine, photocell hum + latch, lumen bloom open/furl/petal), fish school scatter + flop, moth swarm loop, explosions ×3, materials (zap, shatter, steam, sizzle, ignite, squelch, bubble, splashes, drip, hollow knock), material loops ×7 (fire, lava, water, acid, steam, electric, fuse), rigid bodies per material (impact, smash) + grab/lift/throw/drop/rip/tear/bash/burn-out, portal, gong, waystone, 20 mechanisms, critters, generic creature voices, hostile fireball loop, the wand's grip (taking hold, the brass thread's hum, letting go, the whip-crack hurl, a failing fizzle, a strain at something too heavy) and the dead as mass (light and heavy thuds, a body bowled into a creature, a belly-flop, catching fire, lava taking it, acid eating it, frost racing over it, a frozen shatter, a galvanic twitch) |
| tea | 15 | 16 | striker, percussion cap, fault, knocker, ratchet, pendulum, boulder, dominoes, spring, duck, marble, generator, magnet, counterweight, tea served |
| creature-× (16) | 129 | 253 | every kind: alert, hurt, death, plus its own idle / movement / wind-up / attack / specials (a bat roost scattering); the Leviathan and the Colossus with boss-sized idles, alerts, attacks and deaths, and every move of the rebuilt fights: the Colossus's heave, slam, stomp + running shockwave loop, melt scoop, vent tell + blast, phase roar, plates bursting, thermal-shock crack, kneel, death groan and rubble; the Leviathan's dimming lure, tail thrash, dive, surge and shock |
| flora | 26 | 52 | living plants: a notched trunk's strain, the crack, the lean, the hinge tearing, a sapling snapping, the crown's rush, the fall in four woods (birch, giant mushroom, mangrove, ember-bark), the canopy thrown down, the log settling; leaves shaken, pods dropping, a glowseed plucked; a seed drinking and sprouting, the root ladder's rungs, growth loop and crown; brush catching (and a Kiln bloom flaring), the brush-fire crackle loop; grass, reeds and kelp brushing past |
| org-× (7) | 19 | 37 | the organisms, per kind: snapjaw tell/snap/gulp/chew/burn/tear, puffer swell/burst, glow-worm lower/retract/snare, leech latch/drink/shed, isopod curl/roll, ember beetle crunch/pop, ash moth flare |
| amb-d1…d4 | 7 | 7 | the Bellows, the Rot Gardens, the Drowned Cisterns, the Kiln Heart (28 s stereo beds); the Breathing Chamber's inhale, exhale and jet loop |

Not generated here: music and narration (the score workstream).

## 8. Every cue

Generated by `node scripts/audio/sfx-doc.mjs` from the catalog, the prompts,
the mastering report and a scan of `src/` for what triggers each cue (`--check`
reports a stale table). ⟲ = loop. Gain is the effective linear gain (family ×
cue).

<!-- cue-table:start -->
| cue | family · bus | gain | takes (s) | triggered by | prompt |
| --- | --- | --- | --- | --- | --- |
| **amb-d1** | | | | | |
| `amb.bellows` ⟲ | bed · ambience | 0.50 | 28.00 | d1 bed (AudioDirector) | Ambience of a vast Victorian underground waterworks: slow rhythmic mechanical bellows breathing, distant steam pipes hissing, occasional metal creaks, water drips echoing in brick cisterns, a low machinery hum |
| `amb.breath.exhale` | material · ambience | 0.41 | 9.88 | SfxEngine, audio.worldSound() | A massive bellows exhaling: pressurized steam blasting through iron pipes with a roaring hiss, then slowly easing off |
| `amb.breath.inhale` | material · ambience | 0.38 | 4.43 | LivingExpedition | An enormous mechanical bellows slowly drawing in air through iron pipes: a long rising whoosh with groaning leather and creaking metal |
| `amb.breath.jet` ⟲ | loop · fx | 0.34 | 3.00 | SfxEngine, audio.worldSound() | Continuous high-pressure steam jet blasting from a brass nozzle, a loud roaring hiss |
| **amb-d2** | | | | | |
| `amb.rot` ⟲ | bed · ambience | 0.50 | 28.00 | d2 bed (AudioDirector) | Ambience of a damp underground fungal garden: dense quiet insect chirrs and clicks, soft spore puffs, wet roots creaking, slow drips, a faint bubbling marsh |
| **amb-d3** | | | | | |
| `amb.cisterns` ⟲ | bed · ambience | 0.50 | 28.00 | d3 bed (AudioDirector) | Ambience of a flooded Victorian stone cistern: gentle water lapping against stone, echoing drips in a huge vaulted chamber, a deep low rumble, distant trickles |
| **amb-d4** | | | | | |
| `amb.kiln` ⟲ | bed · ambience | 0.50 | 28.00 | d4 bed (AudioDirector) | Ambience inside a volcanic furnace: roaring heat, slowly bubbling lava, deep rumbling, distant rhythmic anvil strikes echoing, crackling embers |
| **creature-acidslime** | | | | | |
| `creature.acidslime.alert` | creature · voices | 0.21 | 0.50 / 0.47 | creature(acidslime, 'alert') | An acid slime's bubbling hiss of alarm, short |
| `creature.acidslime.attack` | creature · voices | 0.21 | 0.40 / 0.43 | creature(acidslime, 'attack') | An acid slime biting: a wet squelch and a sharp acidic sizzle, short |
| `creature.acidslime.death` | creature · voices | 0.21 | 0.80 / 0.64 | creature(acidslime, 'death') | An acid slime bursting: a wet pop and a hissing acid sizzle, short |
| `creature.acidslime.hop` | creature · voices | 0.12 | 0.48 / 0.48 | creature(acidslime, 'hop') | An acid slime hopping: a squishy boing with a fizzing hiss, short |
| `creature.acidslime.hurt` | creature · voices | 0.21 | 0.28 / 0.41 | creature(acidslime, 'hurt') | An acid slime hit: a wet splat with fizzing, short |
| `creature.acidslime.idle` | creature · voices | 0.10 | 0.80 / 0.70 | creature(acidslime, 'idle') | An acidic slime blob wobbling with a soft fizzing sizzle, short |
| **creature-bat** | | | | | |
| `creature.bat.alert` | creature · voices | 0.20 | 0.48 / 0.41 | audio.squeak(), creature(bat, 'alert') | A cave bat's sharp high-pitched squeak, short |
| `creature.bat.death` | creature · voices | 0.21 | 0.80 / 0.80 | creature(bat, 'death') | A bat's dying squeal and a soft thump as it falls, short |
| `creature.bat.hurt` | creature · voices | 0.21 | 0.46 / 0.43 | creature(bat, 'hurt') | A bat's pained shriek, short |
| `creature.bat.idle` | creature · voices | 0.10 | 0.64 / 0.87 | creature(bat, 'idle') | A cave bat's leathery wings fluttering with faint high squeaks, short |
| `creature.bat.scatter` | creature · voices | 0.25 | 0.81 / 1.20 | EventCues | A whole roost of bats bursting off a cave ceiling at once: a flurry of many leathery wings and a scatter of high squeaks, short |
| `creature.bat.slimed` | creature · voices | 0.21 | 0.60 | Enemies | A bat's wings gummed with slime: sticky wet flapping and a distressed squeak, short |
| `creature.bat.swoop` | creature · voices | 0.21 | 0.39 / 0.35 | Enemies | A bat swooping fast: a leathery wing whoosh and a sharp squeak, short |
| `creature.bat.wake` | creature · voices | 0.21 | 0.33 / 0.60 | Enemies | A bat waking and dropping from a ceiling: a sudden wing flap and a squeak, short |
| **creature-bomber** | | | | | |
| `creature.bomber.alert` | creature · voices | 0.21 | 0.73 / 0.77 | creature(bomber, 'alert') | A small goblin creature's excited wordless cackle, short |
| `creature.bomber.death` | creature · voices | 0.21 | 0.58 / 0.55 | creature(bomber, 'death') | A small goblin creature's wordless squawk cut short |
| `creature.bomber.fuse` | creature · voices | 0.25 | 1.20 / 1.17 | Enemies | A bomb fuse lit with a sharp fizz and sputtering sparks, over a small creature's gleeful wordless cackle |
| `creature.bomber.hurt` | creature · voices | 0.21 | 0.47 / 0.48 | creature(bomber, 'hurt') | A small goblin creature's startled wordless yelp, short |
| `creature.bomber.idle` | creature · voices | 0.12 | 0.77 / 0.75 | creature(bomber, 'idle') | A small goblin-like creature giggling nervously, wordless, short |
| **creature-colossus** | | | | | |
| `creature.colossus.alert` | boss · voices | 0.88 | 2.15 / 2.35 | Enemies, creature(colossus, 'alert') | A colossal magma giant's thunderous deep roar with rumbling rock and a roar of fire |
| `creature.colossus.death` | boss · voices | 0.96 | 3.22 | colossus, Enemies, creature(colossus, 'death') | A colossal magma giant collapsing: a final deep dying roar and a huge rumbling crumble of rock and fire |
| `creature.colossus.death.crack` | boss · voices | 0.80 | 2.03 | EventCues | A dying stone giant sinking down: a long deep groan of grinding rock as fissures split open with hissing jets of fire |
| `creature.colossus.death.rubble` | boss · voices | 0.96 | 3.14 | colossus | A colossal furnace bursting apart: a huge detonation of stone, then a long cascade of rocks and slabs tumbling and settling, embers hissing |
| `creature.colossus.heave` | boss · voices | 0.48 | 0.90 / 0.90 | EventCues | A colossal stone giant rearing up with both fists raised: a deep grinding creak of rock, gravel sifting down and a rising furnace roar |
| `creature.colossus.hurt` | boss · voices | 0.64 | 0.75 / 0.77 | kilnQuench, creature(colossus, 'hurt') | A magma giant hit: cracking stone and a deep angry growl with hissing lava, short |
| `creature.colossus.idle` | boss · voices | 0.64 | 2.89 | creature(colossus, 'idle') | A giant of molten rock breathing: a deep slow rumble, crackling magma and hissing heat |
| `creature.colossus.kneel` | boss · voices | 0.60 | 1.19 | EventCues | A wounded stone giant dropping to one knee: a heavy grinding thud, then its chest cracking open with a glowing molten hiss |
| `creature.colossus.plates` | boss · voices | 0.88 | 2.00 | colossus | Heavy stone armour plates bursting off a giant's back: a sharp cracking detonation of rock, then stone slabs clattering and tumbling onto a stone floor |
| `creature.colossus.quench` | boss · voices | 0.88 | 1.36 / 1.36 | kilnQuench | Cold water flung onto a white-hot furnace: an explosive steam hiss and the loud crack of superheated stone splitting |
| `creature.colossus.roar` | boss · voices | 0.92 | 1.56 / 1.64 | EventCues | A wounded stone giant's long, low bellowing roar echoing in a cavern, slow and deep, rock cracking and a soft whoosh of flame, clean, not distorted |
| `creature.colossus.scoop` | boss · voices | 0.64 | 0.75 / 0.70 | EventCues | A magma giant tearing a molten gob out of its own furnace chest: a thick wet lava slurp and a hiss of heat, short |
| `creature.colossus.slam` | boss · voices | 0.80 | 1.02 / 0.87 | colossus | Two gigantic stone fists smashing into a rock floor: a massive crunching impact, cracking stone and a spray of rubble |
| `creature.colossus.step` | boss · voices | 0.72 | 0.83 / 0.92 / 0.76 | creature(colossus, 'step') | A colossal stone giant's footstep: a huge earth-shaking boom with cracking rock, short |
| `creature.colossus.stomp` | boss · voices | 1.00 | 1.40 / 1.31 | colossus | A giant stamping the ground: a deep earth-shaking thud and a rolling rumble of rock racing away along the floor |
| `creature.colossus.vent` | boss · voices | 0.88 | 1.68 / 1.62 | colossus | A furnace giant venting: a huge roaring blast of fire and steam bursting from its seams, crackling flames |
| `creature.colossus.vent.tell` | boss · voices | 0.64 | 1.00 | EventCues | Heavy iron furnace plates grinding open with a deep rising inhale of air, steam hissing and building |
| `creature.colossus.volley` | boss · voices | 0.80 | 0.94 / 1.04 | colossus | A magma giant hurling a volley of fireballs: a deep roaring whoosh and crackling flames |
| `creature.colossus.wave.loop` ⟲ | loop · fx | 0.27 | 3.00 | HabitatAudio | Continuous low gritty rumble of rock and gravel rippling fast along a stone floor |
| **creature-eggs** | | | | | |
| `creature.eggs.death` | creature · voices | 0.21 | 0.71 | creature(eggs, 'death') | A clutch of eggs bursting apart, wet splattering pops, short |
| `creature.eggs.hatch` | creature · voices | 0.23 | 0.68 / 1.10 | Enemies | Slimy eggs hatching: wet cracking shells and squishy slurps as little things wriggle out |
| `creature.eggs.hurt` | creature · voices | 0.21 | 0.48 | creature(eggs, 'hurt') | A wet egg sac punctured, a squishy pop, short |
| `creature.eggs.idle` | creature · voices | 0.10 | 0.93 | creature(eggs, 'idle') | A cluster of wet eggs pulsing, a soft slimy throbbing squelch, quiet, short |
| **creature-golem** | | | | | |
| `creature.golem.alert` | creature · voices | 0.21 | 0.87 / 0.88 | creature(golem, 'alert') | A stone golem's deep resonant mechanical rumble and a humming core, short |
| `creature.golem.death` | creature · voices | 0.25 | 1.17 / 1.02 | creature(golem, 'death') | A stone golem collapsing: cracking stone, a powering-down hum and a heavy crash of rubble |
| `creature.golem.hurt` | creature · voices | 0.21 | 0.50 / 0.49 | creature(golem, 'hurt') | A stone golem hit: cracking stone and a low mechanical groan, short |
| `creature.golem.jet` | creature · voices | 0.23 | 0.96 / 0.94 | Enemies | Steam thrusters igniting with a roaring hiss and a rumbling blast, short |
| `creature.golem.punch` | creature · voices | 0.25 | 0.55 / 0.67 | Enemies | A massive stone fist pounding a rock wall, a heavy crunching boom, short |
| `creature.golem.step` | creature · voices | 0.17 | 0.52 / 0.48 / 0.54 | creature(golem, 'step') | A heavy stone golem footstep, a deep thud with a grinding stone creak, short |
| `creature.golem.throw` | creature · voices | 0.23 | 0.68 / 0.73 | Enemies | A stone golem hurling a boulder: heavy grinding and a big whoosh, short |
| **creature-imp** | | | | | |
| `creature.imp.alert` | creature · voices | 0.21 | 0.66 / 0.50 | creature(imp, 'alert') | A fire imp's shrill mischievous wordless cackle with a flare of flame, short |
| `creature.imp.cast` | creature · voices | 0.23 | 0.57 / 0.59 | Enemies | A fire imp hurling a fireball: a fiery whoosh and a crackling burst, short |
| `creature.imp.death` | creature · voices | 0.21 | 1.00 / 1.00 | creature(imp, 'death') | A fire imp snuffed out: a sizzling screech fading into a puff of steam, short |
| `creature.imp.hurt` | creature · voices | 0.21 | 0.46 / 0.48 | creature(imp, 'hurt') | A fire imp's hissing screech like water on embers, short |
| `creature.imp.idle` | creature · voices | 0.12 | 0.76 / 0.75 | creature(imp, 'idle') | A small fire imp's crackling wordless snicker, embers popping, short |
| **creature-leviathan** | | | | | |
| `creature.leviathan.alert` | boss · voices | 0.80 | 2.86 / 2.89 | leviathan, Enemies, creature(leviathan, 'alert') | A colossal sea serpent's deep bellowing roar rising from underwater, churning water and huge bubbles |
| `creature.leviathan.death` | boss · voices | 0.88 | 2.51 | Enemies, creature(leviathan, 'death') | A colossal sea serpent dying: a long agonized deep roar sinking into gurgling water and a heavy final splash |
| `creature.leviathan.dim` | boss · voices | 0.40 | 0.97 / 1.00 | EventCues | A glowing lure snuffed out deep underwater: a soft descending glassy hum fading into a muffled bubble, eerie, quiet, short |
| `creature.leviathan.dive` | boss · voices | 0.64 | 1.27 / 1.26 | EventCues | A huge sea creature diving deep: a heavy churning plunge and a long descending rush of bubbles, muffled |
| `creature.leviathan.flop` | boss · voices | 0.64 | 0.66 / 0.81 | leviathan | A giant beached sea creature heaving and flopping on stone, a heavy wet slam and a groan |
| `creature.leviathan.glance` | boss · voices | 0.48 | 0.48 / 0.48 | Enemies | A blow glancing off a creature's wet armoured hide underwater: a dull plink and a muffled splash, short |
| `creature.leviathan.hurt` | boss · voices | 0.64 | 0.51 / 0.67 | creature(leviathan, 'hurt') | A giant sea serpent's pained bellow, wet and deep, short |
| `creature.leviathan.idle` | boss · voices | 0.64 | 2.07 | creature(leviathan, 'idle') | A colossal underwater beast's deep slow breathing churn, huge bubbles rising, low and ominous |
| `creature.leviathan.lunge` | boss · voices | 0.80 | 1.15 / 1.05 | leviathan | A giant sea serpent lunging out of the water: a massive splash and a snapping roar, short |
| `creature.leviathan.shock` | boss · voices | 0.72 | 0.77 / 0.88 | leviathan | A giant sea creature electrocuted: a crackling electric buzz and a strangled deep wet groan as it convulses, short |
| `creature.leviathan.spit` | boss · voices | 0.80 | 0.97 / 1.03 | Enemies | A giant sea beast spewing a blast of water, a powerful gushing spray, short |
| `creature.leviathan.surge` | boss · voices | 0.88 | 1.54 / 1.47 | leviathan | A colossal sea serpent erupting straight up out of deep water: a rising underwater roar bursting into a massive geyser splash |
| `creature.leviathan.thrash` | boss · voices | 0.80 | 0.52 / 0.90 | leviathan | A giant sea serpent's tail slamming the water surface: a huge flat thwack and a heavy sheet of water flung through the air, splattering down |
| `creature.leviathan.windup` | boss · voices | 0.80 | 1.06 / 1.01 | EventCues | A giant sea serpent inhaling and coiling, a rising deep growl and churning water, short |
| **creature-mage** | | | | | |
| `creature.mage.alert` | creature · voices | 0.21 | 0.75 / 0.79 | creature(mage, 'alert') | A hooded sorcerer's low menacing wordless hum and a crackle of magic, short |
| `creature.mage.blink` | creature · voices | 0.21 | 0.55 / 0.33 | Enemies | A sorcerer teleporting: a magical pop and a quick reverse whoosh, short |
| `creature.mage.cast` | creature · voices | 0.23 | 0.64 / 0.72 | Enemies | Telekinetic magic ripping stones loose: a low rumbling surge and a burst of flying debris, short |
| `creature.mage.death` | creature · voices | 0.21 | 1.26 / 1.36 | creature(mage, 'death') | A sorcerer's magic unravelling: a fading distorted wail and a dissipating magical rush |
| `creature.mage.hurt` | creature · voices | 0.21 | 0.46 / 0.41 | creature(mage, 'hurt') | A hooded sorcerer's pained wordless grunt with a magical crackle, short |
| `creature.mage.shard` | creature · voices | 0.21 | 0.58 / 0.60 | Enemies | A sorcerer flinging stone shards: a sharp magical whoosh with rattling fragments, short |
| **creature-rillback** | | | | | |
| `creature.rillback.alert` | creature · voices | 0.21 | 0.80 / 0.80 | creature(rillback, 'alert') | An eel-like creature's wet hissing gurgle of alarm, short |
| `creature.rillback.charge` | creature · voices | 0.21 | 0.92 / 0.97 | Enemies | An electric eel charging up: a rising humming electric buzz underwater, short |
| `creature.rillback.death` | creature · voices | 0.23 | 1.04 / 1.00 | creature(rillback, 'death') | An eel creature dying: a gurgling wet shriek fading into bubbles, short |
| `creature.rillback.discharge` | creature · voices | 0.23 | 0.80 / 0.80 | Enemies | An electric eel discharging into water: a crackling zap and fizzing bubbles, short |
| `creature.rillback.flop` | creature · voices | 0.17 | 0.48 / 0.46 | Enemies | A beached eel flopping on wet stone, a wet slap, short |
| `creature.rillback.hurt` | creature · voices | 0.21 | 0.46 / 0.47 | creature(rillback, 'hurt') | An eel-like creature's pained wet squeal, short |
| `creature.rillback.idle` | creature · voices | 0.12 | 0.99 / 0.95 | creature(rillback, 'idle') | A small eel-like creature gurgling softly underwater, a bubbly chirp, short |
| `creature.rillback.lunge` | creature · voices | 0.21 | 0.45 / 0.27 | Enemies | A fast eel lunge through water, a sharp wet whoosh and snap, short |
| `creature.rillback.move` | creature · voices | 0.10 | 0.77 / 0.79 / 0.80 | audio.worldSound(), audio.slither() | A slippery eel wriggling through wet silt, a slithering squish, short |
| `creature.rillback.windup` | creature · voices | 0.21 | 0.52 / 0.60 | Enemies | An eel coiling tight in water, a wet tensing slither and a low hiss, short |
| **creature-rootloper** | | | | | |
| `creature.rootloper.alert` | creature · voices | 0.21 | 0.77 / 0.97 | creature(rootloper, 'alert') | A wooden root creature's low groaning creak rising to a rasping hiss, short |
| `creature.rootloper.attack` | creature · voices | 0.23 | 0.60 / 0.30 | creature(rootloper, 'attack') | A whip of wooden roots lashing out: a whooshing swipe and a fibrous crack, short |
| `creature.rootloper.death` | creature · voices | 0.23 | 1.24 / 1.29 | creature(rootloper, 'death') | A root creature dying: splintering wood, a long collapsing creak and falling twigs |
| `creature.rootloper.hurt` | creature · voices | 0.21 | 0.48 / 0.55 | creature(rootloper, 'hurt') | Wood cracking under a blow with a pained creature groan, short |
| `creature.rootloper.idle` | creature · voices | 0.12 | 1.05 / 1.13 | creature(rootloper, 'idle') | A living root creature creaking softly like an old tree in the wind, short |
| `creature.rootloper.step` | creature · voices | 0.08 | 0.45 / 0.45 / 0.45 | audio.creak(), creature(rootloper, 'step') | A creature of living roots stepping: creaking wood and rustling fibres, short |
| `creature.rootloper.windup` | creature · voices | 0.21 | 0.60 / 0.59 | Enemies | Wooden roots tensing and creaking under strain like a drawn bow, short |
| **creature-slime** | | | | | |
| `creature.slime.alert` | creature · voices | 0.21 | 0.54 / 0.47 | creature(slime, 'alert') | A slime creature's gurgling blorp of alarm, short |
| `creature.slime.attack` | creature · voices | 0.21 | 0.41 / 0.20 | creature(slime, 'attack') | A slime blob lunging and biting: a wet squelchy chomp, short |
| `creature.slime.death` | creature · voices | 0.21 | 0.56 / 0.52 | creature(slime, 'death') | A slime creature bursting: a big wet splatter pop, short |
| `creature.slime.hop` | creature · voices | 0.12 | 0.48 / 0.48 / 0.38 | creature(slime, 'hop') | A slime blob hopping: a squishy boing and a wet slap landing, short |
| `creature.slime.hurt` | creature · voices | 0.21 | 0.33 / 0.35 | creature(slime, 'hurt') | A slime creature hit: a wet splat and a gloopy squeal, short |
| `creature.slime.idle` | creature · voices | 0.10 | 0.51 / 0.74 | creature(slime, 'idle') | A slime creature wobbling, a soft gloopy jiggle, short |
| **creature-spitter** | | | | | |
| `creature.spitter.alert` | creature · voices | 0.21 | 0.60 / 0.58 | creature(spitter, 'alert') | A lizard-like creature's hissing croak, short |
| `creature.spitter.death` | creature · voices | 0.21 | 0.71 / 0.75 | creature(spitter, 'death') | A lizard creature's gurgling dying croak, short |
| `creature.spitter.hurt` | creature · voices | 0.21 | 0.47 / 0.47 | creature(spitter, 'hurt') | A lizard creature's pained hissing squeak, short |
| `creature.spitter.idle` | creature · voices | 0.12 | 0.80 / 0.56 | creature(spitter, 'idle') | A small lizard creature clicking its throat, a quiet gurgle, short |
| `creature.spitter.spit` | creature · voices | 0.23 | 0.47 / 0.51 | Enemies | A creature hawking and spitting a gob of corrosive acid, a wet launch, short |
| `creature.spitter.step` | creature · voices | 0.09 | 0.30 / 0.30 / 0.30 | creature(spitter, 'step') | A small lizard creature's claws skittering on stone, short |
| **creature-stonemaw** | | | | | |
| `creature.stonemaw.alert` | creature · voices | 0.21 | 0.86 / 0.74 | creature(stonemaw, 'alert') | A stone beast's deep grinding roar with rattling gravel, short |
| `creature.stonemaw.bite` | creature · voices | 0.25 | 0.48 / 0.53 | Enemies | Huge stone jaws snapping shut, a crunching rock impact, short, punchy |
| `creature.stonemaw.chew` | creature · voices | 0.15 | 0.78 / 0.73 | Enemies, audio.grind() | Stone jaws chewing through rock, a crunching gravel grind, short |
| `creature.stonemaw.death` | creature · voices | 0.23 | 1.25 / 1.12 | creature(stonemaw, 'death') | A stone beast crumbling apart: cracking rock, a dying low rumble and rubble falling |
| `creature.stonemaw.hurt` | creature · voices | 0.21 | 0.42 / 0.46 | creature(stonemaw, 'hurt') | A stone creature cracking with a pained grinding groan, short |
| `creature.stonemaw.idle` | creature · voices | 0.12 | 1.18 / 1.19 | creature(stonemaw, 'idle') | A stone creature grinding its jaws slowly, a low gravelly rumble, short |
| `creature.stonemaw.windup` | creature · voices | 0.21 | 0.47 / 0.46 | Enemies | Stone jaws grinding open with gravel falling, short |
| **creature-weaver** | | | | | |
| `creature.weaver.alert` | creature · voices | 0.32 | 0.62 / 0.70 | creature(weaver, 'alert') | A giant spider-like creature's sharp rising chittering hiss of alarm, dry and clicky, short |
| `creature.weaver.chirr` | creature · voices | 0.27 | 0.80 / 0.80 / 0.80 | audio.chirr() | A giant insect's rapid buzzing chirr, a dry stridulation, short |
| `creature.weaver.death` | creature · voices | 0.41 | 1.16 / 1.27 | creature(weaver, 'death') | A giant spider dying: cracking chitin, a shrill fading chittering screech and legs clattering down |
| `creature.weaver.feed` | creature · voices | 0.21 | 0.79 / 0.79 | Enemies | A giant insect crunching and chewing on a small bug, dry mandible clicks and crunches, short |
| `creature.weaver.hurt` | creature · voices | 0.21 | 0.48 / 0.48 | creature(weaver, 'hurt') | A giant spider-like creature's pained screeching chitter, short |
| `creature.weaver.idle` | creature · voices | 0.14 | 0.70 / 0.90 | creature(weaver, 'idle') | A large insect's dry clicking stridulation chirr, quiet and curious, short |
| `creature.weaver.limbhit` | creature · voices | 0.14 | 0.31 / 0.36 | WeaverLimbs | A thin chitinous leg struck: a dry tap and a small crack, short |
| `creature.weaver.pounce` | creature · voices | 0.21 | 0.52 / 0.60 | Enemies | A giant spider leaping: a sharp chittering screech with a scrabble of legs, short |
| `creature.weaver.sever` | creature · voices | 0.23 | 0.60 / 0.38 | WeaverLimbs | An insect leg snapping off: a brittle chitin crack and a wet pop, short |
| `creature.weaver.silk` | creature · voices | 0.17 | 0.80 / 0.80 | Enemies | Silk thread spun fast from a spinneret, a dry fibrous hiss, short |
| `creature.weaver.spit` | creature · voices | 0.21 | 0.60 / 0.54 | Enemies | A creature spitting a sticky silk thread, a wet-dry hiss and flick, short |
| `creature.weaver.step` | creature · voices | 0.09 | 0.30 / 0.30 / 0.30 / 0.30 | worldTouch, audio.worldSound(), audio.chitin(), creature(weaver, 'step') | Dry chitinous spider legs tapping quickly on stone, two or three light clicks, short |
| `creature.weaver.strike` | creature · voices | 0.23 | 0.60 / 0.42 | Enemies | A sharp chitin needle stabbing into stone, a hard crack and a gritty knock, short |
| `creature.weaver.windup` | creature · voices | 0.21 | 0.60 / 0.60 | Enemies | A spider-like creature rearing up: a rapid dry clicking rattle building, short |
| **creature-wisp** | | | | | |
| `creature.wisp.alert` | creature · voices | 0.21 | 0.80 / 0.74 | creature(wisp, 'alert') | A frost wisp flaring: a bright crystalline chime swell with a cold whoosh, short |
| `creature.wisp.cast` | creature · voices | 0.21 | 0.57 / 0.46 | Enemies | A frost wisp firing an ice bolt: a glassy chime and an icy zip, short |
| `creature.wisp.death` | creature · voices | 0.21 | 0.86 / 1.00 | creature(wisp, 'death') | A frost wisp shattering: bursting ice crystals and a fading glassy chime, short |
| `creature.wisp.hurt` | creature · voices | 0.21 | 0.48 / 0.48 | creature(wisp, 'hurt') | A frost wisp flickering: a crackling icy glitch and a thin glassy whine, short |
| `creature.wisp.idle` | creature · voices | 0.10 | 0.96 / 1.00 | creature(wisp, 'idle') | A frost wisp humming: a soft icy crystalline shimmer, quiet, short |
| **flora** | | | | | |
| `flora.brush.grass` | step · fx | 0.11 | 0.45 / 0.45 / 0.45 | HabitatAudio | Walking through tall grass: one soft swishing sweep of long blades brushing past a leg, quiet, close-miked, short |
| `flora.brush.kelp` | step · fx | 0.07 | 0.52 / 0.55 | HabitatAudio | Kelp fronds brushing past a swimmer underwater: a slick muffled rubbery swish and a few tiny bubbles, quiet, short |
| `flora.brush.reeds` | step · fx | 0.08 | 0.55 / 0.55 | HabitatAudio | Pushing through stiff reeds at a pond's edge: a dry clattering swish of hollow stems knocking together, quiet, close-miked, short |
| `flora.burn.loop` ⟲ | loop · fx | 0.31 | 3.00 | HabitatAudio (material scan) | Continuous dense, steady crackling of dry brambles and leaves burning, an even unbroken fizzing crackle thick with tiny twig pops, constant level, no roar |
| `flora.canopy` | material · fx | 0.24 | 1.18 / 1.09 | EventCues | A tree's leafy crown smashing onto the ground: a thick rushing crash of leaves and small twigs snapping, settling into a soft rustle, short |
| `flora.catch` | material · fx | 0.22 | 0.72 / 0.79 | HabitatAudio | A dry bramble thicket catching fire: a sudden soft whoomph and a rising burst of crackling, popping twigs and dry leaves, short |
| `flora.crack` | impact · fx | 0.81 | 0.66 / 0.68 | EventCues | A tree trunk cut through: a loud sharp crack of living wood splitting, a burst of splinters and a short fibrous rip, close, punchy, dry |
| `flora.creak` | material · fx | 0.14 | 1.10 / 1.10 | EventCues, Flora | A living tree trunk straining at a deep axe notch: a slow tight groaning creak of green wood fibres under load, a few tiny splinter ticks, close, dry, no reverb |
| `flora.fall.birch` | impact · fx | 0.60 | 1.38 / 1.19 | EventCues | A slender pale birch tree crashing down onto a stone floor: a heavy hollow wooden thud with a sharp crack of snapping branches and a hiss of leaves, short tail, no reverb |
| `flora.fall.emberbark` | impact · fx | 0.85 | 1.05 / 0.80 | EventCues | A charred smouldering tree trunk crashing onto hot stone: a heavy brittle wooden thud, a crunch of charcoal and a burst of crackling sparks, short tail, no reverb |
| `flora.fall.mangrove` | impact · fx | 0.55 | 1.38 / 1.15 | EventCues | A waterlogged mangrove tree falling in a flooded stone cistern: a deep heavy wooden thud, a big slap of water and roots cracking, short tail, no reverb |
| `flora.fall.mushroom` | impact · fx | 0.62 | 1.02 / 1.15 | EventCues | A giant mushroom stalk toppling onto wet ground: a dull heavy spongy thump, a wet fleshy slap of the cap and a soft patter of spores, short tail, no reverb |
| `flora.firelily.flare` | material · fx | 0.19 | 0.41 / 0.45 | HabitatAudio | A dry flower bloom flaring alight: a small bright fwoomph of petals catching flame and a quick papery crackle, short, dry |
| `flora.glowseed` | pickup · ui | 0.36 | 0.70 / 0.70 | Flora | Plucking a glowing seed pod: a soft organic pop and a faint rising glassy twinkle, gentle and magical, short, dry |
| `flora.hinge` | impact · fx | 0.34 | 0.68 / 0.70 | EventCues | The last fibres of a falling tree's hinge tearing apart: a quick stringy wooden rip ending in a snap, short, dry |
| `flora.ladder.bloom` | material · fx | 0.26 | 1.20 / 1.20 | EventCues | A plant's crown of leaves unfurling all at once: a soft rustling bloom and a gentle leafy flutter settling, short, dry |
| `flora.ladder.grow.loop` ⟲ | loop · fx | 0.27 | 3.00 | EventCues | Continuous creaking and stretching of green wood and roots growing quickly, fibrous squeaks and soft cracks, steady |
| `flora.ladder.rung` | impact · fx | 0.12 | 0.35 / 0.35 / 0.35 | EventCues | A green wooden branch shooting out of a growing stalk: a quick firm creaking knock of fresh wood, short, dry, close |
| `flora.lean` | impact · fx | 0.29 | 1.80 / 1.80 | EventCues | A tall tree beginning to topple: a long deep groaning creak of wood fibres stretching and tearing slowly as the trunk leans, leaves shivering, dry, no reverb |
| `flora.pod.drop` | material · fx | 0.09 | 0.47 / 0.59 | EventCues | A small seed pod snapping off a branch and dropping onto stone: a light woody pop, a soft papery burst as it splits and a patter of tiny seeds, short, dry |
| `flora.rustle` | material · fx | 0.15 | 0.78 / 0.80 | EventCues | A leafy branch shaken hard: a brisk rustle of many leaves with a few falling away, short, close, dry |
| `flora.sapling` | impact · fx | 0.14 | 0.50 / 0.34 | EventCues | A thin green sapling stem snapped by a boot: a small crisp woody snap with a leafy rustle, short, close-miked, dry |
| `flora.seed.soak` | material · fx | 0.08 | 0.90 / 0.90 | EventCues | A dry seed drinking water: a few quiet thirsty sipping gulps and a soft wet swelling creak, close-miked, short |
| `flora.seed.sprout` | material · fx | 0.16 | 1.00 / 0.99 | EventCues | A swollen seed bursting open and sprouting fast: a wet fibrous pop, a quick rising creak of a green shoot pushing up and a soft leafy flick, short |
| `flora.settle` | impact · fx | 0.11 | 1.08 / 1.07 | EventCues | A heavy log rolling a little and settling to rest on stone: a low wooden rumble, a soft knock and a last quiet creak, short, dry |
| `flora.whoosh` | impact · fx | 0.40 | 0.88 / 0.87 | EventCues | A leafy tree crown rushing down through the air: a heavy swelling whoosh of branches and thousands of leaves, short |
| **org-ashmoth** | | | | | |
| `organism.ashmoth.flare` | critter · ambience | 0.21 | 0.48 / 0.48 | EventCues | A moth flying into a flame: a tiny bright fizzing flare and a papery crackle, short |
| **org-emberbeetle** | | | | | |
| `organism.emberbeetle.crunch` | critter · ambience | 0.10 | 0.48 / 0.48 | crawler | A small beetle crunching a lump of coal: a dry gritty crunch with a faint ember crackle, quiet, short |
| `organism.emberbeetle.pop` | creature · voices | 0.14 | 0.48 / 0.33 | crawler | A tiny ember-filled beetle popping: a small crackling pop and a spray of sizzling sparks, short |
| **org-glowworm** | | | | | |
| `organism.glowworm.lower` | critter · ambience | 0.12 | 0.77 / 0.79 | EventCues | A fine luminous silk thread paying out slowly: a soft thin stretching creak and a faint glassy twinkle, quiet, short |
| `organism.glowworm.retract` | creature · voices | 0.23 | 0.48 / 0.47 | EventCues | A sticky beaded thread reeled up fast: a quick high silky zip and a faint glassy rattle of beads, short |
| `organism.glowworm.snare` | critter · ambience | 0.15 | 0.56 / 0.59 | EventCues | A small moth stuck on a sticky thread: a tiny frantic wing flutter and a faint glassy tick, short |
| **org-isopod** | | | | | |
| `organism.isopod.curl` | creature · voices | 0.12 | 0.40 / 0.40 | EventCues | A pill bug curling into an armoured ball: a quick dry clicking of chitin plates folding tight, short |
| `organism.isopod.roll` | critter · ambience | 0.12 | 0.15 / 0.23 | crawler | A small hard armoured ball bouncing on stone: a light hollow chitin tap, short, dry |
| **org-leech** | | | | | |
| `organism.leech.drink` | creature · voices | 0.12 | 0.48 / 0.45 | EventCues | A leech drinking: a small wet sucking slurp, quiet, close-miked, short |
| `organism.leech.latch` | creature · voices | 0.29 | 0.42 / 0.35 | EventCues | A leech fastening onto skin: a wet sucking smack, close-miked, short |
| `organism.leech.shed` | creature · voices | 0.17 | 0.58 / 0.30 | EventCues | A swollen leech letting go: a wet slurping pop and a soft plop into water, short |
| **org-puffer** | | | | | |
| `organism.puffer.burst` | creature · voices | 0.29 | 0.66 / 0.45 | EventCues | A swollen fungal spore sac bursting: a wet rubbery pop and a soft rushing hiss of gas spilling out, short |
| `organism.puffer.swell` | creature · voices | 0.12 | 0.74 / 0.77 | EventCues | A fungal bladder swelling tight: a soft rubbery stretching creak and a faint wheezing hiss, quiet, short |
| **org-snapjaw** | | | | | |
| `organism.snapjaw.burn` | creature · voices | 0.31 | 1.20 | snapjaw | A green plant stalk burning through: wet sap hissing and popping in a crackling flare of flame, then a dry crumble of ash, short |
| `organism.snapjaw.chew` | creature · voices | 0.10 | 0.80 / 0.80 | snapjaw | A closed plant pod slowly digesting: a muffled wet churn and a soft sap gurgle, quiet, short |
| `organism.snapjaw.gulp` | creature · voices | 0.19 | 0.47 / 0.60 | EventCues | A plant pod swallowing something whole: a thick wet gulp and a muffled squelch, short |
| `organism.snapjaw.snap` | creature · voices | 0.27 | 0.33 / 0.25 | EventCues | Huge carnivorous plant jaws slamming shut: a sharp wet woody clack with a fibrous whip crack, short, punchy |
| `organism.snapjaw.tear` | creature · voices | 0.21 | 0.60 / 0.28 | snapjaw | A fleshy plant pod torn apart: a wet fibrous rip and a spatter of sap, short |
| `organism.snapjaw.tell` | creature · voices | 0.21 | 0.60 / 0.60 | snapjaw | A carnivorous plant pod quivering open to strike: a wet fibrous creak and a low rattling hiss of tension, short |
| **player** | | | | | |
| `flask.dry` | player · fx | 0.14 | 0.48 / 0.48 | Flask | A hollow tap on an empty glass bottle, a dull clink, short, dry |
| `flask.pour.loop` ⟲ | loop · fx | 0.27 | 3.00 | Flask | Continuous stream of liquid pouring out of a glass flask onto stone, glugging and splattering |
| `flask.shatter` | impact · fx | 0.46 | 0.39 / 0.80 / 0.59 | Flask | A glass flask smashing on stone: bright shattering glass and a liquid splash, short |
| `flask.siphon.loop` ⟲ | loop · fx | 0.27 | 3.00 | Flask | Continuous suction slurp of liquid drawn up through a narrow glass tube into a flask, bubbling gurgle |
| `flask.throw` | player · fx | 0.14 | 0.41 / 0.31 | Flask | A glass bottle thrown, a short whoosh with liquid sloshing inside |
| `light.lantern.hood` | player · fx | 0.21 | 0.48 / 0.32 | EventCues | A small brass hood snapped down over a lantern: a dry low metallic click, then a tiny flame's last breath hissing out to a smoulder, close-miked, short, dry |
| `light.lantern.unhood` | player · fx | 0.27 | 0.68 / 0.45 | EventCues | A small brass lantern hood flipped open: a bright crisp metallic click and a soft warm whoomph of a small flame taking the air, close-miked, short, dry |
| `pickup.bell` | pickup · ui | 0.30 | 1.00 | Pickups | A small brass hand bell lifted, a clear bright ring with a gentle wobble, short |
| `pickup.chest` | pickup · ui | 0.25 | 1.28 / 1.22 | audio.chest() | An old wooden treasure chest creaking open with a brass latch, and gold coins spilling out, short |
| `pickup.coin` | pickup · ui | 0.29 | 0.48 / 0.48 / 0.38 | audio.coin() | A single small gold coin landing and ringing with a bright clear ching, short |
| `pickup.generic` | pickup · ui | 0.22 | 0.48 / 0.48 | audio.pickup() | Picking up a small object: a soft grab with a bright little shimmer, short |
| `pickup.gold` | pickup · ui | 0.23 | 0.52 / 0.42 / 0.51 | Pickups | Scooping up a small pile of gold nuggets, bright chunky clinks, short, close-miked |
| `pickup.heart` | pickup · ui | 0.30 | 1.00 / 0.83 | Pickups | A crystal heart vessel absorbed: a deep warm pulse with a soft magical chime bloom |
| `pickup.key` | pickup · ui | 0.52 | 0.73 / 0.66 | Pickups, audio.keyJingle() | A heavy golden key picked up, a bright metallic jingle with a sparkle, short |
| `pickup.leg` | pickup · ui | 0.25 | 0.49 | Pickups | Grabbing a long severed insect leg, a dry chitin rattle and a hollow knock, short |
| `pickup.potion` | pickup · ui | 0.31 | 0.79 / 0.72 | audio.drinkPotion() | Drinking a potion in three quick gulps, then a small satisfied glassy fizz, short |
| `player.club.hit` | player · fx | 0.26 | 0.37 / 0.48 | LooseWeaverLeg, WeaverLimbs | A hard chitinous club smashing into a body, a crunchy thwack with a crack, short, punchy |
| `player.club.swing` | player · fx | 0.19 | 0.48 / 0.48 | WeaverLimbs | A long bony insect leg swung like a club, a heavy whooshing swipe through the air, short |
| `player.club.throw` | player · fx | 0.19 | 0.60 | LooseWeaverLeg | A long object hurled end over end, a whirring spinning whoosh, short |
| `player.corpse.knell` | stinger · ui | 0.21 | 2.34 | Player | A single low distant funeral bell toll echoing in a stone cavern, soft, long decay |
| `player.corpse.wand` | player · fx | 0.14 | 0.75 / 0.79 | Player | A wooden staff clattering onto a stone floor with a couple of hollow bounces, short |
| `player.cramped` | player · fx | 0.12 | 0.48 / 0.46 | audio.crampedBump() | A felt hat brim bumping a low stone ceiling, a soft muffled thud with a trickle of grit, short |
| `player.crawl` | step · fx | 0.05 | 0.45 / 0.45 / 0.45 | audio.crawlShuffle() | Cloth and leather shuffling across gritty stone as someone crawls, a soft scrape, short |
| `player.death` | player · fx | 0.31 | 1.09 / 1.21 | Player | A man's final strangled gasp as he collapses onto a stone floor with a body thud, wordless |
| `player.dive` | player · fx | 0.21 | 0.38 / 0.46 | Player | A body dropping fast: a quick rising air whoosh with a cloak flapping, short |
| `player.drink` | player · fx | 0.19 | 0.21 / 0.35 / 0.48 | Player | A single gulp of liquid swallowed from a glass flask, close-miked, short |
| `player.gear` | step · fx | 0.05 | 0.45 / 0.45 / 0.45 | audio.worldSound() | Small glass phials clinking softly together in a leather satchel with a light cloak rustle, one step, short |
| `player.glowseed` | player · fx | 0.14 | 0.48 / 0.48 | LivingExpedition | A small seed pod tossed with a soft whoosh and a faint magical twinkle, short |
| `player.grab` | player · fx | 0.14 | 0.48 / 0.48 | Player | Gloved hands slapping onto a rough rock wall and gripping, a leather scrape, short, close-miked |
| `player.heal` | player · fx | 0.14 | 0.48 / 0.48 | Player | A soft warm magical sparkle absorbed, a gentle rising glimmer, very short |
| `player.heartbeat` | player · fx | 0.32 | 0.72 / 0.72 | DeathCinema, audio.heartbeat() | Two deep heavy heartbeat thumps, lub-dub, muffled, close, low frequency |
| `player.hurt` | player · fx | 0.51 | 0.46 / 0.48 / 0.49 | audio.hurt() | A man's short pained grunt, surprised, wordless, close-miked, dry |
| `player.jump` | player · fx | 0.11 | 0.24 / 0.31 / 0.26 | audio.jump() | A short cloak whoosh with a light boot scuff as someone jumps, quick, close-miked, dry |
| `player.kick` | player · fx | 0.32 | 0.60 / 0.60 | Player | A forceful kick: a sharp gust of air and a low thump of force, short, punchy |
| `player.land.hard` | player · fx | 0.22 | 0.60 / 0.62 | audio.landThud() | A heavy landing from a high fall onto stone: a deep boot thud, knees absorbing, grit and dust, short |
| `player.land.soft` | player · fx | 0.11 | 0.35 / 0.35 / 0.35 | audio.landThud() | A light landing on stone: a soft boot thump with a little grit, short, close-miked |
| `player.levitate.loop` ⟲ | loop · fx | 0.31 | 3.00 | audio.levitate() | Steady soft magical levitation hum with an airy hiss of rushing air beneath, gentle and continuous |
| `player.pullup` | player · fx | 0.14 | 0.44 / 0.46 | Player | Someone hauling himself up over a stone ledge: cloth rustle and a scrape of boots on rock, short |
| `player.recharge` | player · fx | 0.14 | 0.48 | Player | A soft single warm magical chime pulse, gentle and quiet, short |
| `player.recharge.done` | stinger · ui | 0.28 | 1.36 | Player | A warm rose-gold magical bloom: a soft chime swell with a shimmering airy halo, gentle, short |
| `player.skid` | player · fx | 0.14 | 0.48 / 0.48 | Player | Leather boots skidding briefly on gritty stone, a short scrape, close-miked |
| `player.slam` | player · fx | 0.57 | 0.75 / 0.69 | Player | A heavy ground pound: a body slamming into stone from above, a deep booming thud with cracking rock and debris |
| `player.sputter` | player · fx | 0.15 | 0.57 / 0.52 | audio.sputter() | A small magical jet coughing and sputtering, put-put gasps of air like a failing engine, short |
| `player.staff` | player · fx | 0.19 | 0.38 / 0.42 / 0.48 | WandSystem, audio.dig() | A hard wooden staff striking rock, a sharp crack with chips of stone skittering, short, close-miked |
| `player.step.metal` | step · fx | 0.06 | 0.37 / 0.45 / 0.33 | audio.worldSound() | A single footstep of a boot on an iron grate walkway, a metallic clank with a short ring, close-miked |
| `player.step.soft` | step · fx | 0.07 | 0.35 / 0.35 / 0.35 / 0.35 | audio.footstep() | A single footstep of a leather boot on soft sand and ash, a muffled crunch, close-miked, short |
| `player.step.stone` | step · fx | 0.07 | 0.35 / 0.21 / 0.15 / 0.35 | audio.footstep() | A single footstep of a leather boot on wet slate stone, close-miked, dry, short |
| `player.step.wet` | step · fx | 0.07 | 0.40 / 0.40 / 0.40 / 0.40 | audio.footstep() | A single footstep in a shallow puddle on stone, a small splash, close-miked, short |
| `player.step.wood` | step · fx | 0.07 | 0.27 / 0.35 / 0.21 | audio.footstep() | A single footstep of a leather boot on old wooden planks, a hollow knock, close-miked, short |
| `player.stomp` | player · fx | 0.28 | 0.42 / 0.60 | Player | A boot stomping down onto a soft creature, a wet crunch and squish, short, punchy |
| `player.teleport` | player · fx | 0.26 | 0.89 / 1.00 | Spells, Player | A magical teleport: a sharp rising shimmering whoosh ending in a soft pop, short |
| `player.vine` | player · fx | 0.14 | 0.48 / 0.48 | Player | Hands grabbing a thick hanging vine: a leafy rustle and a creaking fibrous stretch, short |
| `player.wade` | step · fx | 0.10 | 0.69 / 0.79 / 0.74 | audio.worldSound() | Wading one step through waist-deep water, a sloshing swirl, close-miked, short |
| `wand.dry` | player · fx | 0.17 | 0.48 / 0.48 | audio.dryFire() | A wand fizzling out with no power: a hollow click and a tiny sad spark fizzle, short |
| `wand.swap` | player · fx | 0.13 | 0.29 / 0.37 | audio.wandSwap() | A wooden wand drawn quickly from a leather holster, a short whick and a soft click, dry |
| **spells** | | | | | |
| `spell.aquajet.loop` ⟲ | loop · fx | 0.31 | 3.00 | WandSystem | Continuous water hose stream spraying hard and splattering on stone |
| `spell.blackhole.implode` | spell · fx | 0.80 | 1.45 / 1.48 | audio.implode() | A vortex collapsing: air violently sucked inward in a rising reverse whoosh, then a deep sharp snap |
| `spell.blackhole.loop` ⟲ | loop · fx | 0.37 | 3.00 | HabitatAudio (in flight) | Continuous deep ominous gravitational vortex hum, swirling rushing air, a low drone |
| `spell.bomb.cast` | spell · fx | 0.44 | 0.48 / 0.36 | WandSystem | A small iron bomb tossed from a hand, a short whoosh with a fizzing fuse |
| `spell.bomb.fuse.loop` ⟲ | loop · fx | 0.24 | 3.00 | HabitatAudio (in flight) | Continuous short fizzing sputter of a lit bomb fuse, crackling sparks |
| `spell.charge.electric` | spell · fx | 0.31 | 0.48 / 0.48 | Projectiles | A quick electric static zap and crackle, short |
| `spell.charge.frost` | spell · fx | 0.31 | 0.45 / 0.48 | Projectiles | A quick frosty chill: a crisp icy tinkle and a soft crackle, short |
| `spell.conjure` | spell · fx | 0.53 | 0.34 / 0.55 | Spells, WandSystem | A stone slab grinding rapidly up out of the ground, a rocky crunch and a settling thud, short |
| `spell.crit.pyre` | spell · fx | 0.40 | 0.53 / 0.43 | Projectiles | A burst of flame erupting: a fiery whump with crackle, short, punchy |
| `spell.crit.shatter` | spell · fx | 0.40 | 0.60 / 0.44 | Projectiles | A frozen target shattering: a loud crisp ice crack and a bright crystalline burst, short |
| `spell.crit.wet` | spell · fx | 0.35 | 0.40 / 0.43 | Projectiles | A heavy wet splat with a bright splash ping, short, punchy |
| `spell.cryojet.loop` ⟲ | loop · fx | 0.31 | 3.00 | WandSystem | Continuous freezing liquid nitrogen jet: a cold high-pressure hiss with crackling frost forming |
| `spell.dig.loop` ⟲ | loop · fx | 0.27 | 3.00 | audio.dig() | Continuous high-pitched magical grinding drill beam boring into rock, a gritty whine |
| `spell.emberstorm` | spell · fx | 0.49 | 0.93 / 0.93 | Spells, WandSystem | A fountain of glowing embers bursting upward, crackling sparks and a fiery whoosh |
| `spell.flame.ignite` | spell · fx | 0.40 | 0.57 / 0.46 | SfxEngine, audio.flame() | A gas burner igniting with a whoomp and a flare of fire, short |
| `spell.flame.loop` ⟲ | loop · fx | 0.37 | 3.00 | SfxEngine, audio.flame() | Continuous roaring flamethrower stream, steady whooshing fire with crackle |
| `spell.freeze` | spell · fx | 0.40 | 0.91 / 0.95 | Projectiles | Water crackling and freezing solid into ice, crisp crystalline creaks and snaps, short |
| `spell.frostshard.cast` | spell · fx | 0.56 | 0.48 / 0.46 / 0.48 | Spells, WandSystem | A sharp ice shard launched, a crystalline whistle and a quick zip, short |
| `spell.ice.impact` | spell · fx | 0.40 | 0.59 / 0.60 / 0.43 | Projectiles | An ice shard shattering on impact, a crystalline crunch and tinkling fragments, short |
| `spell.icelance.cast` | spell · fx | 0.44 | 0.51 / 0.51 | Spells, WandSystem | A heavy ice lance hurled, a glassy ringing whoosh with frosty crackle, short |
| `spell.lightning` | spell · fx | 0.96 | 1.13 / 1.48 / 0.95 | audio.lightning() | A close lightning bolt strike: a sharp deafening crack with a sizzling electric tail and a quick rumble |
| `spell.meteor.cast` | spell · fx | 0.49 | 0.80 / 0.56 | Spells, WandSystem | A heavy molten rock launched, a low fiery whoomph with crackling embers |
| `spell.meteor.loop` ⟲ | loop · fx | 0.31 | 3.00 | HabitatAudio (in flight) | Continuous roar of a burning rock flying through the air, a fiery rushing rumble |
| `spell.spark.cast` | spell · fx | 0.21 | 0.27 / 0.22 / 0.44 | Spells, WandSystem | A small crackling electric spark bolt fired from a wand: a sharp snap and a fast zipping buzz, short, punchy |
| `spell.spark.impact` | spell · fx | 0.23 | 0.36 / 0.31 / 0.48 | Projectiles | A tiny electric bolt hitting a stone surface: a crisp crackling snap with a brief fizz, short |
| `spell.vitrify` | spell · fx | 0.49 | 0.87 / 0.98 | WandSystem | Liquid instantly hardening into glass: a bright crystalline crackle and a ringing glassy tone |
| `spell.vitriol.loop` ⟲ | loop · fx | 0.31 | 3.00 | Spells, WandSystem | Continuous hissing spray of acid from a nozzle, sizzling and fizzing as it spatters |
| `spell.warp.cast` | spell · fx | 0.44 | 0.68 / 0.53 | Spells, WandSystem | A warping magical projectile launched: a phasing shimmer whoosh with a watery wobble, short |
| `spell.wisp.cast` | spell · fx | 0.44 | 0.68 / 0.49 | Spells, WandSystem | An ethereal wisp spirit released, an airy whistling glide with a soft glassy chime |
| `spell.wisp.loop` ⟲ | loop · fx | 0.17 | 3.00 | HabitatAudio (in flight) | Continuous soft ethereal whispering hum, a gentle airy magic shimmer |
| `trick.shellcrack` | spell · fx | 0.52 | 0.75 / 0.78 | audio.shellCrack() | A hard insect shell cracking loudly, a dry brittle crunch with a hollow pop, short |
| `trick.whip` | spell · fx | 0.33 | 0.54 | audio.finisherWhip() | A rising whip-like whoosh building tension, an airy swoosh accelerating upward, short |
| **tea** | | | | | |
| `tea.advance` | tea · fx | 0.25 | 0.41 / 0.41 | TeaMachine, Tea Engine stage 3, Tea Engine stage 12 | A small brass ratchet click as a mechanism advances one notch, short |
| `tea.boulder` | tea · fx | 0.40 | 2.39 | Tea Engine stage 5 | A heavy stone boulder rolling down a wooden ramp, a rumbling roll over creaking planks |
| `tea.cap` | tea · fx | 0.40 | 0.08 | TeaMachine | A percussion cap firing: a sharp small pop and a crackle of sparks |
| `tea.counterweight` | tea · fx | 0.40 | 2.26 | Tea Engine stage 15 | A heavy counterweight descending on squeaking pulleys and rattling chains, ending in a clunk |
| `tea.dominoes` | tea · fx | 0.40 | 1.63 | Tea Engine stage 7 | Six large wooden dominoes toppling one after another in a clattering chain, then a latch clicks |
| `tea.duck` | tea · fx | 0.32 | 0.71 | Tea Engine stage 9 | A rubber duck squeak followed by a gentle water drip into a basin |
| `tea.fault` | tea · fx | 0.32 | 1.08 | TeaMachine | A comedic machine failure: a dull hollow clonk and a gear winding down with a sad creak |
| `tea.generator` | tea · fx | 0.40 | 1.76 | Tea Engine stage 13 | A copper coil generator surging to life: a rising electric hum and crackling current |
| `tea.knocker` | tea · fx | 0.36 | 1.12 | TeaMachine | A clockwork knocker winding up with ticks, then whacking a hanging iron weight with a solid thunk |
| `tea.magnet` | tea · fx | 0.36 | 1.48 | Tea Engine stage 14 | An electromagnet energizing with a rising hum, then an iron latch yanked free with a loud clank |
| `tea.marble` | tea · fx | 0.36 | 2.20 | Tea Engine stage 10 | A steel marble rolling fast along a long brass rail, a rumbling roll ending in a sharp flint strike |
| `tea.pendulum` | tea · fx | 0.40 | 1.93 | Tea Engine stage 4 | A heavy iron pendulum released: a creaking rope, a great whoosh, then a stone boulder struck with a heavy knock |
| `tea.served` | tea · fx | 0.43 | 2.79 | TeaMachine | A copper kettle whistle rising to a shrill peak, then a small brass bell rung twice, cheerful |
| `tea.spring` | tea · fx | 0.36 | 1.22 | Tea Engine stage 8 | A wound clockwork spring releasing: a fast whirring crank spin and a whipping cable snap |
| `tea.striker` | tea · fx | 0.36 | 1.16 | TeaMachine | A flint striker scraping and sparking, then a black powder fuse catching with a fizzing hiss |
| **ui** | | | | | |
| `stinger.alchemy` | stinger · ui | 0.57 | 1.20 / 1.12 / 1.01 | SfxEngine, audio.stinger('alchemy') ← Stingers | A single bright struck glass bell with a warm brass swell underneath, magical and satisfying, short ring |
| `stinger.fallen` | stinger · ui | 0.52 | 2.40 / 2.87 | audio.stinger('fallen') ← Stingers | A short sombre descending brass sting in a minor key, ending on a cold distant glass bell |
| `stinger.phialCrack` | stinger · ui | 0.32 | 1.04 / 0.94 | audio.stinger('phialCrack') ← Stingers | A small glass phial cracking sharply in a hand: a bright crack, a falling glassy ring and a few tinkling shards |
| `stinger.phialFill` | stinger · ui | 0.33 | 1.41 / 1.19 | audio.stinger('phialFill') ← Stingers | A glass phial filling with liquid, glugging upward in pitch, settling into a warm soft glass chime |
| `stinger.shutter` | stinger · ui | 0.38 | 0.27 / 0.33 | audio.stinger('shutter') ← Stingers | An old camera shutter: a mechanical curtain click, a tiny spring whirr and a second click, very short, dry |
| `stinger.victory` | stinger · ui | 0.52 | 2.15 / 2.40 | audio.stinger('victory') ← Stingers | A short triumphant Victorian brass fanfare sting rising to a bright held major chord with bells |
| `ui.back` | ui · ui | 0.14 | 0.30 / 0.30 | UiSounds | A soft muted wooden knock followed by a small latch click, gentle interface cancel sound, very short, dry |
| `ui.bench` | ui · ui | 0.16 | 1.14 / 0.98 | UiSounds | An old wooden workbench drawer slid open, brass tools and glass vials rattling softly inside, short, close-miked |
| `ui.card.choose` | ui · ui | 0.20 | 0.24 / 0.91 | UiSounds | A single stiff card placed decisively onto a wooden table with a soft thock, followed by a short warm glassy chime |
| `ui.card.pick` | ui · ui | 0.11 | 0.25 / 0.25 / 0.25 | audio.cardPick() | Paper snick: a single stiff card lifted crisply off a stack, a very short paper flick, dry, close-miked |
| `ui.card.reveal` | ui · ui | 0.20 | 0.94 / 0.87 | UiSounds | Three stiff playing cards dealt quickly in a fan onto felt, with a soft magical shimmer rising, short |
| `ui.card.slot` | ui · ui | 0.16 | 0.16 / 0.30 / 0.30 | audio.cardSlot() | A brass card slotted firmly into a brass holder, a crisp metallic clack with a tiny spring snap, very short, dry |
| `ui.click` | ui · ui | 0.10 | 0.20 / 0.14 / 0.20 | UiSounds | A crisp brass toggle switch click, satisfying mechanical interface click, single, very short, dry, close-miked |
| `ui.close` | ui · ui | 0.10 | 0.68 / 0.24 | UiSounds | A leather-bound ledger closing with a soft padded thump and a brass clasp clicking shut, short, dry, close-miked |
| `ui.coins` | ui · ui | 0.17 | 0.77 / 0.85 | Sanctum | A small handful of gold coins counted onto a brass counter, bright clinks settling, short, close-miked, dry |
| `ui.curtain` | ui · ui | 0.19 | 1.45 / 1.45 | DeathCinema, UiSounds | A heavy velvet theatre curtain swept open with a deep soft whoosh and a low distant boom |
| `ui.grimoire` | ui · ui | 0.17 | 1.29 / 1.24 | UiSounds | A quill pen scratching a quick flourish on parchment, followed by a soft warm magical glimmer chime, short |
| `ui.hint` | ui · ui | 0.14 | 0.50 / 0.60 | UiSounds | A single parchment page turned quickly, a soft paper flick, short, close-miked, dry |
| `ui.hover` | ui · ui | 0.04 | 0.12 / 0.12 / 0.12 | UiSounds | A tiny soft brass tick, a fingertip lightly tapping a small brass switch, extremely short, dry, close-miked, subtle interface hover sound |
| `ui.learn` | stinger · ui | 0.36 | 1.41 / 1.27 | audio.learn() | A magical discovery flourish: a rising sparkle of glass chimes and a soft warm bell, bright and short, no drums |
| `ui.objective` | ui · ui | 0.21 | 0.85 / 1.20 | UiSounds | Pneumatic tube message arriving: a short soft whoosh ending in a brass capsule thunk and a small bright bell ding |
| `ui.open` | ui · ui | 0.15 | 0.79 / 0.54 | UiSounds | A leather-bound ledger opening: soft paper rustle and a small brass clasp unlatching, short, dry, close-miked |
| `ui.pause` | ui · ui | 0.21 | 1.00 / 1.00 | UiSounds | A brass steam valve turned shut: a short soft hiss that slows and stops with a gentle mechanical clunk, quiet |
| `ui.phial.drain` | stinger · ui | 0.24 | 1.36 / 1.36 | RunHud | A small glass vial tapped with a thin ring, then liquid draining away with a descending hollow glug |
| `ui.phial.refill` | stinger · ui | 0.24 | 0.88 / 1.18 | RunHud | Liquid poured into a small glass vial, a bright rising glassy fill ending in a soft clear ding |
| `ui.resume` | ui · ui | 0.22 | 1.00 / 0.63 | UiSounds | A brass steam valve opened: a gentle mechanical clunk and a short rising hiss of steam, quiet |
| `ui.run.over` | stinger · ui | 0.26 | 2.38 | RunHud | A single deep, low, sombre bell toll far away in a stone hall, long dark decay |
| `ui.summary.fallen` | stinger · ui | 0.24 | 2.46 | RunSummary | A soft low harmonium chord in a minor key, gentle and melancholic, slowly fading, no percussion |
| `ui.summary.victory` | stinger · ui | 0.24 | 2.22 | RunSummary | A soft warm harmonium chord swelling gently in a major key, brief, fading out, no percussion |
| `ui.tally` | ui · ui | 0.05 | 0.08 / 0.08 / 0.08 | Spells, RunSummary | A single tiny click of a brass mechanical odometer wheel, an extremely short tick, dry |
| `ui.toast` | ui · ui | 0.19 | 0.60 / 0.60 | UiSounds | A single light tap on a small brass desk bell, a very short soft ding, quiet, dry |
| **world** | | | | | |
| `body.bash` | impact · fx | 0.34 | 0.38 / 0.42 | RigidBodies | A heavy crate slamming into a creature, a blunt thump of impact, short |
| `body.burnout` | impact · fx | 0.30 | 0.75 | RigidBodies | Burnt wood collapsing into embers and ash, a soft crumble with a hiss |
| `body.drop` | player · fx | 0.12 | 0.31 | RigidBodies | An object gently released and dropped with a soft thump, short |
| `body.grab` | player · fx | 0.14 | 0.38 / 0.42 | RigidBodies | A quick magical grab: a soft snap of force, short |
| `body.impact.metal` | impact · fx | 0.30 | 0.48 / 0.33 / 0.45 | RigidBodies | An iron weight clanging against stone, a metallic clank, short |
| `body.impact.stone` | impact · fx | 0.34 | 0.39 / 0.29 / 0.27 | RigidBodies | A heavy stone block knocking against rock, a dull thud with grit, short |
| `body.impact.wood` | impact · fx | 0.30 | 0.39 / 0.28 / 0.34 | RigidBodies | A wooden crate thudding against stone, a hollow knock, short |
| `body.lift` | player · fx | 0.14 | 0.60 / 0.51 | RigidBodies | A telekinetic lift: a soft rising magical hum swell, short |
| `body.rip` | player · fx | 0.11 | 0.43 / 0.41 / 0.43 | RigidBodies | Old wood cracking under strain, a single creak and a small splinter crack, short |
| `body.smash.metal` | impact · fx | 0.38 | 0.77 | RigidBodies | An iron box crushed and burst open, a metal crunch and clattering pieces, short |
| `body.smash.stone` | impact · fx | 0.42 | 0.55 / 0.78 | RigidBodies | A stone block cracking apart into rubble, a crunchy rock break and debris, short |
| `body.smash.wood` | impact · fx | 0.42 | 0.62 / 0.56 | RigidBodies | A wooden crate smashed apart, splintering planks and scattering debris, short |
| `body.tear` | player · fx | 0.21 | 0.42 / 0.62 | RigidBodies | A wooden plank torn free from a wall with a loud splintering rip, short |
| `body.throw` | player · fx | 0.17 | 0.33 / 0.38 | RigidBodies | A heavy object flung with a strong whoosh, short |
| `boom.large` | explosion · fx | 1.27 | 3.24 / 2.98 | audio.boom() | A huge explosion in a vast underground cavern: a deep concussive boom, a long rumbling tail and falling rubble |
| `boom.medium` | explosion · fx | 0.95 | 1.30 / 1.51 / 1.49 | audio.boom() | A gunpowder explosion in a stone cavern: a punchy boom with rock debris raining down, medium tail |
| `boom.small` | explosion · fx | 0.67 | 0.75 / 0.68 / 0.74 | audio.boom() | A small explosion in a stone cave: a sharp bang with a short burst of debris patter, short tail |
| `corpse.bowl` | impact · fx | 0.49 | 0.65 / 0.66 / 0.58 | EventCues | A dead body hurled into a creature at speed: a heavy meaty smack, a bony crunch and a grunt of air knocked out, short, punchy, dry |
| `corpse.consume` | material · fx | 0.35 | 1.30 / 1.26 | EventCues | Flesh dropped into molten lava: a violent hiss and sizzle with popping, spitting bubbles, short |
| `corpse.dissolve` | material · fx | 0.27 | 1.40 / 1.40 | EventCues | Flesh dissolving in strong acid: an intense fizzing, bubbling, hissing foam, short |
| `corpse.freeze` | material · fx | 0.29 | 1.07 / 1.10 | EventCues | Frost racing over a body: quick crackling ice crystals forming, glassy creaks and a stiffening crunch, short, dry |
| `corpse.ignite` | material · fx | 0.32 | 0.71 / 0.95 | EventCues | A carcass catching fire: a sudden soft whoomph of flame, then crackling and spitting fat, short |
| `corpse.shatter` | impact · fx | 0.49 | 0.90 / 0.90 / 0.75 | EventCues | A frozen carcass smashed against stone: a sharp crack of ice and bone bursting apart and a shower of tinkling ice shards scattering, short, punchy |
| `corpse.splash` | material · fx | 0.32 | 0.96 / 0.72 | EventCues | A limp body belly-flopping into a pool of water: a flat heavy slap and a burst of splashing spray falling back, short |
| `corpse.thud.heavy` | impact · fx | 0.42 | 0.47 / 0.57 / 0.55 | EventCues | A heavy dead body slamming down onto a stone floor: a deep meaty thud with a crunch of grit and a short rattle of bones, short, punchy, dry |
| `corpse.thud.light` | impact · fx | 0.32 | 0.50 / 0.50 / 0.50 | EventCues | A small limp dead animal dropped onto a stone floor: a soft wet flop and thump, short, close-miked, dry |
| `corpse.twitch` | material · fx | 0.24 | 0.33 / 0.50 / 0.50 | EventCues | A dead limb jolted by electricity: a sharp crackling electric buzz and snap with a wet twitching slap, short, dry |
| `creature.dodge` | creature · voices | 0.10 | 0.48 / 0.44 | Enemies | A quick airy whiff of a creature leaping aside, short |
| `creature.generic.alert` | creature · voices | 0.29 | 0.48 / 0.46 | audio.alert(), creature(generic, 'alert') | A small cave creature's sharp alarmed chirp, short |
| `creature.generic.death` | creature · voices | 0.21 | 0.71 / 0.80 | audio.deathCry(), creature(generic, 'death') | A small cave creature's dying screech fading away, short |
| `creature.generic.hurt` | creature · voices | 0.17 | 0.48 / 0.44 | creature(generic, 'hurt') | A small cave creature's pained squeal, short |
| `creature.gib` | impact · voices | 0.46 | 0.70 / 0.66 | Enemies | A creature smashed against a wall: a wet meaty crunch and splatter, short |
| `creature.hit` | impact · voices | 0.24 | 0.48 / 0.48 / 0.15 | Enemies | A punchy hit on a creature: a short fleshy thwack, close-miked |
| `creature.hop` | creature · voices | 0.08 | 0.33 / 0.48 | audio.hop() | A small soft body landing and launching: a soft pat, short |
| `critter.chirp` | critter · ambience | 0.16 | 0.48 / 0.48 / 0.48 | audio.chirp() | A single cave cricket chirp, tiny and quiet, short |
| `critter.skitter` | critter · ambience | 0.08 | 0.38 / 0.46 / 0.47 | EventCues, audio.skitter() | A small beetle skittering quickly across stone, tiny dry clicks, short |
| `light.bloom.furl` | mechanism · fx | 0.17 | 1.03 / 0.93 | EventCues | Delicate glass petals folding shut: a dry crystalline creak and a soft descending tinkle, quiet, short |
| `light.bloom.open` | mechanism · fx | 0.42 | 1.03 / 1.29 | EventCues | Glass flower petals growing and unfurling: delicate crystalline tinkling rising and a soft airy shimmer blooming open, short |
| `light.bloom.petal` | mechanism · fx | 0.12 | 0.35 / 0.35 / 0.35 | lumenBlooms | A single tiny glass bell tink, delicate and bright, very short, dry |
| `light.dark` | material · ambience | 0.27 | 2.45 | EventCues | Stepping into a pitch-black cave: a low hollow hush as the air goes still and close, a faint deep sub rumble and one distant water drip, subtle, no music |
| `light.eyeshine` | mechanism · fx | 0.14 | 0.48 / 0.48 | EventCues | Two small animal eyes catching lamplight in the dark: a tiny bright glassy glint with a faint cold shimmer, very short, quiet |
| `light.photocell.latch` | mechanism · fx | 0.52 | 0.54 / 0.36 | EventCues | A brass lens clicking home as it fills with light: a crisp metallic latch, a bright glassy chime ringing out and a tiny crackle of sparks, short |
| `light.photocell.loop` ⟲ | loop · fx | 0.20 | 3.00 | Mechanisms | Continuous soft warm electrical hum of a brass lens gathering light, a faint singing glassy resonance, steady |
| `mat.acid.loop` ⟲ | loop · ambience | 0.20 | 3.00 | HabitatAudio (material scan) | Continuous acid fizzing and dissolving, a bubbling sizzle |
| `mat.bubble` | material · ambience | 0.22 | 0.36 / 0.39 / 0.48 | audio.bubble() | A single thick bubble bursting in a bubbling cauldron, blub, short |
| `mat.drip` | critter · ambience | 0.15 | 0.66 / 0.48 / 0.71 / 0.46 | audio.drip() | A single water drop falling into a still underground pool, a clear plink with a cave echo |
| `mat.electric.loop` ⟲ | loop · ambience | 0.20 | 3.00 | HabitatAudio (material scan) | Continuous electric crackling, arcing static buzz on metal |
| `mat.fire.loop` ⟲ | loop · ambience | 0.27 | 3.00 | HabitatAudio (material scan) | Continuous crackling bonfire, roaring flames and popping wood |
| `mat.fuse.loop` ⟲ | loop · fx | 0.27 | 3.00 | HabitatAudio (material scan) | Continuous black powder fuse burning, fizzing and sputtering sparks |
| `mat.hollow` | impact · fx | 0.42 | 0.31 / 0.60 | audio.hollowKnock() | A hollow knock on a thin stone wall with an empty cavity behind it, resonant, short |
| `mat.ignite` | material · fx | 0.29 | 0.63 / 0.84 | RigidBodies, audio.brazier(), audio.flame() | Fire catching with a whoosh, a brazier bursting into flame, short |
| `mat.lava.loop` ⟲ | loop · ambience | 0.27 | 3.00 | HabitatAudio (material scan) | Continuous thick bubbling molten lava, slow heavy gloops and a low hot rumble |
| `mat.shatter` | material · fx | 0.41 | 0.72 / 0.79 / 0.80 | audio.shatter() | Glass and ice breaking: a bright crack and a cascade of tinkling shards, short |
| `mat.sizzle` | material · fx | 0.12 | 0.60 / 0.60 | EventCues, audio.sizzle() | A small fire crackling and sizzling, short |
| `mat.splash.big` | material · fx | 0.22 | 0.78 / 0.80 | audio.splash() | A heavy body plunging into a deep pool, a big splash and slosh, short |
| `mat.splash.small` | material · fx | 0.10 | 0.60 / 0.60 / 0.59 | audio.splash() | A small object splashing into water, a short splash |
| `mat.squelch` | material · fx | 0.31 | 0.52 / 0.60 / 0.55 | audio.squelch() | A wet slimy squelch, gooey and organic, short |
| `mat.steam` | material · fx | 0.20 | 0.80 / 0.80 / 0.80 | audio.steam() | Water flashing to steam on hot lava: an airy sharp hiss, short |
| `mat.steam.loop` ⟲ | loop · ambience | 0.20 | 3.00 | HabitatAudio (material scan) | Continuous steam hissing from vents, a soft airy roar |
| `mat.water.loop` ⟲ | loop · ambience | 0.24 | 3.00 | HabitatAudio (material scan) | Continuous water flowing and trickling over stones in a cave |
| `mat.zap` | material · fx | 0.26 | 0.48 / 0.48 / 0.48 | audio.zap() | An electric arc zap: a sharp crackling buzz, short |
| `mech.buoy` | mechanism · fx | 0.35 | 0.72 | Mechanisms | A float rising in water with a glug and a brass lever clank, short |
| `mech.cauldron` | mechanism · fx | 0.31 | 1.20 | Brewing | A cauldron brew completing: a rich bubbling surge and a bright magical chime pop |
| `mech.counterweight` | mechanism · fx | 0.38 | 1.00 | Mechanisms | A heavy iron counterweight dropping with a rattling chain and a deep clunk |
| `mech.dispenser` | mechanism · fx | 0.28 | 0.42 | Mechanisms | A hatch dropping open and a crate tumbling out with a thud, short |
| `mech.door` | mechanism · fx | 0.38 | 1.30 / 1.44 | audio.doorGrind() | A heavy iron door grinding along stone rails, a rumbling scrape ending in a clank |
| `mech.grip` | mechanism · fx | 0.24 | 0.46 | Mechanisms | A gloved hand gripping a cold iron handle, a leather squeak and a metal tap, short |
| `mech.groan` | mechanism · fx | 0.32 | 1.42 / 1.42 | audio.groan() | A large broken machine groaning: a deep metal creak and strained grinding, ominous |
| `mech.latch` | mechanism · fx | 0.35 | 0.15 | Mechanisms | An electrical relay snapping shut: a metallic clack with a sharp electric zap, short |
| `mech.lever` | mechanism · fx | 0.22 | 0.60 / 0.60 | audio.lever() | A heavy iron lever thrown with a ratcheting clunk, mechanical, short |
| `mech.plate` | mechanism · fx | 0.16 | 0.60 / 0.60 | Mechanisms | A stone pressure plate pressed down with a deep click and a mechanical thunk, short |
| `mech.plug` | mechanism · fx | 0.38 | 0.79 | Mechanisms | A stone plug cracking and crumbling apart, rock debris falling, short |
| `mech.relay.arm` | mechanism · fx | 0.24 | 0.60 | Mechanisms | A clockwork mechanism winding and ticking, short |
| `mech.relay.fire` | mechanism · fx | 0.35 | 0.60 | Mechanisms | A spring-loaded mechanism releasing with a sharp clack and a whirr, short |
| `mech.rune` | mechanism · fx | 0.38 | 1.37 | Mechanisms | A magic rune struck: a resonant shimmering chime rising, with a distant deep stone rumble |
| `mech.scale` | mechanism · fx | 0.35 | 0.77 | Mechanisms | A heavy brass weighing scale tipping with a clank and a chain rattle, short |
| `mech.sensor` | mechanism · fx | 0.24 | 0.38 | Mechanisms | A soft brass mechanism tick engaging, short, quiet |
| `mech.sequence.fail` | mechanism · fx | 0.35 | 0.60 | Mechanisms | A sour mechanical buzz and a clunk of gears resetting, short |
| `mech.sequence.step` | mechanism · fx | 0.35 | 0.60 | Mechanisms | A single clear brass chime tone, bright and short |
| `mech.shrine` | mechanism · fx | 0.24 | 1.00 | Mechanisms | A soft warm humming chime of a small shrine, gentle and quiet, short |
| `mech.vault` | mechanism · fx | 0.38 | 0.84 | Mechanisms | A heavy vault door unsealing: a hiss of air, bolts retracting and a deep stone rumble |
| `organism.fish.flop` | critter · ambience | 0.10 | 0.30 / 0.30 | Critters | A small fish flopping once on wet stone, a tiny wet slap, short, close-miked |
| `organism.fish.scatter` | critter · ambience | 0.15 | 0.65 / 0.51 | EventCues | A small school of fish darting away underwater: a quick muffled flurry of fins and a burst of tiny bubbles, short |
| `organism.moth.swarm.loop` ⟲ | loop · ambience | 0.17 | 3.00 | HabitatAudio | Continuous soft papery fluttering of many small moth wings close by, delicate and dry |
| `proj.fireball.loop` ⟲ | loop · fx | 0.24 | 3.00 | HabitatAudio (in flight) | Continuous whooshing roar of a small fireball flying through the air |
| `tk.fizzle` | player · fx | 0.19 | 0.70 / 0.55 | EventCues | A magical grip failing: a brass wire snapping loose with a sputtering electric fizzle and a hollow click, short, dry |
| `tk.grab` | player · fx | 0.23 | 0.70 / 0.70 | EventCues | A telekinetic seize: a quick taut brass wire twang and a soft airy tug of force pulling something heavy off the ground, a faint magical shimmer, short, close, dry |
| `tk.hold.loop` ⟲ | loop · fx | 0.19 | 4.00 | EventCues | A soft steady resonant hum of a taut brass wire vibrating in still air, a faint glassy shimmering overtone and a low tremor of strain, quiet, continuous |
| `tk.hurl` | player · fx | 0.28 | 0.40 / 0.54 / 0.41 | EventCues | A leather whip crack followed immediately by a heavy rushing whoosh of air, a body flung hard through the air, short, punchy, dry |
| `tk.release` | player · fx | 0.14 | 0.60 / 0.60 | EventCues | A taut brass wire going slack: a soft descending shimmer and a small sigh of released air, short, quiet, dry |
| `tk.strain` | player · fx | 0.21 | 1.10 / 0.72 | EventCues | A small brass instrument straining against an enormous weight: a creaking metallic groan and a trembling hum that gives up, short, dry |
| `world.gong` | mechanism · fx | 0.90 | 2.88 / 2.88 | audio.gong() | A deep bronze gong struck once, rich overtones, a long rolling decay through caves |
| `world.portal` | mechanism · fx | 0.70 | 2.16 | audio.portalWhoosh() | A great stone gate unlocking: a deep resonant bell ringing in a lock, then heavy stone grinding open under a rising magical whoosh |
| `world.waystone` | stinger · ui | 0.44 | 1.00 | Levels | Two bright clear chime tones rising, a small magical confirmation, short |
<!-- cue-table:end -->
