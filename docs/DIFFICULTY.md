# Difficulty — the ladder

`config/difficulty.ts` has always defined four tiers (Apprentice I, Adept II,
Conjurer III, Archmage IV: enemy count, damage, HP, speed and sense, and the
alchemist's HP; III is "the shipped balance", 1.0 across the board). Until
2026-09-29 a player run was hard-wired to II (`Game.ts`: `difficulty: 2`) and only
the authoring run launcher could pick another, so there was no harder game after a
win and no easier one for someone who was struggling.

## The rules (`config/difficultyLadder.ts`, pure)

- A descent is **Adept** unless the player chose otherwise.
- **Apprentice is always open.** An easier road is never a reward to be earned.
- Every tier above Adept opens when the Kiln is quieted **on the tier below it or
  harder**: a win on Adept opens Conjurer; a win on Conjurer opens Archmage. A win
  on Apprentice opens nothing above Adept.
- **The daily descent is always Adept** and does not move the remembered choice: it
  is one seed for everyone, so it must be one difficulty for everyone.

## Where it lives

| Piece | File | Notes |
| --- | --- | --- |
| What each tier does | `config/difficulty.ts` | unchanged |
| Who may pick which; blurbs; unlock hint | `config/difficultyLadder.ts` | `unlockedDifficulty`, `openDifficulty`, `tierOpenedByVictory`, … |
| Persistence | `game/MetaProfile.ts` | `bestVictoryDifficulty` (0 = never), `lastDifficulty`; no version bump (fields default). A profile with wins but no ladder data has won on Adept (that was the only tier) |
| Start a run at a tier | `game/RunDirector.ts` `startNewRun({ difficulty })` | a locked pick reads as Adept; `chooseDifficulty` remembers an open one |
| The ledger | `RunSummary.difficulty`, `RunResult.unlockedDifficulty` | the header names a tier other than Adept; the share line says `Breathing Works — Archmage — Floor 3/4 …` |
| Title screen | `ui/DifficultyPicker.ts` in `ui/ExpeditionEntry.ts` | one compact row: label, four numeral chips, the chosen tier's name and line |
| Ledger | same picker in `ui/RunSummary.ts` | beside the kit picker in a two-column `.rs-choices` grid, so it costs no height |
| Resume | `game/Levels.ts` | the expedition save already carried `difficulty` |

A victory that opens a tier announces it in the ledger's unlock row ("A harder
Works: Conjurer (III) is open") and lights the new chip.

## Fit (why it is one row)

The title's column has room for about one extra row on a 720p window. A first
version that was a second kit picker (label, chips, note) cost 133 px and pushed
the trailer button under the fold at 1280×720; the shipped row costs 48 px. The
ledger already scrolls on windows under ~700 px, so the picker sits beside the kit
picker (the taller of the two) instead of under it — measured identical to before at
1440×810, 1100×700 and 1024×640. The unlock grid holds four cards across so a first
victory (three kits plus a tier) is still one row at 1600×900.
`.difficulty-chip` reuses the kit chip's styles (`.kit-chip`); code that selects
kit chips must say `.kit-chip[data-kit]` (`verify-run-lifecycle` does).

## Verifying

`npx vitest run tests/difficulty-ladder.test.ts tests/meta-profile.test.ts
tests/run-rules.test.ts tests/run-director.test.ts` (the rules, migration, unlocks,
share line, and the director starting at the right tier), and
`node scripts/verify-difficulty-ladder.mjs` with a dev server running: real clicks
on a locked chip (refused, says how to earn it), Apprentice really changes the run
(alchemist HP), the ledger names the tier, a victory opens Conjurer and the ledger
announces it, "Descend again" carries the tier, a remembered tier survives a reload,
and the daily is Adept whatever was chosen.

## Not done

The tier numbers themselves have not been playtested by a human on this build —
Conjurer and Archmage are the authored multipliers, gated behind a win, and
`verify:combat-balance` is the instrument for tuning them.

# Complications (run mutators) — one set of floors, many runs

*Added 2026-10-01 (the "more fun" round, pillar 4).* A **complication** is a standing regulation the Guild
has issued for the whole of a descent. It changes how the floors *behave*, never what they *are*: it is
runtime-only (no generated output changes, no `GEN_VERSION` bump), deterministic per seed, and never
hard-locks a run. It is **not a boon**: `player.perks` belongs to the Sanctum (Pell and the pause menu read
it), so a complication lives on the run (`RunSaveState.mutators`, mirrored on `ctx.state.mutators`).
Up to three at once. The player-facing word is **Complications**; the code says mutators.

## The catalog (`content/mutators.ts`, `MUTATOR_DEFS`)

`weight` is the load it puts on the descent (+1 harder, ±0 a trade, −1 easier); the title's total is the
sum. `ladder: false` means a win under it does **not** count toward opening the next tier.

| Id | Name | What the grid does | Weight | Ladder |
| --- | --- | --- | --- | --- |
| `wet-floors` | Wet Floors | closed puddles at the low points of the walk + a drip overhead (real water cells); damp fuel (flammability ×0.55): a spark in a puddle crawls through it and shocks a wet alchemist | ±0 | yes |
| `tinderbox` | Tinderbox | every fuel's flammability ×2.4 (probe: a flame that fizzles at ×1 runs the whole plank) | +1 | yes |
| `slime-rain` | Slime Rain | slime drips from ceilings along the route (real slime cells; fire turns them to acid) | +1 | yes |
| `gas-leak` | Gas Leak | marsh-gas vents in floors along the route (real gas cells; a flame is a racing front) | +1 | yes |
| `glass-cannon` | Glass Cannon | alchemist's HP ×0.5, the alchemist's blows ×1.5 | +1 | yes |
| `low-gravity` | Low Gravity | gravity ×0.55: jump apex ×1.8, a drop ×1.3 slower; the levitation jet scales with it so it stays a hover instrument | −1 | **no** |
| `crowded-house` | Crowded House | foes ×1.5 per floor, bounty ×1.4 | +1 | yes |
| `dark-works` | Dark Works | ambient ×0.6 and a **darkness floor** of 0.7 under every campaign floor's designed darkness | +1 | yes |
| `famine` | Short Rations | healing ×0.5 (read where heals meet: the health itself) | +1 | yes |
| `fireworks` | Fireworks | a fallen creature bursts after a short fuse; the burst hurts what is near it (the alchemist included) and can chain | ±0 | yes |
| `hush` | Hush | creatures notice from half as far | −1 | **no** |
| `nosy-neighbours` | Nosy Neighbours | creatures notice from half again as far | +1 | yes |

`hush` and `nosy-neighbours` conflict (they would cancel): a set never holds both (`cleanMutators` keeps the
first in canonical order; the title swaps one for the other and says so; a bargain is never offered one that
conflicts with what is in force).

## How it is wired (read this before adding one)

| Piece | File | Notes |
| --- | --- | --- |
| Registry, arithmetic, daily table, bargain rules | `content/mutators.ts` | pure: no Ctx, DOM or cells. `composeMutatorMods` multiplies dials (`darkness` composes by max) |
| Effective-mods layer | `config/difficulty.ts` `difficultyMods` | folds a run's complications into the tier's multipliers (count, HP, damage, speed, sense, alchemist HP); with none it returns the tier object itself, untouched |
| The runtime | `game/MutatorDirector.ts` (`ctx.mutators`) | the per-run tuning clone, vents and drips, Short Rations, Fireworks, the notice toast |
| Floor dressing | `game/mutatorDressing.ts` | pure over a `World` + seed: a TAIL pass on a finished floor |
| Run state | `game/RunDirector.ts` | `mutators` / `bargains` on `RunSaveState` (optional, sanitized, no version bump); the daily takes its date's |
| Title / ledger | `ui/ComplicationsDisclosure.ts`, `ui/RunSummary.ts`, `styles/complications.css` | a `<details>` fold like the seed's; chip row on the ledger; pause row; share-line part |
| Sanctum bargain | `ui/SanctumBargain.ts` + a few lines in `ui/Sanctum.ts` | see below |
| Console | `game/console/mutators.ts` | `mutator [list\|add\|remove\|set\|clear]` (authoring builds); **changing the set taints the run** |

**The tuning clone.** Fuel and light are read from `ctx.params.materials` / `ctx.params.global`, which are the
shared tuning singletons (`config/params`): `config/tuningStore` diffs them and saves the diff as the player's
own tuning (`ad:tuning:v1`) on every change and on page hide, so writing them would leak a run's complication
into the next boot. The director swaps `ctx.params` for a **per-run clone** while a descent is played and puts
the original objects back when the run ends or play mode is left (the title, the Workshop, the Builder). The
singletons are never written (`tests/mutator-director.test.ts` flushes the tuning store; the probe fires
`pagehide` and reads `ad:tuning:v1`).

**Where the multipliers sit.** Glass Cannon's ×1.5 is applied in `Enemies.damage`, to a *direct* or *bowled*
blow, **after** the wand compiler's ×4 damage clamp: a wand still compiles to at most ×4, and this is a
separate multiplier on top of whatever it compiled to (so it is not subject to the clamp, by design, and
nothing else in the compiler sees it). The gravity dial reaches `Player.ts` (0.28 / 0.12 become
`0.28 × dial`; the swing and the levitation thrust follow it), the Rapier world (`gravity` and the buoyancy
term, so a prop still floats) and the knock arc (`KNOCK_GRAV`). The kill bounty reads its dial in `dropBounty`.
The darkness floor is read by `core/darkness.darkMapFor(runtime, lift)` (called from `Lighting` and
`LightQuery`), so the lantern's reach, a creature's sight, the eyeshine and the comfort curve all follow it.

**Dressing** is planned from the floor's PRISTINE cells on **both** `createLevel` and `restoreLevel`, from a
fork of the level seed (`hashSeed(levelSeed, 'mut:' + id + ':' + kind)`, never `ctx.state.worldSeed`, which every
generate overwrites). Puddles are written once, as real water cells, when a floor is created (a restored floor
has them in its saved cells); vents and drips are runtime emitters re-derived on restore (the saved level
regenerates pristine and overlays its cells, so an emitter list cannot ride the save). Puddles go in real
closed basins on the walk (a region of empty cells at or below a surface row, bounded on every side, 14-110
cells, a floor the alchemist can stand on); the dressing is traced before and after against the body-fit reach
from the spawn and **reverted whole** if it costs the walk a single position (`applyPuddles`). Swept on seeds
11/22/33 × d2/d3/d4: 3-6 puddles on the marsh and the cisterns, 0-1 on the Kiln (few basins; the vents still
stand), 4-8 vents everywhere, ~60 ms to plan and ~100 ms to write, behind the descent curtain.

## Choosing, showing, and the daily

- **Title:** the *Complications* fold, closed it is one line on the seed fold's row (no extra height on a short
  window); open it is the chips (each with its weight), the regulation under the pointer, the total and whether
  a win under the set counts toward the next tier. Checked at 960×600, 1280×720 and 1440×900 (`verify-mutators`
  `title`); the choice is remembered in the meta profile (`lastMutators`) and "Descend again" starts from it.
- **Shown:** a Notice toast when the descent begins ("Notice posted: … in force"); the first time the alchemist
  nears each kind of vent, one line saying what it is and what it does (instruction first); the pause menu's
  *Complications* row; the ledger's chip row (tooltips carry the regulations); the share line, after the tier
  (`Breathing Works — Wet Floors + Low Gravity — Floor 3/4 …`). A run without any keeps its line **byte for byte**
  (`tests/run-rules.test.ts`).
- **The daily** carries the complications its **date** names and ignores the player's choice (the same rule as
  the kit and the tier): a pure function of the date and `DAILY_ERAS`, an **append-only** table (the rule is
  written at the top of the table: never edit, reorder or remove an era or an entry; to change the rotation,
  append an era with a later `from`; a date before the first era carries none). A test pins the shipped rotation.
  The first era starts 2026-10-01.

## The Sanctum's bargain

Between floors the old ones offer **one** complication for the rest of the descent and **a second boon** in
return (take two of the three). Only a complication that *hardens* the descent (weight ≥ 1) is ever offered, so
the trade is a real one; not one already in force or conflicting with one that is; not past three. The offer is
a pure function of the expedition seed, the floor and what is in force (`bargainOffer`), so a reload cannot
reroll it; one per floor (`RunSaveState.bargains`); **never on the daily** (one descent for everyone). Striking
it activates the larger set at once, records it on the run (the ledger, a resume and the meta policy below all
read it) and takes the alchemist's health with the HP dial if it moves (Glass Cannon). The floors already built
keep what they were (dressing is laid when a floor is created); the next floor is dressed.

## Meta policy (decided 2026-10-01; tests in `tests/meta-profile.test.ts`)

A descent under complications is a **real run**: saved, credited, recorded (unlike a console-tainted one).

| Question | Decision |
| --- | --- |
| Does a win count? | Yes: the victory, the best floor, the run count and the kit it earns (a win opens the Storm case) |
| Does it open the next tier? | Only if **every** complication in the set has `ladder: true`. An easing one (Low Gravity, Hush) — alone or beside a hard one — never opens a tier: an easy mutator on Adept must not open Conjurer. A win still lowers nothing already open |
| `fastestVictoryMs` | **Excluded.** A mutated win never sets it (a Low Gravity run is not a record for the Works as issued). Not a separate record: a second personal best was more UI for a figure nobody reads |
| `dailyBests` | **Untouched**: per date, and the date fixes its complications (the table is append-only), so a date's best stays comparable. A daily whose date names an easing complication does not open a tier, for the same reason as above |
| Console `mutator add/remove/set/clear` | **Taints** the run (no save over a real expedition, no ledger credit, no unlocks); `mutator list` never does |
| The title's remembered choice | `lastMutators` (cleaned, canonical order); the daily neither reads nor disturbs it |

## Verifying

`npx vitest run tests/mutators.test.ts tests/mutator-dressing.test.ts tests/mutator-director.test.ts
tests/run-mutators.test.ts tests/console-mutator.test.ts tests/dark-lift.test.ts tests/meta-profile.test.ts`
(the registry, the dials, the append-only daily, the dressing on a hand-built cave including a deliberately
walling dressing that must revert, the clone and the leak, the run plumbing, the policy), and
`node scripts/verify-mutators.mjs [url] [sections]` with a dev server running: every complication **played**
with real input and its observable effect asserted (puddles that conduct and shock, slime and gas from real
vents, planks that burn far further under Tinderbox, a jump measured per tick, half the health and a real shot
at ×1.5, a floor's population and its bounty, the canvas's mean luminance, a healium pool at half strength, a
firework chain, notice distance), then nothing leaking (tuning, `ad:tuning:v1`, the next run, a reload), a save
resumed (a reload and a cold Continue) with the floor's vents back exactly, the pause menu and ledger, the
daily, the meta policy, and the Sanctum's bargain with real clicks.

## Not done / honest notes

- No complication is itself *rewarded* (a "mutated victory" badge, a leaderboard): the reward is the different
  run. Easy complications exist (Low Gravity, Hush) as a toy, not a ladder.
- Wet Floors' flammability ×0.55 is the weakest part of it: wood in the shipped game is already at the edge of
  extinction (a flame at its end barely spreads), so damp fuel changes little that can be *felt*; the puddles and
  the shock are what the player meets.
- A bargain cannot be undone, and one struck and then abandoned (the tab closed in the Sanctum before the next
  autosave) is lost with the boon taken beside it.
- The numbers have been measured with probes, not playtested by a human: the weights (+1 each) are a guess.
