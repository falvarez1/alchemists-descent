---
version: 1
slug: "src-ui-teamachineoverlay-ts"
primary_target: "src/ui/TeaMachineOverlay.ts"
related_targets: ["src/render/TeaMachineDecor.ts","src/render/Camera.ts","src/game/TeaMachine.ts","src/world/teaMachine.ts"]
---

# Bell & Tea Engine

Mode: Experience, with a brief Operate state at the crank and receiver.

Scope: the required first-level chemistry and physics contraption, its action
camera, native machinery detail and caption/return overlay. It inherits the
Living Descent's wet slate and corroded brass. This is a local extension of the
existing expedition surface.

The player starts the crank with the mapped interact key and yields controls to
an eased view of the material chain. A bottom caption names the current handoff;
the top-right Return to player button and Escape remain available while watching.
Returning leaves the engine running. Completion directs the player to collect
the brass bell at the receiver and carry it to the descent gate. A stalled state
directs the player to recharge at the crank.

The memorable sequence follows a burning fuse, pendulum and boulder, water lifting
the duck, acid dissolving a stone pin, the falling sugar weight, steam lifting the
piston, and the final oil/fuse reaction. Camera targets read the live state. The
machine, materials, bell and duck use native game rendering; captions remain HTML.
The ordinary HUD hides while watching, and the saved text scale applies to the
heading, explanation and return control. The camera comfort preference reduces
ordinary close framing. It does not remove all tracking or every stage's zoom.

The final finish-review verdict is PASS: TM1 (scaled captions) and TM2 (solid
rotated duck head) are resolved. Evidence is local and ignored under
`verify-out/tea-machine-777-large/`: `stage-5.png`, `stage-7.png`, `stage-9.png`
and `compact-completion.png`, captured at actual text scale 1.3. Supplied runtime
evidence records physical completion and bell collection through actual inputs
for seed 777, a skipped-camera/comfort run for seed 41, and a mid-chain canonical
save/Continue run for seed 1337. Those checks are separate from the still-frame
finish review. Implementation and validation details live in
`docs/BELL-TEA-ENGINE.md`.

No visual decisions remain open in this bounded review. Subjective camera
comfort, listening and unfamiliar-player acceptance remain unmeasured here.
