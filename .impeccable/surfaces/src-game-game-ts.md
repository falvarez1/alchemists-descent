---
version: 1
slug: "src-game-game-ts"
primary_target: "src/game/Game.ts"
related_targets: ["index.html","src/styles/living-descent.css","src/ui/ExpeditionEntry.ts","src/ui/PlayerSettings.ts","src/ui/Hud.ts","src/render/FrameComposer.ts","src/render/presentation.ts","src/render/ComposeShader.ts","src/render/sprites/CreatureArt.ts","src/render/sprites/PlayerRagdollSprite.ts","src/render/sprites/playerPalette.ts","src/render/HabitatScenery.ts","src/render/FallingWater.ts","src/render/TrickshotOverlay.ts","src/creatures/expression.ts","src/creatures/weaverAnatomy.ts","src/combat/WeaverLimbs.ts","src/combat/HeldLeg.ts","src/combat/Trickshot.ts","src/combat/AimGuide.ts","src/config/trickshot.ts","src/entities/RigidBodies.ts","src/entities/VineStrands.ts","src/game/HabitatMotion.ts","src/sim/FluidFlow.ts","scripts/screenshot-gallery.mjs"]
---

# The Living Descent

Mode: Experience in play and entry; Operate in settings, rest choices, workshops and the capture library.

The user approved a complete Noita × Rain World inspired overhaul, delegated
creative implementation, and requested an isolated worktree. The approved world
is a corroded alchemical refinery whose water, vapor, prey and predators participate
in gameplay. The subsequent craft request keeps the current camera coverage and
character sizes while adding more organic terrain detail, anatomy and expression.
The built Breathing Works route has eight connected physical rooms. Movement,
casting and material tools lead; glowseeds, valves and a warm refuge support
alternate routes.

Palette: wet slate, mineral chalk, ivory, oxidized copper, warm brass and mint
bioluminescence. The camera still covers 640 × 360 world cells inside a 1600 × 1064
material grid. Default WebGL presentation now resolves 1280 × 720 detail pixels,
with half-cell creature drawing, finer atlas sampling and contact lips. Actor
sizes, world units and the backing-canvas dimensions remain unchanged. The
`pixelScale=1` startup comparison and CPU fallback retain classic one-cell detail;
the experimental WebGPU diagnostic is configured for that density. Nearest sampling and pixelated presentation remain;
browser fitting can use fractional CSS enlargement.

Texture origin and the displayed fractional offset share one interpolated camera
pose. Grounded bookkeeping velocity no longer drives vertical look-ahead. Supplied
settled stone and timber fixtures record zero camera/target drift; the result is
limited to those measured states.

Two authored parallax rasters supply depth only. Masonry, copper, timber and rock
albedo sample the real cell grid and preserve excavations and saved color scars.
The fine WebGL material repeat spans 64 world cells; the classic repeat spans 128.
Water caustics stay inside real water. Brass valve, pipe mouths and refuge hearth
mark their actual runtime anchors. Habitat dressing adds live Moss, Vines, fungal
shelves and timber braces. Grounded fronds find living roots and rotate through a
damped spring under continuous body contact. Each leaf begins at its moving frond
point; missing roots remove the crown. Hanging leaves instead follow live strand
nodes and inherit their orientation. Connected curved/diagonal vines keep pinned
sockets, including above the view. Shots and digging sever their actual geometry;
detached sections retain their foliage and fall. Save copies preserve the remaining
upper material separately from detached landing positions. Foliage respects
occupied terrain and never relies on a fixed ceiling overlay after detachment.

All 16 enemy sprite kinds use native CreatureArt anatomy at the existing scale.
Weaver has plated body divisions, planted jointed limbs, eyes and mandibles;
Rillback has a continuous ribbon, scutes, belly, fins and gills; Rootloper has veined
leaves and root limbs. Flyers show membranes, hulks fractured plates and Leviathan
a continuous body. The tick-owned expression rig follows remembered mind targets,
sensed attention, feeding/attack, fear and hp-derived injury. Eyelids have an
independent clock. The renderer samples these poses and states without integrating
its own pose simulation. A bounded warm hit response retains shaded anatomy and
is skipped by reduced-flash mode.

Weaver sockets sit within the thorax, independent of ride height. One continuous
joint chain supplies both native drawing and projectile contact. Remaining legs
keep that attachment across sampled stances; severed legs leave stumps and change
support/gait. A dropped limb retains its jointed shape and becomes a visible held
club when collected. The bottom-left cue shows the mapped melee key (default F),
Smack, Weaver leg and remaining swings. Connected hits consume durability, misses
do not, and walls block covered targets. Missing limbs and carried durability
survive saves. The collected limb also retains its owner's provenance. With
Trickshot enabled, a nearby owner at no more than 30% health, capped at 40 hp, gains
a brass diamond and the mapped **Finish its owner** cue. Landing that limb's
finishing hit shows **RETURNED WITH INTEREST** and stronger recoil. These states
preserve the same actor size and connected anatomy; the pre-finisher diamond's
visual legibility has not been independently reviewed.

The held leg grips a spring-driven shank (55% of length), with a heavier-looking
free thigh (45%) flopping at its exposed knee. Six fixed substeps after player
movement solve gravity, momentum, joint lengths, rod contact against floors/walls,
water drag and bounded velocity; a large teleport resets the rig. This driven
wrist and constrained thigh operate even with Trickshot off. They are not a general
Rapier ragdoll weapon. Native drawing interpolates the solved hand, knee and hip,
with a thicker outer thigh and a light cap of 1.1. Limb movement can request redraws
while the player stands still, including during slow motion. The 18-tick swing has
a harmless wind-up, then sweeps the visible thigh during elapsed ticks 6–15.
Committed aim and line of sight address the actual body contact, including a
ceiling-clinging Weaver. Contact consumes durability once per swing. Ownership
and durability persist; the motion rig does not.

The visible handwheel turns clockwise to open and reverses to close. Bounded
hydraulic relaxation transfers material only through connected liquid spans and
donor columns; a coarse current carries submerged blood and influences fish,
Rillbacks and the player. Blood disperses in water. Rillback segments sample their
own immersion, with gravity on exposed nodes and current on submerged ones. Solid
sills remain physical constraints: the captured tail can arch at the outlet.
These stills do not establish all breach-motion quality. The fluid model is a game
approximation, not a full Navier–Stokes solver or an arbitrary siphon simulation.

Water leaving a ledge retains sideways momentum before gravity carries it down.
Only airborne cells gain sparse motion state, capped at 4096; swept collision
checks move the same material cells and metadata without adding a pool velocity
plane. Fine additive strokes follow the actual previous-to-current water path
beneath actors, clipping at occupied non-water cells. The material cell remains
the opaque core. Supported water receives the pool-surface highlight; isolated
falling cells do not become a stack of horizontal pool edges.

Cormorant Garamond carries entry, room, rest and death headings; system sans carries
operating text. Supplied platform-font evidence resolves settings copy to Segoe UI
on Windows. The scene fills the play frame. Health, active wand/reagents, room
objective and contextual controls occupy quiet corners. Enemy tally, corner
minimap, empty wand slots and the old control legend are hidden in this treatment.

Composition references: `.impeccable/mocks/sluice.png` is primary;
`intake.png` and `web-gallery.png` support encounter art. The user delegated
composition within the approved proposal, rather than personally choosing these
generated studies. Their imagery guides materials and hierarchy; screenshot claims
must distinguish real interactive geometry from the static studies.

Entry exposes Begin/Continue and Controls & comfort. Production removes authoring tools;
development retains Sandbox, Builder and the canonical Developer Console. Reduced
flashes, camera-shake control, text scale, remapping, high-readability lighting,
creature-sound captions and standard controllers are implemented. Pause has a
primary Resume action and input-specific hints. Captions flow below the objective;
four flask slots have independent widths, and Turn valve follows its handwheel.
No debug handle ships in the normal production bundle.

Trickshot combat is a default-off, browser-persisted experiment within Controls &
comfort. Its enabled tuning group exposes 35% slow-motion speed, 0.7s duration,
2.6s chain window and 4° assistance defaults. Native slider labels and outputs
scale together with the text-size preference; the two-column group becomes one
column at 580px. Turning the preference off hides tuning and clears its cues.
The native mint/brass guide traces current first contact. An assisted lock steadies
eligible single shots; a wider ring shows spread and a broken ring marks uncertain
follow-through. Seeking spells and streams retain free aim. The guide does not
predict future target positions or consume casting resources.

New targets, kills and severing reward a bounded window of slow motion. A smooth
75ms entry and 180ms recovery preserve the fixed simulation tick, with a four-second
continuous limit and 0.6s normal-speed recovery. Repeated contact with the same
target cannot sustain a chain. Brief CLEAN HIT, chain, LEG ON LOAN and finisher
readouts sit above the action without accepting pointer input; they hide on death.

Wand-bench surfaces and boon selection use the same slate, brass and Cormorant
vocabulary. Rest surfaces and boon cards use 2px corners;
Descend uses a 1px corner and a filled pale-brass action. Boons keep three columns
at the 760px compact breakpoint with tighter spacing. Shop controls, spell-card
details and bench state feedback retain some inherited styles;
the built result does not constitute a complete rest-screen component replacement.

Death transfers bounded incoming movement to an eleven-part physical body: ten
connected parts with nine limited joints and a loose hat. The body retains the
living player's ivory, copper, skin and leather palette. Extra physics substeps
run while the corpse is awake without extending the authored tick. Native art reads
interpolated solved poses; it does not integrate a second rig. Once the body is
quiet, or a timeout expires, the lower slate/brass report opens and focuses
**Return to your waystone**. Returning clears every part, including the hat.
The square panel has a warm top rule, sans stats/cause and a smaller Cormorant
“You fell.” heading. A transparent upper scene and unblurred lower gradient retain
the body. Its height cap falls from 46vh to 36vh at 600px viewport height and below, with
tighter padding and a full pale-brass Return control.

The standalone `screenshots/index.html` organizes Latest captures, Creature poses,
Gameplay clips and All runs. Search, subject filters, ordering, pagination,
expandable historical runs and a native viewer keep the media findable. The viewer
has keyboard arrows, close and download actions and releases media when closed.
Static creature previews open labelled GIF pose loops with included-pose lists;
recorded encounters have their own destination. The current library covers all
16 creature kinds and 17 Weaver stances, including limb loss and limping. Gallery
headings use system sans, with slate/brass controls and a separate 850px compact
breakpoint. Embedded catalog data supports offline viewing. Generated gallery and
raw evidence stay local and Git-ignored; GIF quantization does not change game art.

The world remains a flat authoritative cell grid with sparse 64-cell activity
chunks. Nearby materials step at 60 Hz; distant fluids and growth at 15 Hz;
thermal and electrical reactions stay urgent everywhere. Established generated
vegetation starts dormant. Creature sensing and distant ecology have separate
bounded schedules. These are simulation policies, independent of the camera.

Verification remains divided by what each artifact can establish. The fresh craft
finish review passed its finite C1/C2/C3/S1/E1 list in the first verdict. Its evidence
includes native creature studies, 24 labelled expression fixtures across six
species, gallery/sluice runtime stills, settled desktop/compact entry and settings,
and the settings platform-font capture. The expression fixtures are posed studies;
they demonstrate drawn state separation, not temporal behavior or player response.
The supplied detector's 60 advisories were documentation candidates, not 60 proven
visual defects. Its output was not rerun during documentation extraction.

Subsequent bounded Weaver salvage/gallery and environment finish reviews both
passed with no material findings. Their evidence includes all labelled Weaver
stance midpoints, real-input sever/collect/smack in a positioned god-mode fixture,
gallery navigation/offline checks, attached/cut/landed vine stills, frond angle
samples, opposite wheel traces and measured drainage/current response. The blood
tracer was injected into existing water. The earlier vine sway capture predates
the final breeze reduction, so its amplitude does not describe the final source.
The subsequent current-source vine report separately records sway with zero socket
drift and a section detached by real shots; it supplements that older review evidence.
The environment verdict also retains the Rillback's sill-contact limitation.
Existing validation logs were reviewed; they were not rerun for documentation.

The bounded Trickshot/death finish review has a final SHIP verdict. Its resolved
TC1 and RD2 findings are supported by Larger-text settings captures at 1440, 720
and 540px widths, with all four labels and values enlarged and no page overflow,
and the compact death capture with over 18.9px between the connected body and panel.
The current chain report records two real shots into two mortal slimes, slowing
and recovery, both toggle states retained after reload, and no errors. The completed
owner-finisher report uses initial player positioning and 9999 player HP, with god
mode off. Actual starter-wand severing, walk-collection and five connected limb
hits remove the owner and show RETURNED WITH INTEREST. The successful run uses no
additional contact positioning and no owner, limb or health injection during the
fight. The probe supports additional free-contact positioning for catwalk retreats;
that optional path is distinct from this successful run and from route traversal.
Running/falling corpse reports use explicit death triggers and confirm rig removal
on actual return. Native clips record the canvas; HTML settings and death panels
are evidenced in screenshots. The verdict does not establish moving-target
prediction, subjective impact quality, listening or human combat satisfaction.

The waterfall finish review is SHIP with no material findings. Its five checks
cover momentum, streak shape, material/collision ownership and desktop/compact
hierarchy. The supplied reports use a positioned god-mode fixture with actual E
at the native valve; only the separate blood tracer is injected. They record 82.7%
drainage, eventual tracer dispersal and no errors. Archived clips were not played
for the review, and its stills do not establish motion quality or performance.
The held-leg finish review is SHIP for five supplied stills at 1280 × 720 and
720 × 480. Its exact six-check table follows. Clip playback, subjective motion,
performance, the subsequent contact correction, full finisher and latest combined
validation were outside that verdict; their later evidence does not expand it.

| Check | Verdict | Exact evidence |
| --- | --- | --- |
| H1 — Hand attachment | match | Rest, braking, jump and whip captures show the shank meeting the visible hand; no floating attachment is visible. |
| H2 — Knee and folded thigh | match | Rest and braking show the free thigh descending from the raised knee; jump retains a distinct fold and connected joint. |
| H3 — Open swing pose | match | Whip shows an opened, low V-shaped chain, with the knee near the terrace and the free thigh rising from it; it reads as two joined segments. |
| H4 — MATERIAL | match | Dark contours, muted shell fill and joint detail remain visible beside the player's light. The thicker outer thigh belongs to the world's chitin anatomy. |
| H5 — TYPE | match | The inherited serif room title and plain operating text retain their documented roles; the held-leg correction introduces no competing display treatment. |
| H6 — Compact silhouette | acceptable adaptation | At 720 × 480 the hand connection and folded outline survive while tiny plate detail compresses, consistent with the surface brief's fixed actor scale and camera coverage. |

No material visual findings remain. The handling report separately records fixed
segment lengths through actual carry, reverse, jump, whip and contact inputs in
the disclosed positioned fixture. Focused momentum, reset, length and ceiling-contact
checks pass, as do the final combined suite, typecheck, lint and production
build. The production flow preserves an actual save/Continue and Trickshot settings
with no debug handle or errors. Desktop, compact and offline gallery checks pass
for all 16 creature GIFs and the clip destination. Classic CPU/WebGL2 composition
parity also passes. Fixture details, counts and remaining audit/timing status belong
in the [fidelity and physics record](../../docs/living-descent-fidelity-and-physics.md).
Earlier closed reviews retain their original scope.

`scripts/verify-living-expedition.mjs` uses normal entry then explicitly positioned
test scenes; `verify-living-production.mjs` uses shipping UI and actual
autosave/Continue. The corrected actual-input traversal report reaches D2 alive
with `completed=true`. Worldgen audit and serial timing are recorded separately
from the bounded finish verdicts. This
brief does not turn stills, posed GIFs or headless tests into subjective motion,
listening, combat satisfaction, fun, unaided navigation or hardware-performance
proof. The experimental WebGPU diagnostic failed with an invalid command buffer
and `bridge=failed`; its partly blank output supplies no valid speed or parity
result. WebGL2 remains the shipped default. The browser implementation does not
establish native Vulkan execution. Unfamiliar-human playtesting,
physical-controller compatibility and cross-hardware acceptance remain separate
gates; workshop/boon traversal was outside the finite visual verdict.

Direction contract is the opening comment in `index.html`, seed 19469569. Finish
review and DESIGN.md must describe the built result without claiming automated
proof of fun or a completed human acceptance session.
