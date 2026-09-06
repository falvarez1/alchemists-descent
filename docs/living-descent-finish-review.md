# Living Descent finish verdicts

These are the independent reviewers' final tables, preserved without rescoring.
The first three reviews concluded **PASS** within their stated scope. The
Trickshot/death follow-up concluded **ship** after resolving its two material
findings. Reviewers inspected
stills, source and recorded measurements; they did not conduct human play or
listening sessions. The subsequent waterfall and hinged-limb corrections also
concluded **ship**.
Current functional and performance results are recorded in
[living-descent-fidelity-and-physics.md](living-descent-fidelity-and-physics.md).

## Creature art and expression

Disposition: **PASS**.

| ID | Final score | Resolution evidence |
| --- | --- | --- |
| C1 — State-readable expression | Resolved | `creature-expressions.png` provides 24 labelled fixtures: six representative species across ease, sensed attention, species action, and wounded/defensive states. Weaver mandible/head sets, Rillback gape/gills, Rootloper leaf collapse, bat roosting/damaged membrane, slime flattening, and Colossus action/withdrawal visibly separate states. `src/creatures/expression.ts` lines 17–39 ties gaze to remembered observations, hurt to hp, and lids to an independent tick clock. |
| C2 — Anatomical material hierarchy | Resolved | Updated `creature-studies-1.png` and `creature-studies-2.png` show chitin seams, root/leaf ribs, ribbon fins/gills/scutes, wing membranes, and fractured kiln plates. Colossus's shared polished-bead appearance is replaced by plate structure; Leviathan's outlined bead chain is replaced by a continuous body. Existing actor sizes and rigs are retained. |
| C3 — Paired and contextual evidence | Resolved | The labelled expression sheet supplies paired state evidence. Refreshed `gallery-desktop.png` and `sluice-desktop.png` from 15:48 show the updated native creatures in the world at the established camera and actor scale. These are still-art/context evidence, not proof of temporal behavior or unaided play. |
| S1 — Settings operating font | Resolved by verification; no CSS fix needed | Updated desktop/compact settings captures retain readable hierarchy. `expedition-flow.json.settingsFonts.fonts[0]` records `familyName: Segoe UI`, `postScriptName: SegoeUI`, `isCustomFont: false`, and `glyphCount: 98` for the settings paragraph. The initial serif suspicion from the still is not supported by the platform-font evidence. Preserve the current sans operating copy and Cormorant display heading. |
| E1 — Settled desktop entry evidence | Resolved | Refreshed `entry-desktop.png` at 15:47:49 has no boot overlay or loading copy; title, primary Begin action, secondary comfort action, workshop entry, and footer are visible. The compact entry likewise shows the settled state. |

## Weaver salvage and capture gallery

Disposition: **PASS**.

| ID | Reviewed requirement | Verdict | Evidence and boundary |
| --- | --- | --- | --- |
| WA1 | Every remaining Weaver leg visibly meets the body across stances | PASS | All 17 labelled midpoint poses inspected; overlapping sockets and one shared skeleton support continuity. Runtime transitions are not exhaustively sampled. |
| WA2 | Organic, spider-like articulation and injury response | PASS | Jointed silhouettes, staggered planted gait, foot arcs, body spring and reduced support after limb loss are present. Natural feel in motion remains unmeasured. |
| WS1 | Shoot off a leg, collect it, and smack the Weaver with it | PASS | Recorded real-input sever/collect/hit sequence, readable held limb and controls, 24 HP damage and one consumed swing. Positioned encounter and god mode disclosed. |
| GL1 | Find and open all 16 creature pose GIFs | PASS | Dedicated library, named cards, included-pose disclosure, download links and current manifest/probe evidence. Fixtures are clearly distinguished from encounters. |
| GL2 | Easier screenshot and clip navigation | PASS | Clear destinations, search/filter recovery, historical runs, full-size viewer, keyboard arrows, close/release behavior and offline browsing. Desktop and 720px compact stills inspected. |

## Environment response

Disposition: **PASS**.

| Check ID | Contract | Verdict | Basis |
|---|---|---|---|
| ENV-01 | Existing direction, camera coverage and actor scale | PASS | Supplied native views and presentation source |
| ENV-02 | Settled camera stability | PASS | Zero drift in both after fixtures; common composed pose |
| ENV-03 | Attached, responsive, severable vines | PASS | Native shot report, cut stills, connected joints and material ownership; final breeze amplitude has the stated evidence limit |
| ENV-04 | Coherent bush attachment and recovery | PASS | Continuous angle trace and spring/rotation construction |
| ENV-05 | Sluice drainage and submerged blood transport | PASS | Before/after drainage, tracer movement and bounded conservative transfer |
| ENV-06 | Visible opening and closing wheel response | PASS | Opposite angle traces and correct rendered rotation direction |
| ENV-07 | Rillback immersion and current response | PASS | Shared current, per-node immersion, exposed-tail regression and observed outlet travel; sill contact remains a stated limit |

## Trickshot combat and player death

disposition: ship

| ID | Verdict | Recapture evidence |
| --- | --- | --- |
| RD2 | resolved | At 720×480, the connected corpse remains visible above the panel with 18.92px separation; the full focused Return action remains usable. Desktop composition is retained, and actual respawn clears the rig. |
| TC1 | resolved | Larger text scales all four tuning labels and values to 16.9px. Desktop, compact, and narrow recaptures keep the lower sliders visible after scrolling, with no page overflow. |

The review's original material fix list is closed. Current chain runtime evidence
supersedes the earlier timing capture. Moving-target prediction, the pre-finisher
diamond's visual legibility, subjective motion and combat feel remain outside
the reviewed evidence. No additional detector or browser pass was run by the
reviewer.

## Water spilling over ledges

Disposition: **ship**.

| Check | Verdict |
| --- | --- |
| Momentum over the lip and downward acceleration | resolved |
| Disconnected horizontal streaks | resolved |
| Material conservation and collision | pass |
| Restrained finish at desktop and compact sizes | pass |
| Open material findings | none |

The reviewer inspected current stills, source and the six-test/browser reports.
Clips were not played; moving-image quality, enjoyment, performance and device
parity remain outside that verdict.

## Hinged carried Weaver leg

Disposition: **ship**.

| Check | Verdict |
|---|---|
| Hand attachment | match |
| Knee and folded thigh | match |
| Open swing pose | match |
| MATERIAL | match |
| TYPE | match |
| Compact silhouette | acceptable adaptation |

No material visual findings. The supplied stills establish attachment, poses and
material finish. The later contact regression, full finisher and combined
validation passed separately; subjective motion remains outside this visual verdict.

## Evidence boundaries

The creature-art review sampled labelled expression and native game-scale stills.
The salvage review inspected all 17 Weaver stance midpoints and a positioned,
invulnerable encounter using actual shots, collection and melee. The gallery
review covered desktop, compact and offline operation. These do not establish
every animation frame, subjective motion quality or unassisted discovery.

The environment review's vine stills predate the final breeze reduction. A later
probe on the final source measured a 9.75-cell tip range, zero anchor drift, and
a 23-node section detached by real shots. The Rillback travels with the current
but can retain an arched tail against the solid outlet sill. Its unobstructed
exposed-tail regression is a different condition from that contact. The tracer
probe deliberately injects 21 blood cells into existing water.

Raw five-section reviews, JSON measurements and logs are local artifacts under
`verify-out/living-descent/`. Screenshots, pose GIFs and clips are available from
`screenshots/index.html`; both output directories remain Git-ignored.
