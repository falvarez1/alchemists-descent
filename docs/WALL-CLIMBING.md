# Wall Climbing

Wall climbing is a first-class movement verb, not an automatic ledge helper.
It turns the existing wall-grab pose into a deliberate bouldering state: slow,
methodical, readable, and expensive in combat.

## Design goals

- Intentional: the player holds `Shift` or `C` to grab. Climbing should never steal a
  normal fall, jump, crawl, dive, pull, flask action, or cast unless the player
  asked for it.
- Slow: climbing is safer than falling, but slower than running, levitating, or
  simply finding a path around.
- Grid-honest: only solid vertical faces can be climbed. The mechanic samples
  real cells beside the body and refuses loose air.
- Rough-wall tolerant: natural cave walls are not ladders. Tiny chips,
  crevices, and one-cell protrusions should not halt an intentional climb.
- Readable: the alchemist visibly catches, braces, reaches, pulls, steps, and
  settles. The animation has enough key poses to read ascend and descend.
- Tactical: both hands are busy. Casting or flask work should be limited while
  attached, and hits or bad materials can knock the player off in future passes.

## Controls

- Hold `Shift` or `C`: grab a wall if one is within reach.
- Hold `W` / `Up` while grabbed: climb up.
- Hold `S` / `Down` while grabbed: climb down.
- No vertical input: cling and slowly settle. V1 holds position instead of
  stamina-sliding so the verb is understandable before fatigue exists.
- Release the grab key: drop.
- Press `Space` while grabbed: wall jump away from the face.
- Hold `A` or `D` toward the wall: brace.
- Hold `A` or `D` away from the wall: peel away gently; release grab for the
  clean drop.

The grab key gets a short input buffer, like jump buffering, so a player who
presses it just before brushing a wall still catches. `Ctrl` is intentionally
not a gameplay binding because common browser chords such as `Ctrl+W` and
`Ctrl+S` are unsafe in a normal tab.

Fullscreen Play is an optional harness: it requests browser fullscreen, asks
for keyboard lock where supported, and still uses `Shift` / `C` as the portable
fallback controls.

## Attach rules

The player may attach when all are true:

- `Shift` or `C` is held or was pressed within the grab buffer.
- The player is not dead, crawling, swimming, pulling, or restrained.
- A mostly vertical solid face exists at body side range.
- The current body box and the candidate climb box are free.
- The face has enough solid samples through the torso and legs to read as a
  climbable wall.

Attachment is allowed while falling, rising, or edge-balancing. It is not tied
to being grounded. This makes it useful as a fall recovery verb, while explicit
input keeps it from becoming sticky.

## Movement tuning

V1 uses staged movement rather than free analog climbing:

- Upward climb: one cell every 5 frames.
- Downward climb: one cell every 4 frames.
- Horizontal drift is cancelled while attached.
- Gravity is cancelled while attached.
- Step-up and crawl logic are bypassed while attached.
- Climb movement uses its own loose shoulder mask: the wall-side outer pixels
  may brush through a few non-metal protrusions, and the player may nudge one
  or two cells away from the wall while maintaining handhold contact.
- Wall jump: launch away from the wall and upward, consume the buffered jump,
  clear climb state, then return to normal airborne movement.

Those numbers should feel closer to bouldering than ladder movement. If it
starts to feel like parkour, slow it down.

## Animation contract

The renderer reads climb state from the player and draws procedural key poses.
The animation should expose these beats:

1. Catch: one hand slaps the wall, feet swing toward it.
2. Brace: both feet plant, body compresses.
3. Reach: the upper hand searches for a hold.
4. Pull: torso rises or lowers a few pixels.
5. Step: the lower foot changes holds.
6. Settle: robe and hat lag into the new stance.

Ascending and descending use the same cycle in opposite emphasis. Descending is
not a reversed run; it should look cautious, hand-over-hand, and weighty.

## Combat and interaction rules

V1:

- Normal wand firing is disabled while climbing.
- Flask siphon, pour, drink, and throw are disabled while climbing.
- Pull interactions are disabled while climbing.
- Releasing grab returns those verbs immediately.

Future material rules:

- Vines and moss improve grip.
- Ice, glass, oil, and wet metal slip.
- Fire, acid, lava, toxic sludge, and hot stone hurt or force a drop.
- Crystal can be climbable but noisy or brittle.

## Level-design role

Climbing should follow the crawl rule: never make it a universal tax. Main path
routes should remain possible without perfect climbing. Climbing earns:

- side treasure pockets
- recovery routes after a fall
- alternate combat perches
- short vertical shortcuts
- hidden passages that read through chipped rock, vines, or handhold silhouettes

## Implementation checklist

- Add `grab` to input keys and bind it to `Shift` and `C`.
- Add player climb fields: active flag, direction, phase, movement accumulator,
  and buffered grab frames.
- Promote wall detection from pose-only lip detection into side-face sampling.
- Run climb movement before gravity and normal horizontal movement.
- Gate casting/flask/pull actions while climbing.
- Add Gallery states: `CLIMB CATCH`, `CLIMB UP`, `CLIMB DOWN`, `CLIMB SLIDE`,
  and `WALL JUMP`.
- Add focused validation: attach near a vertical wall, climb up/down, release
  drop, wall jump, and no auto-stick without grab.
