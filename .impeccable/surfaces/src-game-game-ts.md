---
version: 1
slug: "src-game-game-ts"
primary_target: "src/game/Game.ts"
related_targets: ["index.html","src/styles/living-descent.css","src/ui/ExpeditionEntry.ts","src/render/FrameComposer.ts"]
---

# The Living Descent

Mode: Experience in play and entry; Operate in settings and the existing workshops.

User approved a complete Noita × Rain World inspired overhaul, asked for creative
implementation, and requested an isolated worktree. The September 4 proposal is
the product direction: a corroded alchemical refinery whose water, vapor, prey and
predators participate in gameplay. The first Breathing Works route has eight
connected physical rooms. Movement, casting and material tools lead; glowseeds,
valves and a warm refuge support alternate routes.

Palette: wet slate, mineral chalk, ivory, oxidized copper, warm brass and mint
bioluminescence. A fixed 640 × 360 simulation-cell view has integer pixel rendering
into a 1280 × 720 backing canvas. Two authored parallax rasters supply depth only;
terrain, water, articulated creatures and machinery stay live and authoritative.
Raster masonry, copper, timber and rock albedo now samples the real cell grid;
the WebGL compositor samples it directly, while the CPU/WebGPU fallback uses
independent cell damage invalidation. Both preserve excavations and saved color
scars. Brass valve, pipe mouths and the refuge hearth mark their actual runtime
anchors. Water boundaries and anatomical scutes carry local contrast under light.
Cormorant Garamond carries entry/room titles; system sans carries operating text.
The scene fills the viewport. Health, active wand/reagents, room objective and
contextual controls occupy quiet corners. No enemy tally or mandatory menu lesson.

Composition references: `.impeccable/mocks/sluice.png` is primary;
`intake.png` and `web-gallery.png` support encounter art. The user delegated
composition within the approved proposal, rather than personally choosing these
generated studies. Their imagery guides materials and hierarchy; screenshot claims
must distinguish real interactive geometry from the static studies.

Entry exposes Begin/Continue and controls. Production removes authoring tools;
development retains Sandbox, Builder and the canonical Developer Console. Reduced
flashes, camera-shake control, text scale, remapping, high-readability lighting,
creature-sound captions and standard controllers are implemented. Pause has a
primary Resume action and input-specific hints. Captions flow below the objective;
four flask slots have independent widths, and Turn valve follows its handwheel.
No debug handle ships in the
normal production bundle.

The world remains a flat authoritative cell grid with sparse 64-cell activity
chunks. Nearby materials step at 60 Hz; distant fluids and growth at 15 Hz;
thermal and electrical reactions stay urgent everywhere. Established generated
vegetation starts dormant. Creature sensing and distant ecology have separate
bounded schedules. These are simulation policies, independent of the camera.

Verification: `scripts/verify-living-expedition.mjs` uses normal entry then explicitly
positioned test scenes; `verify-living-production.mjs` uses shipping UI and actual
autosave/Continue. Record measured performance separately from visual quality.
Unfamiliar-human playtesting and cross-hardware acceptance remain external gates.

Direction contract is the opening comment in `index.html`, seed 19469569. Finish
review and DESIGN.md must describe the built result without claiming automated
proof of fun or a completed human acceptance session.
