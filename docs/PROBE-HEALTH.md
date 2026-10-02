# Probe health

`scripts/verify-*.mjs` is the game's runtime safety net (196 scripts). It had not been run as a
whole since the September overhaul; on 2026-09-29 all but the special-server ones were run one at
a time against a frozen dev server (170 probes, `node scripts/<probe>.mjs <url>`). **81 passed, 89
failed. Every failure I chased was a stale probe, not a game bug** — and one was a real regression
in that day's own work (`verify-overlay-hit`: boon cards wrapping below the fold), which is the
argument for keeping the net alive. See the causes in the memory note
`stale-probe-patterns` (title screen, arrival grace, opening plates, retired corner map,
`SanctumApi` without `close()`, hard-coded URLs).

Run them against a **frozen** worktree server, not the one you are editing under: Vite hot-reloads
a probe's page on any `src` change and the failure looks real.

## Revived (31 of the 89), by cause

- Title screen fronts the app: `leaveTitleIfShown` / `enterSandboxFromTitle` (`run-helpers`). Pass again:
  backdrop, builder-dock-split, builder-power, builder-prefabs, builder-responsive, builder-splitters,
  dock-fixes, fullscreen-pause, gallery-kick, matpop, mode-persist, tab-scroll (+ app-dialogs, run-launcher).
- The capture helper read `audio.masterGain` (now in the engine's private graph): player-ragdoll,
  weaver-salvage, weaver-equipment, trickshot-chain, living-vines, frond-motion, living-motion.
- Probes of the newer floors take `--url=`, not a positional URL: branch-doors, cold-store,
  glass-galleries, lenswright, mirror-beam all pass (rime-warden passes all but one static
  terrain count: "two brine gutters sunk in the floor (27 brine)").
- Repaired against the game's current rules: card-offers, explosion-debris, minimap-popovers,
  minimap-waypoint, organic-enemy-trio.

## Still failing (58), and why

### Drifted calibrations and assertions (the game was retuned or reworked; each needs a design call, not a reflex)

- `accelramp` — `reaches a high top speed (God Mode) {"maxDvx":0.57,"maxVx":3.6,"f90":6,"vs":[0.48,0.98,1.49,2.02,2.57,3.13,3.6,3.6,3.6,3.6,3.6,3.6`
- `air-tap` — `a carried run still GLIDES (momentum preserved, > 18 cells) {"dist":18}`
- `tap-precision` — `a 6-frame press stays controlled (<= 9 cells, was ~16) {"dist":12,"coastFrames":4,"grounded":true}`
- `feel` — `mid ramp ~frame 30 still building under D1 pacing vy[29]=-1.653`
- `alchemy-kills` — `payout: bonus gold settles as real Gold cells, every grain 18 cells for 18 oz`
- `barrels` — `one blast chain-detonates the whole cluster {"detonated":true,"fuseFrames":76,"witnessFlung":true,"n0":3,"remaining":3}`
- `blood-wade` — `FAIL:`
- `clips` — `capture runs at ~15 fps  n=39 over 6 s`
- `difficulty` — `easy spawns far fewer foes than hard on the same level/seed {"easyCount":6,"hardCount":6}`
- `lava-water` — `lava boils DOWN into the water (sinks well past its start, not floating on top) {"before":{"water":858,"lava":1443,"steam":0,"ston`
- `leviathan-pool` — `seed 7: dug plugs drain the basin  [water 760]`
- `machines` — `lever opens the valve — {"closed":12,"openState":0,"openCells":12,"closedAgain":0,"reCells":12}`
- `physics-level` — `arena terrain is stamped (floor + walls are Stone) {"ok":true,"text":"Test run started at PHYSICS TEST ARENA.","mode":"play","bodi`
- `physics-verbs` — `gas pooled under the ceiling top=0/909`
- `provoke` — `works-weaver-gallery: shot -> hunts/investigates, never keeps foraging ["investigate","forage","hunt"]`
- `rawore` — `the fill pass packs common rock (stone/coal present) {"ore":7,"stone":506215,"coal":0}`
- `rb-runaway` — `NaN-poisoned body is dropped (unrecoverable) {"crashed":false,"removed":false,"bodyCount":1}`
- `reactions` — `FIRE burns the body away {"digPush":42.91,"ctrlDist":12.68,"frozenDist":3.35,"frostSet":84,"metalEndY":683.2,"woodEndY":700.3,"met`
- `rigidbodies` — `applyImpulse wakes the body {"woke":false,"movedRight":40,"radialVx":4,"explMoved":13.747161865234375}`
- `stomp` — `stomping a destructible (wood) crate smashes it {"present0":true,"gone":false,"diveT":0,"bounced":false}`
- `telekinesis` — `held crate LEVITATES to the hand (off the floor) {"grabbed":true,"holding":true,"restY":696.5,"levitY":695.4,"levitated":false,"ho`
- `treasure-row` — `treasure row visible in play HUD  {"rowVisible":false,"gold":"0","goldIcon":true,"cards":"8","cardsIcon":true,"keyHidden":true}`
- `vine-interact` — `vine swings in an explosion blast wave {"levitateDeflect":10.39,"kickDeflect":12.42,"blastDeflect":1.1}`
- `vine-lift` — `it SETTLES back to its original cells when far {"cellsBefore":6,"cellsAfterLift":0,"lifted":true,"nodeCount":6,"swayRange":2.12,"a`
- `wand-bench` — `Key objective uses return-to-portal wording "Pull the engine crank."`
- `weaver-loco` — `floor: closes on the player d0=240 dMin=239`
- `combat-balance` — `page.click: Timeout 30000ms exceeded.`
- `rime-warden` — `name: 'Error'`
- `boss-ward` — `idle seed=1 stood 136/51 cells hp 504->504/504 tank {"seal":0,"water":0}->{"seal":0,"water":0}`

### Legacy content (assert on the retired procedural D1 — its sluice, vines, gallery — that the Breathing Works replaced)

- `fluid-life` — `page.evaluate: TypeError: Cannot read properties of undefined (reading 'connect')`
- `waterfall` — `page.evaluate: TypeError: Cannot read properties of undefined (reading 'connect')`
- `habitat-interactions` — `page.evaluate: TypeError: Cannot read properties of undefined (reading 'connect')`
- `boot` — `overlay removed after boot {"overlayGone":false,"mode":"build"}`
- `menus` — `B opens the bench and pauses`

### Audio (assert on cue names/timings that moved with the sampled-SFX engine; cannot be judged without listening)

- `audio-life` — `the Colossus stomps (creature.colossus.stomp) and its shockwaves rumble as they run (wave loops)  (waves false; creature.golem.ste`
- `audio-score` — `volumes and the Narration switch persist across a reload  ({"vol":0.24,"voice":0.6,"narr":true})`
- `audio-mix` — `page.waitForFunction: Timeout 15000ms exceeded.`
- `audio-bundle` — `Error: ENOENT: no such file or directory, scandir 'Y:\Projects\alchemists-descent-worktrees\polish-verify\http:\localhost:5190\'`

### Builder and authoring tools that still fail after leaving the title (deeper drift; authoring-only, not in the player build)

- `builder-assets` — `page.click: Timeout 30000ms exceeded.`
- `builder-pro` — `page.click: Timeout 30000ms exceeded.`
- `builder-ux` — `page.fill: Timeout 30000ms exceeded.`
- `builder` — `page.click: Timeout 30000ms exceeded.`
- `console` — `page.click: Timeout 30000ms exceeded.`
- `gallery-spells` — `page.click: Timeout 30000ms exceeded.`
- `generated-scene-selection` — `page.click: Timeout 30000ms exceeded.`
- `living-production` — `locator.click: Timeout 30000ms exceeded.`
- `peer-ghosts` — `page.click: Timeout 30000ms exceeded.`
- `sprites` — `page.click: Timeout 30000ms exceeded.`

The Builder's Logic Preview, Runtime/Global Controls/Post Processing/World Map panels and Pixel Scene Editor were
cut (2026-09), and their probes went with them: `verify-builder-player-physics`, `verify-worldmap-panel`,
`verify-scene-editor`, `verify-scene-editor-tile`, `verify-scene-layers` are deleted. The green dock probes
(`builder-dock-split`, `dock-fixes`, `tab-scroll`) now use Outliner / Asset Browser / Asset Details / Prefab Details
as their fixtures; `builder-pro`, `builder-suite`, `builder-ux` and `generated-scene-selection` lost only the
assertions about the removed panels and keep their other (stale) failures.

### Weaver rig probes (the surface-crawler rebuild moved what they measure)

- `weaver-anatomy` — `Error: ENOENT: no such file or directory, open 'Y:\Projects\alchemists-descent-worktrees\polish-verify\verify-out\living-descent\g`
- `weaver-charge` — `Error: sleeping Weaver did not wake by proximity; wake rush did not stay cranky long enough (0 frames); peak horizontal speed 0.12`
- `weaver-pursuit-speed` — `Error: closed too little distance (0.0 cells); maxAbsVx too low (0.38); avgPursuitVx too low (0.07); foot lift too high (5.50)`
- `weaver-rig-sprites` — `Error: Weaver rig atlas PNG was not requested by the runtime.`

### Not diagnosed, or fine alone

- `overlay-hit` — crashed the page in the batch (a browser under load) and **passes alone**: `all controls reachable` at every window size (the Sanctum promise; it is the probe that caught the boon-card regression).
- `findability` — a slow single-level audit; run the multi-seed `npm run verify:findability` instead.
- `climbing`, `trickshot-settings`, `wave-b` — time out on a wait or a click; not diagnosed.

## Not run

Special-server or heavy probes were skipped: the AuthorLink and hosted ones (`verify:authorlink*`,
`verify:hosted-*` — `verify-hosted-game` was run separately against the production build and passes),
the `*-suite` runners, performance (`verify-living-performance`, `verify-fidelity-performance`,
`verify-sandbox-mt`), `verify-encounter-lairs` (9–12 minutes; the triage agent reports all 7 default seeds x 3 levels passing in one process in 8m58s on a quiet frozen server — I did not re-run it, and it fails or stalls under a hot-reloading server), `verify-camps-dry`,
`verify-population-placement`, `verify-worldgen-tune`, `verify-sim-determinism`,
`verify-screenshot-gallery`/`verify-gallery`, and `verify-run-player-build`.
`verify-mobile` was run separately and passes (38 checks).

## Loose ends noticed by the triage (closed)

- `tryMoveTo` in `src/entities/physics.ts` carried unused `moveDx` / `moveDy` parameters (`void`ed) — the stub of a
  "movement sweeps detached rubble" idea that was never built. Removed; behaviour is identical (`verify-tap-precision` and
  `verify-air-tap` give byte-identical numbers before and after). The game's rule stays as documented in docs/FEEL.md: a
  floating fragment under five cells is walk-through and five or more is a wall, which `verify-explosion-debris` asserts.
  If a sweep is ever wanted as a feature, that is a design decision, not this stub.
- The corner minimap was hidden in every play mode (`living-descent.css`, `mobile.css`) yet `Minimap.ts` repainted the whole
  explored grid into it about every 30 frames and wired popovers to it. Deleted rather than gated: the canvas
  (`index.html`, and `builder.html` regenerated), its styles, `redrawCorner`, its cadence and popover wiring. The chart is the
  full map (`M`); the portal/refuge pings still flash on it. `verify-minimap-popovers` now asserts there is no corner map and
  `verify-minimap-waypoint` reads the full map's canvas.
- `verify-game.mjs` kept its own copy of the title-to-Sandbox helper; it uses `enterSandboxFromTitle` from `run-helpers` now.

## Added 2026-09-30: the console's travel kit

- `verify-console-travel.mjs [url]` — 58 checks, all passing against a frozen dev server (about 4 minutes: every
  first build of a floor is 2.5 to 4 s of synchronous generation, and the settled findability repair lands about 12 s after
  any arrival, so the walk over all six campaign levels waits for it each time). Drives the REAL overlay with real keys and
  clicks; asserts the profile, the story memory, card discovery and the saved expedition are untouched by a tainted run.
- `verify-console-bundle.mjs` — static, after `npm run build`: the public build carries none of the travel commands' text.
- `verify-console` (the older one) still stops at its `#mode-build-btn` click (the play screen hides the header); its 35
  checks before that point pass, and the frozen main server stops at the same place.

## Added 2026-09-30: the Builder Studio shell

The palette is now Terrain / Objects / Library tabs, the game header is hidden while the Builder is open, and the
Builder panels were restyled. Probes follow through `run-helpers` (`clickBuilderTool`, `clickBuilderKind`,
`clickBuilderControl`, `openBuilderPaletteTab`, `toggleBuilderMode`). Pass: builder-power (22), builder-prefabs (24),
builder-dock-split (10), builder-responsive (18), overlay-hit. Pass a URL as the first argument (the default is :5173).

- `verify-builder-ux` is **stale against the new shell**, not a game bug: it asserts the retired collapsible palette
  sections (`palette.materials` toggle - dropped), old panel-header metrics (uppercase 11px chrome, `titleOk`), and hovers
  `.bp-tool[data-kind=...]` while the Objects tab is hidden (use `clickBuilderKind`). Two steps were already repaired;
  the rest needs a rewrite against the shell rather than a patch.

## 2026-10-01: the title became a menu (docs/TITLE-MENU.md)

Starting a run through the title is now two clicks, `[data-entry="begin"]` then `[data-entry="descend"]`; the Workshops
fold is a page (`[data-entry="workshops"]` first), and the seed, case and difficulty live on pages under New descent.
About twenty probes were patched for it (`grep -l 'data-entry="descend"' scripts`). New: `verify-title-menu.mjs` (207
checks at three sizes) and `shot-title.mjs`. Verified against the new title: verify-title-menu, verify-fighter-title,
verify-fighter-ledger, verify-fighter-run, `verify-options --only seed`, verify-difficulty-ladder, verify-overlay-hit,
verify-settings, verify-sandbox-arena. NOT exercised after the patch (patched blind, same pattern as the verified ones):
the audio, boons, clips, living-*, mobile, hosted and builder-prod-network probes.

`verify-run-lifecycle` fails at the first respawn wait (`waitPlaying('d1')` after `#respawn-btn`, 10 s) on main too (its
original version run against main f63f2eb stops at the same check), so the title section it now carries (kit list via
Case) has not run; verify-title-menu covers the same ground.

## 2026-10-01 (later): fighters left the campaign; the Proving Yard

`verify-fighter-title` and `verify-fighter-ledger` were rewritten: the title has an Arena door (not a Fighter row) and the
ledger offers no fighter. New: `verify-fighter-arena.mjs` (65 checks: the Arena door to the yard, the hall and its open
corridor, the panel, every fighter's Z and T through the real key path, the tools, Rusk's ram, the keg, Reset yard, Leave).
`verify-title-menu` gained the Complications page and the Arena door (237 checks at three sizes). Main (Complications,
alchemy, builds) is merged in: `verify-mutators` (title section) and `verify-builds` follow the menu. The fighter kit probes
had 17 unused-variable lint errors (CI lints scripts too: `npm run lint`); fixed, not re-run.

## 2026-10-02: the arena programme (docs/arena/)

New probes, all green at the commit that added them (dev server running; run sequentially; NEVER while editing `src`: HMR reloads the page
under them, and a long batch belongs on a frozen worktree server):
- `verify-fighter-bodies.mjs` (73): every fighter run, stopped, jumped, dropped, pushed and flown on the grating bridge; the Alchemist control
  is identical to the last digit against a pre-seam build (`--baseline-url`).
- `verify-fighter-moves.mjs` (19): the ten movement techniques against the classic Alchemist doing the same thing.
- `verify-ai-basic.mjs` (34): a `basic` brain clears a ring wave with each of the ten, the keyboard hands back, skill is a dial.
- `verify-arena-duel.mjs` (15): two fighters in one world; every damage path lands on the right fighter, the caster never; removing the
  rival leaves nothing behind. Runs on the plain Spark loadout (`ArenaSlots.signatureLoadouts = false`).
- `verify-duel-ui.mjs` (11): the title's Duel door, the roster, the Duel Stage, Add rival, a brain each, the fight in REAL time, Rematch, Remove,
  with real clicks.
`verify-fighter-arena` (65) and `verify-fighter-framework` (28) were updated for the renamed Reset button and the Body-scaled health.
`verify-title-menu` (237) allows seven rows in the authoring build (the Duel door). The measurement tools are not probes: `fight-batch`,
`fight-analyse` (writes `report.md` and `report.html`), `fight-tune`, `fight-dps`, `loadout-lab`: see `docs/arena/TELEMETRY-AND-BALANCE.md` 9.
