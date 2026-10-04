# Adaptive CPU pursuit and combat

The CPU now plans a complete platform approach and learns from observed outcomes during a match. Difficulty is selectable per CPU seat in the Duel lobby. Arena's existing AI level controls use the same tiers.

## Movement

- Upper platforms offer direct upward routes through their one-way collision surface, with separate ascent columns and the existing route around the lip as an alternative.
- Each climb reserves a full fuel tank before takeoff. The CPU walks to the launch point while recharging, then commits until it lands, is interrupted, or the route fails.
- Route outcomes are keyed by opponent, source/destination surfaces, and target location. Failed routes lose preference; two failures exclude that variant in the unchanged situation. A timer does not silently restore the same failed plan.
- Route selection considers travel distance, landing position, previous success/failure, and small seeded variation. It chooses once per route leg, avoiding frame-by-frame direction noise. An incoming hit cancels the plan without teaching that the geometry is impassable.

## Learning and combat

Successful melee attacks and wand casts earn credit from actual `fighterHit` events after the CPU's observation delay. A recent successful approach also receives credit when it leads to a hit. A swing or cast that never connects earns a failure after a bounded confirmation window. Hitstop is included in that window; interrupted attempts are discarded. The CPU waits for an unresolved move's outcome instead of spamming the same attempt.

Melee choices use reach, predicted target movement, relative height, stagger, fighter personality, learned outcomes, and weighted variation. The former fixed “every fourth attack is a finisher” pattern is removed. Illegal or twice-failed moves are excluded before selection. Successful moves may be reused.

Memory holds at most 128 contextual outcomes and 16 pending attacks. It stays through stock losses and clears for a new match/rematch. It is not written to disk and does not train a shared model or carry hidden player knowledge into another session.

| CPU level | Lobby label | Learning strength |
| --- | --- | --- |
| 1 | Gentle | 0.20 |
| 2 | Easy | 0.35 |
| 3 | Normal | 0.50 |
| 4 | Hard | 0.70 |
| 5 | Expert | 0.85 |

These levels also retain the existing reaction, prediction, aim and decision cadence settings. `ai tier <level> adaptation <0..1>` tunes learning strength; `ai reset` restores defaults. Failed-route protection applies at every difficulty.

## Verification

- `node scripts/verify-stock-platform-pursuit.mjs <dev-url>`: 18 mirrored below-platform fixtures, three starting positions and three fuel states. The previous CPU failed the empty-fuel edge cases within the 420-tick limit. The new CPU landed beside the stationary target in 109–157 ticks. A nineteenth fixture inserts a solid obstruction during the ascent; the CPU changes route and lands in 341 ticks. The target is invulnerable to isolate navigation from knockback.
- `node scripts/verify-stock-stationary.mjs <dev-url>`: the earlier opposite-platform regression, using normal combat and an idle human.
- `node scripts/verify-stock-learning.mjs <dev-url>`: visible desktop/mobile difficulty selection, real attacks producing learned outcomes, retention through stock loss, and reset on rematch. The final sample used all four melee kinds, recorded 11 learned hit outcomes, retained them through a stock loss, and cleared them on rematch.
- Unit tests cover fuel reservation, ascent/landing, repeated failure exclusion, contextual credit assignment, missed/interrupted moves, actual difficulty-scaled choice frequencies, alternate routes, and lobby difficulty boundaries.

The bounded fixtures establish these behaviors; they do not prove that every destructible stage layout or matchup has an escape route. If every known route fails, the CPU holds and reassesses instead of repeating a third identical failed attempt.
