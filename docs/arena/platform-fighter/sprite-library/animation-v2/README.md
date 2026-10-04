# Individual animation exports

This revision uses one source image per animation. The inventory contains 285 assets and 3,431 exported frames: 126 Ilyra clips, 126 Brann clips, 26 effects, and 7 static props. See the [full roster checklist](COMPLETION.md), [Brann playable changes](BRANN-COMPLETION.md), and [motion review](MOTION-REVIEW.md). Missing files, art acceptance and gameplay integration are tracked separately.

Each directory under `exports/` contains numbered transparent 384×384 PNGs, `atlas.png`, `atlas.json`, and `animation.json`. The atlas uses up to four columns, in chronological row order. `atlas.json` supplies named frame rectangles and normalized pivots for importers; `animation.json` adds per-frame simulation ticks, source coordinates, phase labels, hashes, and review flags. There are no duplicate frames inserted to inflate the count. Read the duration and frame count from each clip: most have 12 frames, some have 16, and Ilyra's unarmed run remains an eight-pose candidate.

`manifest.json` indexes all exports; `manifest.js` supplies the same inventory to the offline [viewer](index.html). The PNG and JSON assets do not depend on the page. Original generation images, prompts, and receipts remain under `sources/` and `prompts/`.

## Anchors and scale

`registration.json` stores each source layout, constant clip scale, optional source roots, pivot, and durations. The default feet pivot is `(192,320)`. Always read the clip's pivot: an asymmetric attack can need different transparent padding. Per-frame body size is never independently normalized. Use nearest filtering and retain transparent gutters when repacking.

Both Ilyra and Brann `ledge_hang` clips use `anchorType: "grip"`, `registration: "gripping-hand"`, and pivot **`(192,64)`**. All 12 frames in each equipment state are registered to the raised gripping hand. Place this pivot at the ledge contact in world space; the torso and legs move relative to that point. Mirroring reflects around the same contact. Do not position this animation using a feet coordinate. The viewer draws a ledge and contact marker to make the attachment visible.

The correction is present in the individual PNGs, atlas, animation map, and import map. It is also retained in `review-overrides.json` and the registration tool. [Anchor verification](evidence/ledge-anchor.json) measures the exported hand position and checks every frame in both browser facings. It does not imply that every other animation has anatomically tracked attachments.

Body extraction finds whole connected figures before assigning them to rows. Joined figures use a flagged grid fallback and require source cleanup. Detached effects retain every pixel in their source cell. See `extractionReview`, `detachedComponents`, and the [validation report](evidence/checks.json); file validity does not establish motion quality.

## Playback

`playback.mjs` provides `frameAtTick`, `frameForAttack`, and a Canvas draw adapter. Use authoritative age at 60 Hz and hold that age during hitstop. Body one-shots hold their final frame; transient effects with `endBehavior: "hide"` return frame index `-1` on completion. The state machine decides when to transition. Left-facing playback reflects around the anchor. Texture bounds do not define collision or reach.

```js
import { drawAnimation } from './playback.mjs';
// animation is the parsed animation.json; atlas is its loaded atlas.png.
drawAnimation(context, atlas, animation, state.animationAgeTicks,
  screenAnchorX, screenAnchorY, displayScale, state.facing);
```

For `anchorType: "grip"`, supply the ledge contact as `screenAnchorX/Y`; for `feet`, supply the fighter's feet. Attack timing comes from `src/config/stockAttacks.ts`. The Brann runtime importer labels startup/contact/recovery and the renderer retimes each phase to combat. Brann's four additional aerials and two additional ground heavies are implemented as playable attacks; other fighters' extra named clips remain art targets.

Armed art includes its held equipment. Standalone weapon props are pickup/drop art, not registered interchangeable weapon layers. Brann's armed runtime is integrated. Per-frame muzzle sockets, full cross-state art acceptance and the remaining roster's replacement runtime integration are outstanding.

## Rebuild and verify

Re-export from the repository root with:

```powershell
node docs/arena/platform-fighter/sprite-library/animation-v2/tools/export.mjs
node docs/arena/platform-fighter/sprite-library/animation-v2/tools/coverage.mjs
node docs/arena/platform-fighter/sprite-library/animation-v2/tools/verify.mjs
node docs/arena/platform-fighter/sprite-library/animation-v2/tools/verify-ledge-anchor.mjs
```

To rebuild just the two ledge clips after changing their source registration:

```powershell
node docs/arena/platform-fighter/sprite-library/animation-v2/tools/register-ledge-anchors.mjs
node docs/arena/platform-fighter/sprite-library/animation-v2/tools/export.mjs ilyra-voss/unarmed/ledge_hang ilyra-voss/armed/ledge_hang
node docs/arena/platform-fighter/sprite-library/animation-v2/tools/verify-ledge-anchor.mjs
```

The tools use the workspace's Node.js, `sharp`, `playwright-core`, and installed Edge. No dependencies or lockfiles were changed. Art was generated with the built-in ImageGen tool from the roster portraits; [provenance.json](provenance.json) records selected sources and prompt files.
