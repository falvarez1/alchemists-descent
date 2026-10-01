# Looks C: Edda Morrow, Selene Wraith, Father Thorne

Three looks on the fighter renderer (`src/render/player/FighterArt.ts`), each one file in
`src/render/player/looks/`. Nothing in the shared renderer was changed: every piece below is the look's own
`extras` / `replace` pass, drawn through the shared rasterizer, so it is lit by the scene, outlined, frosted by
the chill and ragdolled in death like the alchemist. The concept sheets are ~120 px figures; the game body is 17
cells, so each look keeps the silhouette, the palette, the signature props and the attitude, not the detail.

Reviewed with `node scripts/fighter-studio.mjs ... --fighters <id> --zoom 4` (every pose, chill, frozen, burning,
levitation) and in the real game (a probe that stands, runs, jumps, casts, faces left and dies; the ragdoll is the
same look on the fallen skeleton).

## Edda Morrow, the Glass Saint (Support)

- **Palette.** White coat (shadowed blue-grey), navy trousers and boots, gold trim (`trim`, `mantle`), blonde hair,
  pale skin. Extras: three panes of shield glass (light, pale, deep), halo gold, a gem. Glow slots (`glow`, `rune`) are
  warm gold, so the staff light and the levitation ring are gold.
- **Pieces.** `back` (replaced): white far sleeve with a gold cuff, navy far leg, a white rear coat tail, a lock of
  hair on the shoulder chain, and the **halo** behind the head (a ring of dots with a long ray up and short ones
  around, behind the head so hair and brow cover it, shimmering; emissive, so it blooms and never frosts).
  `torso` (replaced): coat to just below the knee with a gold hem, a gold sash, a navy front panel, skirt folds; on
  a crawl or a fall the skirt follows the legs instead of hanging to a floor line. `head` (replaced): a finer
  face than the shared one (small nose, lashed eye, rose mouth) under blonde hair swept back. `shoulders`: a gilded
  pauldron, a gold greave, navy over the coat tails below the hem, and the **stained-glass shield**: a gold-rimmed
  round window (blue, pale and deep panes under gold leading and a boss), held in front of the body over the
  wand arm, slung on the back when she climbs or crawls, lying by the hand when she is fallen; a glint sweeps
  across it every four seconds.
- **Wand.** `staff` skin with `drawWand`: a gold shaft with rings, a cage of two prongs and a glowing gem where the
  spell leaves; a twinkle wheels round the gem while she casts.
- **Cloth.** Rear coat tail on `tails[0]`, the front coat panel on `tails[1]` (the shared near-leg pass), the lock of
  hair on `mantle`.

## Selene Wraith, the Mercury Twin (Duelist)

- **Palette.** Near-black blue suit with a cold rim, burnt-orange fittings (`trim`, `mantle`: belt band, pouches,
  strap, knee and elbow guards, boot straps), pale skin, silver hair, icy-blue glow (`glow`, `rune`). Extras: the
  scarf blue, the blade, the ice-blue eye, two ghost materials.
- **Pieces.** Slim `build`; a black mask over the lower face with an ice-blue eye over it, silver hair scraped
  back, and the scarf wound at the neck (`head`, replaced). `back` (replaced): far limbs, then the **ponytail**, tied
  high at the back of the head with an orange tie, and the **scarf tails**. `torso`: chest strap with a buckle,
  orange belt band and pouches. `shoulders`/`front`: knee guard and boot cuff, elbow guard.
- **Wand.** `spear` skin with `drawWand`: a black shaft, orange collars and a leaf of mercury light for a blade,
  glowing brighter when she fires.
- **Cloth.** The chains are only four and short, so a streamer takes a chain's *shape* (translated to the ponytail's
  tie or the scarf's knot), swings it about its root, and lengthens it past the tip with a droop and a flutter that
  grow with speed (deterministic from `frame`, no state, no `Math.random`). Ponytail = three strands on `mantle`
  (one bundle, frayed), scarf = `tails[0]` and `tails[1]`. At rest they hang and curve; at a run they stream flat
  behind her. The fallen keep the chain's own terrain-collided shape (no lengthening, so nothing pierces the floor).
- **Afterimage.** Above a run (|vx| >= 1.5) two translucent ghosts of her pose trail behind and five short
  quicksilver streaks run off her body, offset from the current skeleton by the player's smoothed velocity: no
  history, no randomness (`hash2` of the frame), about a dozen primitives while it shows, none otherwise.

## Father Thorne, the Briar Heretic (Controller)

- **Palette.** Forest-green robe (`coat`, blue-green shadow), moss cloak and hood (an extra, olive), brass cross
  (`trim`), brown leather and boots, a bone cross, leaf and vine greens, a lime bud. Glow slots (`glow`, `rune`) are
  leaf green.
- **Pieces.** `back` (replaced): dark far arm and leg, a wide torn cloak tail on `tails[0]` ending in strips, a moss
  back panel on `mantle`, leaves riding the chain points. `torso` (replaced): a robe to the boots whose hem is torn
  into points and hanging strips (swaying with the stride), belt with a brass buckle and a pouch, the brass cross on
  its chain, a briar with leaves across the cloth, and a leaf or two stirring off it. `shoulders`: the moss yoke, a
  hump over the shoulders (the hunch) with torn points and leaf sprigs. `head`/`headgear` (replaced): the head rides
  forward and low of the shared skeleton's (the hunch), a deep cowl with a dark face, two green lights and a pale
  jaw, a bone cross at the brow, a briar sprig, and the hood's peak on the `crown` chain.
- **Wand.** `staff` skin with `drawWand`: a crooked briar shaft with a vine wound round it, leaf pairs, a fork of
  twigs cradling a glowing bud, spores drifting off it, leaves wheeling round it when he fires.
- **Cloth.** Hood peak on `crown`, cloak tail on `tails[0]`, back panel on `mantle`.

## Checked

Idle, breath, walk, run (contact and passing), skid, jump, apex, fall, land, crouch, crawl, climb, wall grab, cast,
cast up, kick, dive, hurt, lever pull, swim, drink, siphon, throw, commune, wand swap, burning, the chill (0.25 to
frozen solid and cracked, breath), levitation; in the game facing both ways, running, jumping, casting and dead
(ragdoll). Unfrosted by design: emissive parts (halo, gem, bud, blade) and Selene's ghosts (group 255). Group ids: the
extras use 33 to 40 (they frost at the base bias), Thorne's hood group 16 (frosts like a hat).

## Notes for the renderer's owner

- `RIME_BIAS` in `AlchemistArt.ts` is `-1` (never frosts) for every group the table does not name, which includes 18
  (the shared `hood` and `helm`) and 30 to 32 (armour). A fighter using the shared hood has a hood that never takes
  rime while a hat does. Thorne draws his own hood on group 16 to avoid it; the shared one may want an entry.
