# The alchemist — look, costume and death

Movement physics are untouched by this layer: everything here reads player
state and never writes back to motion or collision.

## Pose → costume → art

- `entities/playerPose.ts` — a pure function from player state to a
  **skeleton** (hips, knees, feet, shoulders, elbows, hands, head tilt and
  gaze, wand grip/angle, held flask, crown point, crouch/flare/lift/commune
  weights). Every action has a pose: idle (breathing, gaze follows the aim),
  walk/run (contact and passing, knee lift, counter arm swing, body bob, lean),
  skid, jump rise/apex/fall, levitation, landing, crouch, crawl, climb and
  wall grab, cast (recoil, off hand braced), kick, dive, hurt (head snaps,
  wince), swim, lever pull, drink/siphon/pour/throw (flask in the off hand),
  heart communion (kneeling, cupped glow), wand swap (spin), holding a severed
  leg. `poseRagdoll` produces the same skeleton from the death ragdoll.
  The wand's angle is always `aimAngle` (after aim assist), and while casting
  the wand hand sits on the very ray `Spells.wandTip` casts along (feet − 9,
  prone feet − 4), so the shot visibly leaves along the wand. Never derive the
  wand angle from hand → muzzle: the muzzle is only 9 cells out, so a hand a
  pixel off the ray skews the wand by tens of degrees
  (`scripts/probe-wand-aim.mjs`).
- `entities/playerCostume.ts` — presentation-only verlet cloth hung off the
  skeleton at tick rate: two split coat tails, the mantle hem, the hat's crooked
  crown, and the bandolier vial's bounce. It keeps simulating on the ragdoll.
- `render/player/AlchemistArt.ts` — the alchemist as lit volumes on the creature
  rasterizer (`render/creatures/raster`): the same costume identity (teal coat,
  bone mantle and hooked hat, copper fittings, bandolier, gloves, buckled boots,
  beard) shaded from the real light field. It draws the living pose and the
  fallen body alike; a costume that isn't hanging on this body (not yet
  re-anchored after a teleport) is skipped for the frame, never stretched.
- Presentation fields on `PlayerState`: `levitating` (set by PlayerControl),
  `throwT` (set by the flask throw), `costume`.

## The chill

`player.chill` (entities/chill; docs/FEEL.md "The chill") is read by the pose
and the art, never written by them:

- **Pose** (`playerPose` chillPose): the arms hug in (off hand under the
  mantle, wand arm drawn close), the head sinks and tips down, a lean into the
  cold; the gait stiffens (shorter stride, low knees, less bob); breathing goes
  quick and shallow; a one-fine-pixel shiver of the upper body (never
  mid-cast, never with reduced flashes, never inside the ice).
- **Art** (`AlchemistArt` drawChill → `CreatureRaster.frost`): rime grows on
  the real silhouette. It creeps in from the edges and the tops (brim, crown,
  shoulders first, then sleeves and boots, the coat last, the face barely) as
  a stipple of crystals ahead of a solid coat. The beard and brows frost,
  icicles hang from the brim, and a glaze and twinkling crystals come near the
  top. Frozen solid: rime all over inside a clear-ice shell that hugs each
  limb, with a dark fracture per crack. There is no shape pasted over the
  figure. The breath is a translucent wisp drawn off the mouth.
- The studio has rows for it: `node scripts/player-studio.mjs --only chill,frozen`.

## Death

- `Player.kill` → the Rapier ragdoll (unchanged joints) plus the **dropped
  wand**, a real rigid body (`player-corpse-wand`) that clatters and whose light
  gutters out (art + a light seed in `render/creatures/lights.ts`).
- `game/DeathCinema.ts` directs the rest on wall-clock time (slow motion never
  stalls it): bloom flash, a camera push-in that lifts the body into the upper
  frame (`render/Camera.ts`, allowed past world edges while zoomed), the post
  grade draining colour except reds under a closing vignette (`PostFx uDeath`),
  three slowing heartbeats, letterbox bars, motes rising off the body once it
  rests, and the title card at 2.6 s once the body has settled. The DOM hears
  it only through `deathCinema` events (`ui/Hud.ts`); a 6 s failsafe after the
  body settles still offers the way back.

## Tools

- `node scripts/player-studio.mjs [--zoom 4] [--only idle,run]` — every action,
  posed and costume-ticked, drawn by the production sprite entry.
- `node scripts/probe-player-death.mjs [--vx 2.6 --vy -3]` — the death sequence
  in-game, frames from the blow to the title.
