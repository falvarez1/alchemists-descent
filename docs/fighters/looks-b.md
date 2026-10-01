# Looks B: Sable Fen, Mara Quell, Nox Calder

The three hooded fighters. All three are looks on the alchemist's own skeleton, cloth rig and rasterizer
(`src/render/player/fighterLook.ts`); nothing in the shared renderer was changed. They share one small helper
module, `looks/cloakKit.ts` (cloth as a sheet between two rails, torn hems, wraps and bands, smoke wisps; pure
functions of the raster and the posed rig, no `Math.random`, every wobble a function of the tick).

What they have in common: `outfit: 'suit'` (so the shared pass draws no tails, mantle or hat and the look owns
all cloth), `headgear: 'none'` with the hood drawn in the `headgear` extras, `face: 'shadow'` and a replaced
`head` pass (a dark head ball, never any skin), two points of light for eyes, and a bespoke `drawWand`.
Cloth pieces use the alchemist's rime groups (cape 4, flap 9, collar 10, hood 16) so the chill frosts the hood
peak and shoulders first like the alchemist's hat; smoke, mist and halos sit on groups the frost leaves bare.

How they are told apart at a glance: Sable is green and narrow with a hood peak that droops long and a weapon
twice her height; Mara is purple and gold, upright, wide in the robe, with a gold-edged cowl and a bell;
Nox is grey-black, broad at hood and shoulders, and carries the only warm light of the three.

## Sable Fen (the Mire Stalker)

- **Palette**: moss cloak `0x08150b..0x65a350`, near-black swamp tunic and trousers, brown leather
  harness and boots, tarnished brass, linen bandage, pitted steel; glow slots are mire green `0x1fb446 / 0x8aff7a`.
- **Pieces**: a torn cape (one `poly` from the shoulders down the rear chains, ragged hem, creases) behind the
  body; a narrow torn front flap over the near thigh; a collar over the shoulders; a hood (shell, back drape,
  peak drawn out into a point) with a dark mouth and two green points of light; harness strap and green gem
  (the bandolier slot); linen wraps on both forearms and both boots, leather straps, a knee guard; belt pouches.
- **Weapon** (`drawWand`): a 22-cell shaft with a spike butt, brass rings, a crescent sickle swept off the
  head with a green edge, three mire drips that grow and reset on the tick. The sickle curls toward the ground
  whichever way she faces; the shaft keeps the shared grip and aim angle.
- **Cloth mapping**: `mantle` chain -> cape top edge, `tails[0]` -> cape back edge and torn hem, `tails[1]` ->
  the cape's inner edge and the front flap, `crown` -> the hood peak (extended by one stub so it ends in a point).
- **Mire glow**: eyes, harness gem, drips, the blade edge, a few spores lifting off the cape, a little
  translucent mist off the hem.

## Mara Quell (the Bell Witch)

- **Palette**: deep violet robe `0x08050f..0x6646ae`, darker train, gold `0x3a2204..0xfff0b8` (a lacquered
  slot for the bell and fittings, an unlacquered one, `GILD`, for belt and braid so it never blows out), violet
  resonance `0x7a2ae0 / 0xc88cff` for glow, rune and the eyes.
- **Pieces**: an A-line robe (sheet between the two tail chains, hem tracking the stride, gold hem line, a
  panel of two gold edges and a gold sigil ring riding the cloth); a rear train on the far side; bell sleeves
  with gold bands on both arms (the near hand is redrawn over its cuff); a gold-edged shoulder cowl with a clasp;
  a tall pointed cowl with a gold rim around the opening; a gold sash with a small bell on the vial spring.
- **Weapon**: a brass handbell. Idle it hangs from her hand mouth down and swings with her stride; while she
  casts (`firing`, then `recoilT`) it swings out along the aim, the handle grows, and three violet arcs leave
  the mouth. A few violet motes drift around it.
- **Cloth mapping**: `tails[0]` -> train and back rail of the skirt, `tails[1]` -> front rail and hem,
  `crown` -> the cowl's peak, `vial` spring -> the belt bell.

## Nox Calder (the Lampblack)

- **Palette**: charcoal coat `0x07080b..0x464c59`, a cooler grey scarf and bracers, near-black iron, brass,
  amber lantern `0xe08a14 / 0xffc850`; translucent grey smoke; a faint warm halo material.
- **Pieces**: a long coat (broad rear cape, torn front flaps cut off at the shin), a heavy cowl and a scarf
  wound over the jaw with its tail streaming off the `mantle` chain, a broad rounded hood with a short slumped
  peak and two amber eyes, brass buttons, buckle and a pauldron stud, strapped boots, grey bracers.
- **Weapon**: the black lantern (iron cap, base and posts round a pane of flickering amber). It hangs from
  his hand on a short chain, sways with his stride, swings out and up as he casts (with a fan of embers), and
  drops its shutter when the player hoods the lantern (`ctx.state.lanternHooded`), leaving a thread of light.
  A faint warm halo is thrown behind it (skipped through a hit's flash and the ice's glaze, which would wash
  it to a grey disc).
- **Smoke**: wisps ride the chain ends (`tails[0]`, `tails[1]`, `mantle`), so they stream with his run; every
  puff has its own size and line, and thins into the dark as it ages.

## What was checked

- `scripts/fighter-studio.mjs` (a 66-cell-wide private copy so the long weapons are not clipped), every
  action pose for each fighter (idle, walk, run, skid, jump, apex, fall, levitate, land, crouch, crawl, climb,
  wall grab, cast, cast up, kick, dive, hurt, lever pull, swim, drink, siphon, throw, commune, wand swap,
  burning), the chill rows (0.5, 0.75, cast, frozen solid, cracked): nothing breaks, rime lands on the hood
  peak and shoulders first.
- In the real game with real input (boot a fighter in an arena, hold D / A, Space, aim and cast): idle, run
  right and left, jump, cast; Nox with the lantern hooded and burning; the ragdoll after `kill` (the look holds
  on the fallen body; paused and stepped so the death cinema's colour drain does not hide it).
- `npx tsc --noEmit`, `npx eslint src/render/player --max-warnings=0`, `npx vitest run tests`: clean.

## Not covered / for the lead

- The dropped wand after death is the alchemist's wooden wand for every fighter (`drawDroppedWand`, a rigid body
  drawn from `ALCHEMIST_MATS`); a fighter-specific drop (Nox's lantern lying lit, Mara's bell, Sable's scythe)
  needs a `look.drawDropped` hook there.
- A fallen fighter has `wand.visible = false`, so the prop vanishes with the pose; only the dropped wand above
  stands in for it.
- No in-game check on a brightly lit floor (the arena is dark); the studio's lit floor was the reference.
