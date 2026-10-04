# Duel fighter sprites

Stock matches (Duel and Arena stock rules) draw each fighter from a pixel-art atlas made from the approved concept art. The
campaign keeps the procedural rig (`render/player/FighterArt`), which is also the fallback while an atlas loads or when a
fighter has none. This is the one deliberate exception to "a look is the rig, never a sprite": the user asked for the Duel
mode to look like the concept sheets, and the rig cannot reach that rendering.

Runtime: `src/render/duel/DuelFighterSprites.ts` (pose choice in `duelPose`, drawing in `drawDuelFighter`), called from
`drawPlayerSprite` only while `ctx.arena.stockMatch` is set. Assets: `public/assets/arena/fighters/<id>/sprites.png` +
`sprites.json` (`frames[name] = [x, y, w, h, anchorX, anchorY]`, half-cell presentation pixels, facing right).

The hitbox never changes: every fighter is `PLAYER_HALF_W` x `PLAYER_H` (9 x 17 cells). A frame is pinned by its anchor
(torso column, lowest solid row) to the body's centre-bottom. The standing pose is 38 presentation pixels (19 cells) tall
including hat or hood, the same density as the concept's in-match figures at the concept's zoom.

## Frame names

Sheet A (locomotion, 6 x 3): `idle0 idle1 idle2 idle3 land recover / run0..run5 / rise apex fall fastfall hurt tumble`.

Sheet B (combat, 6 x 3): `idleB opener_windup opener_strike launcher_windup launcher_strike cast / aerial_windup
aerial_strike finisher_windup finisher_strike grab throw / shield shield_broken dodge airdodge ledge_hang ledge_climb`.

Sheet C (moves, one 6 x 3 sheet per fighter, cut with the patch method below): `tactical ultimate victory opener_recover
finisher_recover`. `tactical` and `ultimate` are the Z and T poses (each fighter's from `docs/FIGHTERS.md`), `victory` the
on-stage win pose after GAME!, the two recovers the follow-throughs between a strike and idle. The sheet holds three
takes of each (four of victory and ultimate); the picked take ships under the bare name.

`idleB` is only the scale anchor of sheet B (it normalises the sheet to the same 38 px standing height as sheet A).
Missing names fall back through `FALLBACK` in the runtime, so a partial atlas still plays.

## Making a fighter's atlas

1. References (gpt-image-2 through the ElevenLabs flow "Duel fighter sprites"): the fighter's portrait
   (`public/assets/fighters/<id>.webp`), its animation sheet (`public/assets/fighters/sheets/<id>.webp`), and for Ilyra,
   Brann and Mara their rows of `concepts/core-attacks.png`, `motion-defense.png` and `ledge-movement.png`. Convert to PNG;
   upload; wire as references. Once sheet A is chosen, add it as a reference for sheet B so both share one rendering.
2. Generate at 3:2, 2K, high quality, two variants (about 2,550 credits, $0.56, each). The prompts must demand: one figure
   per cell of a strict 6 x 3 grid, flat pure magenta `#FF00FF` background, same scale, facing right, feet on a common
   baseline, and NO text, floor, shadows, echoes, muzzle flash, arcs or particles (the engine draws effects). The exact
   prompts used for Ilyra are in `SPRITE-PROMPTS.md`.
3. Pick the variant that is most on-model and closest to the concept poses.
4. Cut: `node scripts/arena-sprites/cut-sheet.mjs <sheet.png> --grid 6x3 --names <names> --out <dir> --height 38 --rim outer
   --preview <png>`. Props the generator added anyway (a ledge brick beside a hanging hand) are removed with
   `--erase x0,y0,x1,y1;...` in source pixels. Check the preview: one clean figure per cell, nothing clipped, nothing extra.
5. Pack: `node scripts/arena-sprites/pack-atlas.mjs <id> <cutDirA> <cutDirB>`.
6. Look at it in the game: `node scripts/shot-duel.mjs <url> --p1 <id> --p2 <id>`.

Cut output keeps the downsampled colours snapped to the sheet's own 28-colour palette and grows a one-pixel dark outline
outside the silhouette (the concept's crisp outline does not survive an area downsample on its own).

## Patching frames in a shipped atlas

A frame that came out wrong (a pose that lost its weapon) is replaced without touching the rest of the atlas:

1. Unpack what ships: `node scripts/arena-sprites/unpack-atlas.mjs <id> <dir>/<id>-current` (unpack then pack is bit for
   bit the same atlas).
2. Generate a replacement sheet with the fighter's chosen sheets A and B as the references (several fighters can share a
   sheet, one per row; then cut each with `--anchor` on that fighter's first cell). Cell 1 of each fighter is a copy of
   its idle stance: the cutter scales by it, so the new frames land at the shipped scale (check the cut `pidle` against the
   atlas `idle0`: same height). Spare cells hold second takes (`fall_b`, `airdodge_b`, ...).
3. Copy the picked cuts, renamed to the frame they replace, into `<dir>/<id>-pick` with a manifest, and pack with it last:
   `node scripts/arena-sprites/pack-atlas.mjs <id> <dir>/<id>-current <dir>/<id>-pick` (later directories win).

The patch sheets are kept as `sprite-sources/<id>-patch.webp` (`ilyra-mara-patch`, `brann-nox-thorne-patch` hold several
fighters); their prompts and which cells replaced which frames are in `SPRITE-PROMPTS.md`.

## Bust portraits

The lobby, HUD and results show a painted bust per fighter: `public/assets/arena/fighters/<id>/bust.webp`, 768 x 768, no
alpha. All ten share one framing: three-quarter view facing RIGHT (P2 mirrors with CSS), the eye line (eyes, visor slit,
or the glints in a hood) at 38% from the top, eye to chin 10 to 11.5% of the height, the prop thrust out on the right.
The face sits between 41% (Ilyra) and 57% (Kest) across, because the arcade poses lean into the frame; `bust.json` beside
each bust gives where it landed (`{ eye: [x, y], face, size }`, fractions of the image), so a face crop (the HUD icon)
centres on `eye` instead of a fixed point. The ground is the painted dark slate with faint smoke and embers, lifted onto
`#111a24`, and the outer 7% of every side fades to exactly `#111a24`: on a panel of that colour the edges vanish with no
mask; on any other a CSS mask over the outer 10% does it.

1. Generate (gpt-image-2, 1:1, 1K, high) with the fighter's portrait and animation sheet as references. The first set was
   calm: Ilyra's from the two references alone, every other one with her bust as a framing reference. Duel is an arcade
   mode ("fast-paced, adrenaline-pumping"), so the shipped set is a repaint of each calm bust (the calm bust as the LAST
   reference: same character, crop and eye height) with a fierce expression, a forward lean, the prop thrust at the
   viewer, a saturated rim light in the fighter's accent colour and embers behind. Prompts in `SPRITE-PROMPTS.md`.
2. Keep the master as `sprite-sources/<id>-bust.webp`, measure its eye line and chin, and record them in
   `scripts/arena-sprites/bust-framing.json` (`ex`/`ey` the eye line and `cy` the chin, as fractions of the master; an
   optional `s` overrides the zoom).
3. Frame: `node scripts/arena-sprites/make-bust.mjs [id ...] [--size 768] [--sheet <contact.png>]` writes `bust.webp` and
   `bust.json` (and a contact sheet with the shared eye line and each face anchor drawn; the current one is
   `sprite-sources/busts-contact.webp`). The zoom aims at a common face size but stays within 0.92 to 1.1 and the frame may
   only open a sliver (4%) inside a side, mirror-filled and feathered, because the arcade busts are painted to the edges.
