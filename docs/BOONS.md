# Boons — the Sanctum's bargains

Below floors 1–3 the Sanctum (`ui/Sanctum.ts`) drafts **one of three** boons and,
where the stair forks, a door — chosen together on the same screen. Three
sanctums a run, three boons a run, from a pool of 16 (`content/perks.ts`,
`PERK_DEFS`; a boon is a `PerkId` flag on `player.perks`, saved with the
expedition; `Vitality` is the one instant boon and is not a flag).

## The draft

`draftBoons` (`content/perks.ts`, called from `ui/Sanctum.ts`) is a pure function of
the run's seed and the floor: a reload cannot reroll the table, and a daily descent
offers everyone the same one. A boon with `worth` is only eligible while one of
those floors is a door below, so the situational ones are never dead cards:

| Sanctum (doors below) | Situational boons on the table |
| --- | --- |
| after floor 1 (Rot Gardens / Cold Store) | Warm Blood |
| after floor 2 (Cisterns / Glass Galleries) | Rime Soles, Insulated Boots |
| after floor 3 (Kiln Heart) | none |

With no doors known (a test arena) everything is eligible.

## Two kinds

**The originals (10):** Power Surge, Vampirism, Featherweight, Mana Font, Swift
Foot, Torchbearer (review kit only), Blast Shield, Pyro Skin, Toxicology, Gold
Sense — flat stat rules.

**The alchemist's bargains (6, added 2026-09-29):** boons that change *how the
world is met* rather than how big a number is. The design rules they were held to:

1. **The grid or the ledger explains it.** Each reads real cells or the
   alchemical-kill ledger; nothing is a hidden multiplier with no cause on screen.
2. **Legible against a door.** The draft and the door choice share a screen and the
   door text names each floor's chemistry, so *Warm Blood* ↔ the Cold Store and
   *Rime Soles* / *Insulated Boots* ↔ the Drowned Cisterns are decisions, not
   guesses. A boon may be situational if its situation is announced.
3. **Never a trap in the wrong room.** The draft only offers a situational bargain
   when its floor is a door below (`worth`), and a bargain whose trigger a floor
   barely has fails outright — see "Measured" below for the one that did.
4. **Feedback is existing feedback.** No new audio: the chill's `chillMoment`
   events (audio/EventCues) already creak and glint; nothing here spends
   ElevenLabs credit.

| Boon | Rule | Hook (the one place it lives) | Tuning |
| --- | --- | --- | --- |
| **Rime Soles** | Water under the boots skins over with thin rime ice: a pool is a road. Thaws after ~16 s, but never while stood on. | `game/Chill.ts` `rimeSoles` (reuses the wader's-wake `freeze`/skin/thaw machinery, shares `MAX_SKINS` 160) | `SOLE_REACH` 4 cells below the feet; footprint ±5; scans every 2nd tick |
| **Long Fuse** | Alchemical chains last twice as long, and the gold bonus climbs to ×4. | `combat/AlchemyKills.ts` (`windowTicks`, `alchemyBonusGold(…, maxSteps)`) | window 180 → 360 ticks; bonus cap ×3 → ×4 (`LONG_FUSE_*`) |
| **Velvet Hood** | Hooded, darkness counts 1.6× deeper: dim places hide you like deep dark. A lamp-lit room still lights you (the existing rule, `light-response.test.ts`). | `creatures/lightResponse.ts` `playerVisibility` | `SIGHT.velvet` 1.6 (`config/darkness.ts`) |
| **Insulated Boots** | Current deals 75% less (the conductor arc still crawls). | `entities/Player.ts` status block, on `fairShockDamage` | ×0.25 of the fair shock share |
| **Warm Blood** | Cold arrives at half strength: the grid's cold, a frozen place's air, and frost blows. | `game/Chill.ts` `update` input scaling | ×0.5 on `cold`, `impulse`, `ambientFloor` |
| **Sexton's Grip** | The wand's grip on the fallen costs half (grab, hurl, the weight share of holding) and hurls leave 25% faster. | `combat/Telekinesis.ts` (`gripCostK`, `SEXTON_COST_K` / `SEXTON_HURL_K`) | ×0.5 costs, ×1.25 speed. Holding still cancels the wand's regeneration **in full** — scaling that too makes a held body pay the wand back (net mana gain) |

The pause menu lists boons taken (`Boons` row, `ui/PauseOverlay.ts`): the draft
leaves the screen the moment it is struck, and nothing else shows it.

## Measured (why some ideas are not here)

Dev-server census, seeds 5 and 9, `run test --level <id> --world campaign-level`:

- **Steam is not a usable trigger.** A "Steamfitter's Lung" (steam mends you) was
  built and tested first. Steam cells live 25–30 ticks; water over lava makes
  *stone*, not steam; a burning oil slick on water made **none** over 900 ticks;
  lava beside water peaks at ~9 steam cells in the alchemist's body sample and
  averages ~1. A boon that needs steam would almost never fire. It was cut.
- **Open water surfaces (≥ 8 wide) per floor:** d1 6 pools; d2 0; d2b 0; d3 31–40
  (mostly small; 74–273 cells with standing headroom); d3b 2; d4 0 (its liquid is
  lava). Rime Soles is therefore a *Cisterns* boon by construction — which is why
  rule 2 matters. The Cisterns' pools are also **covered in floating glow-leaf**:
  the first version required bare air above the water and never froze a single
  cell there (found only by walking a real Cisterns pool, not the arena).
  `game/Chill.ts` `passable` treats soft growth as air.
- **Liquids on the surface, by floor:** oil is everywhere on d2/d2b/d3b (18–30
  runs); brine only on d2b; one 88-cell acid pool appears on every floor.

## Verifying

`npx vitest run tests/boons.test.ts tests/alchemy-kills.test.ts tests/telekinesis.test.ts`
(rules, plus mutation-checked system tests on a real `World`), and
`node scripts/verify-boons.mjs` against a running dev server: walks a real pool on
ice with real key input (and swims it without the boon), lifts a real corpse with a
real `E` press for half the mana, shocks a charged pool with and without the
Insulated Boots, and strikes a bargain through the Sanctum and reads it back in the
pause menu. Long Fuse / Velvet Hood / Warm Blood are pure rules and are covered by
the unit tests.
