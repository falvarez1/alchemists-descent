# Balance pass 01

Generated 2026-10-02T04:37:11.960Z by `scripts/fight-tune.mjs`. Basis: level-3 basic bots, every ordered pair, 6 seeds, round 12. Level-3 `basic` bots, every ordered pair, both sides.

## What moved

| fighter | start | tuned | change (dealt) |
|---|---|---|---|
| ilyra-voss | dealt 1.05 | dealt 1.429 | dealt 36% |
| brann-rook | dealt 1.1 | dealt 0.467 | dealt -58% |
| sable-fen | dealt 1 | dealt 1.356 | dealt 36% |
| mara-quell | dealt 0.95 | dealt 1.69 | dealt 78% |
| kest-rel | dealt 1 | dealt 1.317 | dealt 32% |
| nox-calder | dealt 1 | dealt 1.381 | dealt 38% |
| edda-morrow | dealt 1 | dealt 0.375 | dealt -63% |
| selene-wraith | dealt 1 | dealt 1.247 | dealt 25% |
| rusk-emberjaw | dealt 1.1 | dealt 1.475 | dealt 34% |
| father-thorne | dealt 1 | dealt 0.522 | dealt -48% |

## Win rates

| fighter | before | after (last round) | validated (1080 fights) |
|---|---|---|---|
| ilyra-voss | 41% | 48% | 49% (42%-55%) |
| brann-rook | 93% | 58% | 56% (50%-63%) |
| sable-fen | 36% | 54% | 52% (45%-58%) |
| mara-quell | 17% | 43% | 43% (37%-50%) |
| kest-rel | 31% | 43% | 44% (38%-51%) |
| nox-calder | 43% | 55% | 52% (45%-58%) |
| edda-morrow | 94% | 46% | 53% (46%-59%) |
| selene-wraith | 44% | 49% | 54% (47%-60%) |
| rusk-emberjaw | 23% | 50% | 48% (42%-55%) |
| father-thorne | 80% | 55% | 49% (42%-56%) |

## Round by round (worst fighter, points from 50%)

| round | worst | ilyra | brann | sable | mara | kest | nox | edda | selene | rusk | father |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | 44 | 41 | 93 | 36 | 17 | 31 | 43 | 94 | 44 | 23 | 80 |
| 2 | 44 | 29 | 87 | 38 | 24 | 41 | 31 | 94 | 39 | 36 | 81 |
| 3 | 43 | 41 | 80 | 30 | 30 | 42 | 35 | 93 | 26 | 47 | 78 |
| 4 | 18 | 44 | 68 | 48 | 39 | 46 | 48 | 63 | 56 | 44 | 43 |
| 5 | 12 | 52 | 43 | 53 | 49 | 38 | 48 | 58 | 53 | 56 | 50 |
| 6 | 15 | 49 | 61 | 45 | 44 | 54 | 49 | 43 | 47 | 44 | 65 |
| 7 | 16 | 54 | 37 | 65 | 54 | 50 | 48 | 60 | 45 | 53 | 34 |
| 8 | 11 | 43 | 55 | 39 | 57 | 53 | 57 | 48 | 52 | 45 | 51 |
| 9 | 15 | 64 | 48 | 52 | 49 | 50 | 35 | 46 | 52 | 54 | 50 |
| 10 | 8 | 42 | 42 | 51 | 48 | 53 | 54 | 47 | 56 | 56 | 53 |
| 11 | 8 | 49 | 53 | 48 | 46 | 56 | 53 | 42 | 48 | 53 | 52 |
| 12 | 8 | 48 | 58 | 54 | 43 | 43 | 55 | 46 | 49 | 50 | 55 |

## Pinned at a limit

None: every knob the tuner turned had room.

## To apply

Read the table, then write the tuned numbers into `src/content/fighterBodies.ts` (the tuner never edits the source) and commit them with this file as the evidence:

```json
{
  "body.ilyra-voss.dealt": 1.429,
  "body.brann-rook.dealt": 0.467,
  "body.sable-fen.dealt": 1.356,
  "body.mara-quell.dealt": 1.69,
  "body.kest-rel.dealt": 1.317,
  "body.nox-calder.dealt": 1.381,
  "body.edda-morrow.dealt": 0.375,
  "body.selene-wraith.dealt": 1.247,
  "body.rusk-emberjaw.dealt": 1.475,
  "body.father-thorne.dealt": 0.522
}
```

## Notes on this pass (by hand)

- **Rules in force** (`config/arenaRules.ts`): `blowScale` 0.4, `hazardScale` 0.35, `invulnTicks` 10, `healthEquality` 0 (the designed health
  stands); a blast is capped at 42 on a fighter; each fighter carries its signature loadout (`fighterLoadouts`); level-3 `basic` bots on the Duel
  Stage; median fight 17 s. A different rule set is a different pass.
- **What the numbers say about the roster.** The wall hits softly and the glass cannon hits hard, which is the archetype trade the bodies were
  designed around: Brann 0.47 (and the most health), Mara 1.69 (and the least in her class). **Two numbers are warnings, not answers:** Edda at 0.375
  and Thorne at 0.52 mean their *loadouts* are too strong (Edda's is the premium void frame with a pair of piercing lances: its damage per second
  in a fight was three times the others'), so their `dealt` is doing the work a weaker weapon should. The next pass should give them lighter
  frames (the `loadout-sweep` tool), pull their `dealt` back toward 1, and re-tune.
- **Validation.** 1,080 fights (every ordered pair x 12 seeds): every fighter between 43% and 56%, no flag, one lopsided matchup. The tuner's last
  round had every fighter between 43% and 58%; the intervals overlap, so the roster is balanced to about +-7 points, not better. A fighter's
  win rate over a roster is not its win rate against a *person*: the bot cannot kite or dodge, so a close-range style (Brann, Rusk) is favoured
  by it, and the numbers above are the bot's. They are the baseline to re-measure when the bot gets playbooks.
- **What was NOT balanced:** the tactical and the ultimate (each fires about once a fight and deals almost nothing: see `dead-ability` in the
  report), the second wand (no bot swaps), movement techniques (a bot does not use them), and anything a person does that a bot does not.
