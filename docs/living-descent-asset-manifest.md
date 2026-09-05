# Living Descent raster assets

Produced from the approved Living Descent direction with the built-in `image_gen` tool. Primary reference: [The Sluice](../.impeccable/mocks/sluice.png); supporting references: [The Intake](../.impeccable/mocks/intake.png) and [The Web Gallery](../.impeccable/mocks/web-gallery.png). References guide materials and depth; no shipping pixels were cropped from a comp.

## Produce

| ID | Output | Dimensions / format | Alpha / bytes | Strategy and prompt | QA |
| --- | --- | --- | --- | --- | --- |
| `refinery-distance` | [refinery-distance.png](../public/assets/living-descent/refinery-distance.png) | 1150 × 782, RGB PNG | Fully opaque; 462,684 bytes | Clean regeneration of distant pressure columns and boilers. [Exact prompt and provenance](living-descent-assets/prompts/refinery-distance.json); [adjacent sidecar](../public/assets/living-descent/refinery-distance.json). | accepted |
| `refinery-machinery` | [refinery-machinery.png](../public/assets/living-descent/refinery-machinery.png) | 1150 × 782, RGBA PNG | 81.452% fully transparent; 162,142 bytes | Sparse isolated copper/iron edge pipes, chain and wheel fragments. Generated flat chroma source, then verified key-to-alpha conversion. [Final prompt and provenance](living-descent-assets/prompts/refinery-machinery-chroma.json); [adjacent sidecar](../public/assets/living-descent/refinery-machinery.json). | accepted |
| `terrain-atlas` | [terrain-atlas.png](../public/assets/living-descent/terrain-atlas.png) | 256 × 256, RGB PNG | Fully opaque; 137,466 bytes | Final bounded material refinement: irregular ashlar/fillers, clustered fractures and deposition, connected timber grain and worn copper faces replace the conspicuous uniform macro-stone stamp. [Final prompt](living-descent-assets/prompts/terrain-atlas-final.json); [adjacent sidecar](../public/assets/living-descent/terrain-atlas.json). | accepted for asset handoff |
| `props-atlas` | [props-atlas.png](../public/assets/living-descent/props-atlas.png) | 192 × 96, RGBA PNG | 73.942% fully transparent; 19,741 bytes | Brass valve, arched refuge/hearth and corroded pipe mouth, generated on a flat key and mechanically packed into logical sprite rectangles. [Exact prompt](living-descent-assets/prompts/props-atlas.json); [adjacent sidecar](../public/assets/living-descent/props-atlas.json). | accepted |

The two refinery backgrounds depict **non-collidable scenery**. They contain no terrain, liquid, playable platforms, creatures, character, interactive valve, UI, lettering or icons. Their quiet wet-slate values and corroded-copper details support the brighter live gameplay plane. The machinery's central 57% of canvas width is completely transparent for its full height. The terrain atlas supplies surface color only; the simulation grid remains authoritative for shape, mutation and collision.

### Scale and composition

Each refinery background was produced on a 575 × 391 logical asset grid, then enlarged exactly 2×. The implemented game view is **640 × 360 logical pixels with 1280 × 720 backing**. Runtime layer scale `0.5`, nearest-neighbor sampling and pixel-snapped parallax preserve the source grid; these backgrounds do not define the viewport dimensions. There are zero mismatched 2 × 2 source blocks. Native renders were 1536 × 1024; nearest-neighbor conversion to 575 × 391 followed by integer enlargement introduces a deliberate 2% aspect adjustment without cropping.

Composite the distance layer first, machinery second, then live terrain and entities. Machinery should remain subdued behind the collision plane; start around 0.45–0.65 layer opacity and verify player/threat contrast in the game. Use restrained parallax rather than repeating the large vessels as a small tile. Both layers already meet every edge, so allow the renderer to reveal a dark slate backing at parallax boundaries. For another aspect ratio, crop symmetrically or show more world; keep scale uniform and let live collision geometry determine every route. Do not stretch these layers to an entire tall level.

### Live terrain atlas

| Quadrant | Pixel rectangle (x, y, width, height) | Surface |
| --- | --- | --- |
| Top left | `0, 0, 128, 128` | Varied broken ashlar, long slabs and filler stones with clustered fractures, chalk wear and dark wet deposition |
| Top right | `128, 0, 128, 128` | Copper/brass plates with quiet face variation, abrasion, worn seams and sparse rivets |
| Bottom left | `0, 128, 128, 128` | Connected horizontal timber grain, staggered joins, grouped tan wear and iron nails |
| Bottom right | `128, 128, 128, 128` | Layered mineral rock with fractured faces and quieter adjoining planes |

Sample each quadrant as an independent 128 × 128 material tile: wrap logical world-cell coordinates within that quadrant, use nearest filtering, disable mipmaps, and clamp atlas lookups to the quadrant so neighboring materials cannot bleed. Clip every sample to live grid cells. Keep exposure highlights, cavities, material transitions, destructible edges and collision in the renderer/simulation. The image contains no platform silhouette, scene, object placed on a surface, text or character.

The current native edit is 1254 × 1254; a nearest-neighbor resize retains the exact 256 × 256 atlas without procedural painting or palette conversion. This is the single raster refinement requested by [finish review round one](../verify-out/living-descent/finish-review-round1.md), scoped to its repetitive masonry/material finding. The prior round is preserved with its [prompt/provenance](living-descent-assets/prompts/terrain-atlas-round1.json). No runtime code, water, prop or UI changes were made by the asset producer.

The final atlas and an [independent 2 × 2 repeat of every material](../.impeccable/assets/living-descent/sources/terrain-atlas-round2-tiling-review.png) were inspected at logical resolution. There is no added frame, gutter or lighting vignette. Edge samples are not mathematically periodic; the unchanged 128-cell sampler period remains, and wood wrap can read as a plank join. This refinement makes individual large face stamps less prominent through clustered material definition; it does not claim to make a fixed-size repeated texture nonperiodic. Preserve grain direction when introducing compatible sampler offsets.

The [decoded audit](living-descent-assets/terrain-atlas-audit.json) confirms 256 × 256 RGB, all pixels opaque, unchanged quadrant coordinates and exact embedded-prompt equality; it records hash, byte size, edge diagnostics and before/after average colors. The generated edit is darker than round one: mean masonry RGB moved from `54/63/68` to `41/45/48`, with the other material means also lower. Runtime exposure belongs to the sampler/lighting implementation. Asset handoff acceptance does not replace the independent final finish verdict or a live readability assessment.

### Interactive prop dressing

| Sprite | Crop rectangle (x, y, width, height) | Anchor relative to crop |
| --- | --- | --- |
| Brass handwheel valve | `8, 40, 32, 40` | `16, 40`, bottom center |
| Arched refuge/hearth | `48, 24, 96, 56` | `48, 56`, bottom center |
| Corroded pipe mouth | `152, 56, 32, 24` | `16, 12`, center |

The crop rectangles include transparent padding to retain the generated proportions. Use nearest filtering at one atlas pixel per logical pixel; select individual crops rather than tiling the full sheet. Attach these sprites to the real lever, refuge and vent entities. Entity positions, collision, interaction reach, activation, live lighting, particles and all text stay in code. The refuge's warm ochre interior is painted material; fire, smoke and lighting state are not baked into the sprite.

Native generation produced 1774 × 887 pixels. The already-authorized magenta-key fallback created true alpha, then tight source bounds for the three separated props were resized with nearest-neighbor `contain` sizing and packed with bottom-center alignment onto the 192 × 96 transparent sheet. This was mechanical conversion of generated standalone artwork, not a crop from a reference comp. The [decoded props audit](living-descent-assets/props-atlas-audit.json) confirms no visible pixel outside its assigned crop, binary alpha, no opaque hot-magenta pixels, zero native RGB changes from keying and exact embedded-prompt equality. The native logical atlas and a [4× dark-slate inspection](../.impeccable/assets/living-descent/sources/props-atlas-dark-review.png) passed visual review.

## Direct

None. The supplied comps are composition references, not production backgrounds or sprite sheets.

## Semantic / code-native handoff

| ID | Concrete implementation | Notes / QA |
| --- | --- | --- |
| `terrain-and-routes` | Simulation cell grid and WebGL material renderer own slate/chalk solids, breakage, platform edges, encounter routes and collision. The generated terrain atlas supplies material albedo clipped to those cells; code owns boundary/exposure highlights on the logical grid. | Terrain remains mutable and authoritative. No raster supplies collision. accepted |
| `liquids-and-chemistry` | Cellular water/material simulation, depth-aware colors, live surface pixels and bounded particles own reservoir fill, sluice flow, chemistry and pressure changes. | Preserve clear air/water/solid separation in front of both layers. accepted |
| `articulated-creatures` | Simulation-owned body segments, planted limbs, contact and pose data feed procedural canvas/WebGL creature rendering. The alchemist, Eel, Weaver and insects remain independently animated. | Silhouettes, eye/chemical accents and attacks must respond to game state. No creature imagery was flattened into scenery. accepted |
| `interactive-machinery` | Live entity geometry and state own brass valves, operable sluices, refuge doors and actionable lamps; the props atlas dresses valve/refuge/vent entities. Simulation events drive movement, lighting and audio. | Distinguish these with stronger local amber/mint contrast than the background. Collision and activation do not come from sprite pixels. accepted |
| `hud-and-objectives` | Semantic DOM components/CSS and code-native icons render health, active wand/reagents, objective and contextual input hints. Keyboard focus, readable type and responsive placement stay semantic. | All text and controls stay outside the rasters; no baked labels. accepted |
| `ecology-and-light` | Live insect paths, web attachments, bioluminescent sources, positional audio and bounded lighting/particles respond to entities, materials and ventilation. | The art supplies distant depth only; it does not imply a collision or active light source. accepted |

## Transparency fallback and provenance

The first two built-in transparent-background attempts returned opaque RGB PNGs with a painted checkerboard. Those attempts are preserved as review sources and are not used by the game. Their [first prompt](living-descent-assets/prompts/refinery-machinery-first.json) and [correction prompt](living-descent-assets/prompts/refinery-machinery-correction.json) record the limitation.

Following the asset playbook's authorized fallback, a third edit generated a flat magenta background. Its actual sampled key was RGB `244, 3, 237`. A single magenta hue key (`302° ±25°`, saturation at least `0.25`) removes the flat field and its dimmer edge samples. [The Node/Sharp converter](living-descent-assets/convert-chroma-key.mjs) changes only alpha; an independent decoded comparison found **zero changed RGB pixels**. An initial strict RGB key left a visible magenta fringe, so the final hue key was checked over the distance layer at its 575 × 391 asset production scale. No Python image editing was used, and the repository gained no package dependency.

Every production PNG contains its exact final generation prompt in an `impeccable:prompt` text chunk, embedded with Impeccable's `embed-prompt.mjs`. The adjacent JSON sidecars and prompt history retain generation inputs and converter details.

Workspace source and review files live under [`.impeccable/assets/living-descent/sources/`](../.impeccable/assets/living-descent/sources/):

- `refinery-distance-original.png`: full native render, with embedded prompt.
- `refinery-machinery-first-rgb.png` and `refinery-machinery-correction-rgb.png`: failed native alpha attempts.
- `refinery-machinery-chroma-original.png`: generated flat-key source.
- `refinery-machinery-keyed.png`: full-resolution true-alpha conversion.
- `refinery-distance-logical.png` and `refinery-machinery-logical.png`: 575 × 391 nearest-neighbor working assets.
- `refinery-layers-review-logical.png`: combined visual inspection at gameplay scale; review only.
- `terrain-atlas-original.png` and `terrain-atlas-first-logical.png`: initial material generation and its logical-size refinement reference.
- `terrain-atlas-refined-original.png`: round-one native material refinement; the [initial prompt](living-descent-assets/prompts/terrain-atlas-initial.json) and [archived round-one provenance](living-descent-assets/prompts/terrain-atlas-round1.json) retain that generation chain.
- `terrain-atlas-round1.png`, `terrain-atlas-round1-audit.json` and `terrain-atlas-round1-tiling-review.png`: exact pre-refinement production image and its evidence.
- `terrain-atlas-round2-original.png`: final generated material edit, with the [current prompt/provenance](living-descent-assets/prompts/terrain-atlas-final.json) embedded.
- `terrain-atlas-round2-tiling-review.png`: final independent material-repeat inspection; review only.
- `terrain-atlas-tiling-review.png`: four independently repeated material quadrants; review only.
- `props-atlas-chroma-original.png` and `props-atlas-keyed.png`: native generated prop sheet and its alpha conversion, both with embedded prompts.
- `props-atlas-assembly.json`: exact source crops and mechanical sizing/packing metadata.
- `props-atlas-dark-review.png`: nearest-enlarged logical prop atlas over dark slate; review only.

The untouched built-in originals remain in `C:/Users/Frank/.codex/generated_images/01a06f35-5ba2-7051-abb4-672a85ddf090/`: distance `exec-1d245811-138a-409c-83eb-1ed0937a7535.png`, first machinery `exec-9abcb617-f52c-4eeb-977f-089733bd1129.png`, native-alpha correction `exec-973badca-6e61-456e-b164-a9b15b02f2fb.png`, chroma source `exec-641e0f61-ec0a-45b2-9e1c-6b468f4f3ce2.png`.

## Validation and limits

[Decoded asset audit](living-descent-assets/asset-audit.json) records dimensions, byte counts, SHA-256 hashes, actual alpha coverage, exact integer pixel blocks and embedded-prompt equality. Both assets passed visual comparison with the approved materials and a combined inspection at gameplay scale.

The later finish-review material handoff has separate [terrain](living-descent-assets/terrain-atlas-audit.json) and [props](living-descent-assets/props-atlas-audit.json) audits. Terrain uses exact 128 × 128 quadrant boundaries; props use the exact crop rectangles above. The untouched native originals for these additions remain beside the earlier built-in originals: terrain initial `exec-6dab2a71-0a83-4b3a-84cd-444c9a194bf3.png`, terrain refinement `exec-9a389379-9e75-48d6-8bd1-b99ddfe41ed8.png`, props `exec-07ee664c-b699-465a-b83e-905ed401532d.png`.

The final bounded terrain-material edit's untouched native original is `exec-ab9c7ed6-d7d2-4f8e-98b5-5666e8f66fca.png` in that same built-in generation directory. Production SHA-256: `70251f730e78c4f724a7527f246f4abff38e7c2bb067ab2c576fae487e2602a4`.

This acceptance covers production art files. Runtime composition, parallax boundaries, collision-plane readability and device performance remain the implementation thread's integration checks. Exact requested native dimensions and true native alpha were not honored by the built-in generator; documented conversion supplied both final requirements.

## Execution order

Distance regeneration → native machinery alpha attempts → authorized chroma generation → key-to-alpha conversion → nearest-neighbor logical sizing → prompt embedding → decoded verification and logical-scale visual review → renderer integration.

Finish-review handoff: terrain atlas generation → grouped-pixel refinement → exact logical sizing and repeated-tile inspection → terrain integration handoff → prop generation → authorized key-to-alpha conversion and logical sprite packing → decoded checks and dark-background review → prop integration handoff.

## Blockers

None for the four production assets.

## Assumptions

Browser gameplay uses a 640 × 360 logical viewport. The 575 × 391 dimensions above describe background production scale only. These images are environmental layers and surface albedo; all interaction, terrain geometry and collision remain code-native. Final live-capture review cleared the five requested visual repairs; motion listening, human playtests and hardware performance are separate acceptance gates.
