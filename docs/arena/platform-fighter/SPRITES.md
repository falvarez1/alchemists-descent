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
