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
