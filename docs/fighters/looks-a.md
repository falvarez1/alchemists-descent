# Looks, batch A: Brann Rook, Rusk Emberjaw, Kest Rel

Three fighters drawn on the alchemist's own skeleton, cloth rig and lit-volume rasterizer
(`src/render/player/FighterArt.ts`, contract in `fighterLook.ts`, files in `src/render/player/looks/`). Nothing in the shared
renderer was changed. Every piece is a rasterizer primitive, so it is lit by the scene, outlined, frosted by the chill and
ragdolled in death like the classic art. Bulk is `build` multipliers and plates, never a bigger hitbox.

How to look: `node scripts/fighter-studio.mjs http://localhost:5173/ --fighters brann-rook,rusk-emberjaw,kest-rel --zoom 6`
(every pose), and in the game `scripts/fighter-probe.mjs` `boot(url, { fighter: id })` (idle, run, cast, kill the player and
step ticks). `tests/fighter-looks-a.test.ts` draws all three through the real renderer against a fake surface and checks that
every material id painted exists in the look's table and that every extra material is used (the rasterizer silently skips an id
it does not know, so a mistyped `EXTRA0 + n` draws nothing and nobody notices).

Group numbers: parts in the same group melt into one volume, different groups get a contact seam; the chill's rime reads the
group (`RIME_BIAS`: groups 18-31 stay bare, 33 and up take rime evenly), so the looks put their armour in groups 34+.

## Brann Rook, the Iron Pilgrim (`brann-rook.ts`)

- **Palette (the sheet's):** black iron with cold grey highs (`coat`, `coatD`, extras PLATE and SHIELD), brass trim (`trim`, `mantle`
  slot), amber for the glow slots (`glow` = visor slits, gauge, the rod's muzzle; `rune`, `flame` the same family).
- **Pieces:** round iron helm over a bevor with a brass neck ring, a thin brass visor frame with a black window and two amber slits,
  layered spaulders (a near one over the head's base, a far one behind the torso), a breastplate with a brass gorget and a pressure
  gauge, belly lames, tassets, cuisses, knee cops, greaves and heavy sabatons (both legs), a brass-cuffed gauntlet, a shoulder
  lantern (brass cage, amber glass), and the tower shield (brass rim, hammered iron face, boss and rivets).
- **The shield rides the body frame** (`frame()`): held in front on his feet, slung on the back when crawling, climbing, tilted
  (dive, swim) or while Boiler Guard's own plate is up (`ctx.fighters.view.tactical.active`, eased by `guardBlend`), and left
  standing on the ground beside a fallen body (never sunk into the floor).
- **Cloth mapping:** the lantern sways on the mantle chain (the only soft part of a suit of plate).
- **Wand:** `drawWand` is a pressure rod: a bright brass barrel (it must read over the dark shield), iron collars, a flared muzzle with an
  amber light that swells when he fires. (Dark iron on the dark shield was invisible; hence the brass.)
- **Reads the kit:** the Pressure meter and a Redline (`view.meter`, `view.ultimate.active`) brighten the visor slits, the gauge and
  the lantern toward white-hot; a body that is dead drops them to embers.

## Rusk Emberjaw, the Furnace Hound (`rusk-emberjaw.ts`)

- **Palette:** scorched skin (`coat`, `coatD`, `skin`), rust-grey iron for the mask (extra IRON) and near-black soot iron for pauldrons,
  vambraces and greaves (SOOT), a red tabard (CLOTH), the furnace white-orange (EMBER, emissive) and a half-emissive crust (CRUST).
  Everything that burns is emissive, so it keeps its light in the dark.
- **Pieces:** an iron skull mask (dome, jutting face plate, eye slot with a hot eye, three glowing mouth bars, a vent wire), a bare
  neck, a pauldron per shoulder, a harness of two straps, pecs and belly lines, the furnace core in the chest (iron ring, crust,
  white-orange heart that throbs), an iron belt with a square buckle, knee plates with an ember rivet, soot greaves, boots with a
  hot seam, a smoke stack off the back with a glowing nozzle, and two molten fists under iron knuckle plates with flame crowns.
- **Cloth mapping:** the red tabard is a flat ribbon down `costume.tails[1]`; the rear loincloth flap is `tails[0]`.
- **Wand:** `drawWand` is the fist: a lick of flame off the near fist along the aim, longer when he fires.
- **Reads the kit:** a Kiln Heart (`view.ultimate.active`) and his armour pool raise the fire (taller tongues, brighter core and
  bars). `reduceFlashes` steadies the flicker and the throb.
- **Death:** flames are not drawn, every ember tone falls to dying coals, the fist cools to dark leather; the body keeps the red cloth.

## Kest Rel, the Chimney Jack (`kest-rel.ts`)

- **Palette:** dark leathers (`coat`, `coatD`), the red cloth (`mantle` slot: scarf, headband and the near forearm's wrist wrap), tan
  leather straps and gloves, steel (`trim` and STEEL) for buckles and the hook, lacquered red-orange pads (PAD), a dark olive vest (VEST),
  amber eyes (`glow`).
- **Pieces:** a masked, shadowed face with two amber eyes, a red headband (painted on the head's own volume) with a knot and two
  tails, a scarf wound round the neck and over the mouth, a chest strap and buckle, a short vest-apron and a ragged rear flap, red
  elbow pads, red knee pads, red boot cuffs.
- **Cloth mapping:** the scarf's long end is the `mantle` chain plus three extrapolated, rippling links (it streams in a run and
  hangs at rest); the headband tails are the `crown` chain turned upside down so they trail down and back; the apron is `tails[1]`
  and the rear flap `tails[0]`, both as flat ribbons.
- **Wand:** `drawWand` is the grappling hook: a wrapped haft, a chain of steel links that sags when he is not firing and runs straight
  along the aim when he fires, and a steel crescent hook (tip glint) curling back toward the hand.
- **Death:** the eyes go dark; the scarf keeps simulating on the ragdoll.

## What was checked

Studio rows (every pose, facing right) and in-game probes (idle, run, jump, cast up, facing left, kill and settle both ways),
including chill 0.5 / 0.75, frozen solid, hurt and burning. Screenshots under `verify-out/fighter-studio/` and `verify-out/fighters/`
(not committed). See the report for what was not verified.
