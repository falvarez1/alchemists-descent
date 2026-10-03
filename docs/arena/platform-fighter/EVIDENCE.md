# Implementation evidence

Baseline: c90e850. Branch: feature/arena-stock-matches.
Local environment: isolated worktree, Vite 127.0.0.1:5217, headless Edge through the repository's Playwright launcher. No deployment.

## Delivered

The Markdown and responsive offline HTML plans cover the full roadmap. Four ImageGen sheets cover the primary match, four stages, ten fighters/actions, and local-versus flow. A fifth output is the runtime Foundry backdrop in public/assets/arena/foundry-backdrop.png. The sixth, concepts/motion-defense.png, guides defensive poses and effects using the existing fighter portraits as references. The seventh, concepts/core-attacks.png, guides the three prototype fighters' melee moves. Each supplemental sheet has its exact prompt beside it. The HTML shows actual gameplay, twelve movement details, and twenty-four startup/contact captures.

The next ImageGen sheets, ledge-movement.png and camera-direction.png, cover ledge movement and revised framing after the user playtest. Twelve additional native captures document ledge catch, climb, release, and fast fall. The camera storyboard is a proposal; the fixed camera has not yet been replaced.

## Movement and playtest-response checkpoint

- Added a finite ledge hang, short initial protection, collision-checked climb, release, destruction handling, and one catch per airborne sequence. Ledge catches do not refill recovery or dodge resources. HUD and poses show the state.
- Added stock fast fall with horizontal control; it does not trigger the campaign dive attack. A final review caught fast-fall state surviving a reset without a vine swing. A failing regression test now covers unconditional reset.
- The raised Foundry platforms allow upward passage and catch descending fighters on actual surviving cells. A rise that ends inside the slab falls back through it. The main platform remains solid. Tests preserve health-mode collision and confirm that passage never destroys Metal cells.
- Replaced the dedicated-GPU message with an Xbox controller recommendation during Arena/Duel. It hides when a standard controller connects. The approved button-role remapping is recorded in the plan and remains pending alongside shield/grab implementation.
- Fixed a CPU recovery request consumed on the last locked hitstun tick. The bot now waits until it can act before issuing the recovery edge. This is a specific recovery fix, not a claim that the reported back-and-forth footwork is resolved.
- Whole suite: 256 files and 3,229 tests passed. Vitest printed worker-termination timeout warnings but completed with exit code 0. The subsequent reset regression and focused player/platform/ledge/recovery suite passed all 27 tests. Typecheck, lint, and production build passed; the existing large-chunk warning remains.
- Browser verification: both fighter slots rose through and landed on the raised platforms without losing stocks or deleting terrain. The controller notice showed without a pad and hid on connection. Evidence: stock-platforms.json and controller-notice.png.
- All 22 CPU recovery cases passed: all ten fighters from both sides, plus two Brann cases starting on the final hitstun frame. Evidence: stock-recovery-ai.json. The three seeded post-change bouts finished without unattributed falls; seed 29 includes one self-attributed KO, so these are not evidence of perfect CPU survival or balance. Before/after traces are stock-bots-before.json and stock-bots.json.
- The ledge browser probe verified both corners, initial protection, vulnerability after protection, body clearance during climbs, destroyed-corner release, no immediate regrab, keyboard catch, and fast-fall landing. Evidence: stock-ledges.json and the twelve fighter/action captures.
- The unchanged health-duel browser probe passed all 16 checks. The updated illustrated plan loads every image and fits desktop and 390-pixel widths.
- The rebuilt production player flow passed its 13 checks, including visible title launch, CPU play, controller joining, two-controller assignment, pause, disconnect/reconnect, and narrow layout, with no page errors. Current evidence: local-versus-player.json and refreshed versus player screenshots.

Highest-priority remaining work from the user playtest: larger stage and independent blast bounds, polished fighter-follow camera with true zoom-out sampling, melee/projectile balance, movement commitments for CPU footwork, the confirmed Xbox layout with shield/grab support, and an original battle soundtrack. Visual parity is not achieved. Hanging bodies should sit lower relative to their grip, and the camera concept requires 16:9 adaptation and additional lower clearance.

Inspection found that the baseline constructed ArenaSlots and exposed Arena/Duel only with __AUTHORING__. The new player-facing Duel entry, runtime, lobby, stock HUD, and CPU driver now run in the production player build. Training panels and the console remain authoring-only. Both builds have been exercised locally; nothing has been deployed.

## First implementation slice

- Selectable stock rules; health duels retained.
- Three stocks, six-minute simulation clock, countdown, four blast boundaries, stock respawn/protection, timeout ordering, and simultaneous-last-stock draws.
- Volatility replaces health loss for direct blows and both direct environmental damage paths in Player.
- Mass-adjusted launch, bounded hitstun, twelve-degree directional influence, and preserved launch momentum.
- One recovery burst per airborne sequence; landing and respawn reset it. Existing levitation remains.
- Real-cell Foundry geometry, generated backdrop, copper detailing, teal lamps, and open recovery spaces.
- Percentage/stock/fuel HUD with existing fighter portraits, timer, result, and rematch. Campaign overlays and cinematic framing are suppressed in stock play.
- Foundry CPU navigation and an initial offstage recovery intent.
- Lifecycle checks for removal, rejoining, manual respawn, countdown attacks, and HUD restoration on exit.

## Validation

- Whole suite after the core attack prototype: 253 files and 3,218 tests passed.
- Typecheck, ESLint, and production build passed. Vite reports large output chunks; no bundle optimization is claimed.
- Existing health-duel runtime probe: 16 checks passed, including exactly-once damage, owner binding, and listener cleanup.
- Stock browser probe passed: damage, launch movement, stocks, protected respawn, recovery by ordinary inputs, winner, geometry, stable camera, and HUD restoration.
- HTML: every image loaded, no horizontal overflow at 390 pixels, desktop/narrow captures saved.
- Stock presentation: portrait images load, cards fit at 1280 and 390 pixels, pause does not overlap the cards, and sound settings open inside the view. Portrait layouts place the cards below the small game view.
- Six input-driven recovery cases passed: Ilyra, Brann, and Mara from both sides, all landing with three stocks intact.
- Real-time bot dogfood: twenty-second bouts with actual simulation/rendering and no page errors. These are smoke playtests, not a full balance or performance study.
- Defensive movement browser probe passed: a real keyboard press starts the dodge; protected hits add no volatility; the active move travels 38 cells in the measured seven ticks; startup/end lag remain vulnerable; one air dodge is consumed; a metal wall stops the body. Casting, kick, flask throw, held pouring, and tactical actions cannot bypass dodge commitment. Twelve fighter/pose captures were saved.
- Local versus passed in the development and production builds: visible title/lobby launch, CPU match, locked signature loadouts, keyboard plus controller, two controllers, restart, title return, pause, reconnect, and narrow layout. The development probe additionally verifies movement isolation, controller rematch, an unchanged durable campaign checkpoint, and Continue restoring the campaign. No page errors were recorded.

## Measured behavior

The real damage path produced launch speeds of 5.94 and 10.84 cells/tick at low/high volatility. The stronger launch moved Brann 29 cells over three body ticks.

Ilyra recovered using ordinary direction and jump inputs from x=599, y=650. After the platform refinement, her feet rose to y=567, then she landed at x=703, y=609 with three stocks intact. Brann reached y=582; Mara reached y=566. Mirrored checks passed on the right.

The latest mechanics-probe bot sample after the melee pass produced one attributed ring-out and one unforced CPU ring-out in about twenty seconds; both fighters had two stocks remaining. Earlier samples produced three or four attributed ring-outs. Recovery strategy needs longer multi-fighter sampling and further correction; no CPU balance or recovery-completion claim is made.

A separate 300-frame local bot sample after the defensive movement pass, with GPU composition enabled, recorded median frame work of 3.27 ms and p95 of 7.275 ms. Render p95 was 5.425 ms, above the 5 ms budget; composition p95 was 5.115 ms, above the 3.5 ms budget. A maximum frame interval of 485.365 ms was also recorded and has not been attributed. Earlier samples varied, including larger entity spikes. This is a short development-server measurement, not a controlled before/after benchmark or a performance pass. Fixed platform material calculations are cached; the renderer still checks surviving cells each frame.

## Dogfood corrections

1. A climbing fallback erased launch momentum. The probe failed with zero movement; the corrected branch yields 29 cells.
2. Leftover campaign decorations and speaking pipes intruded into the stage. Cleanup and stock presentation guards removed them.
3. Readiness callouts, card announcements, and tutorials obscured combat. Stock presentation now excludes those overlays.
4. Campaign cinematic focus/death zoom changed framing. A failing camera test reproduced it and passed after fixing the stock view.
5. A newly placed lamp blocked recovery. The unchanged input probe failed; moving the lamps to the outer platform ends restored the route.
6. Removing the rival left a stale countdown. A regression now proves idle cleanup and fresh rejoin.
7. A phase gate also suppressed slowed health-duel wand updates. A failing regression isolated it; gating now applies only to stock matches.
8. The training panel mislabeled a simultaneous final-stock draw as a win. A browser regression reproduced it; both result readouts now agree and the panel shows percentages for stock play.
9. Pause obscured the lower-right stock card, and the portrait HUD covered the fight despite fitting inside the screen. Browser assertions reproduced both issues. Controls moved to the upper left; portrait cards moved below the game view.
10. The existing health-duel lightning ownership probe intermittently missed because it relied on a random arc crossing a gap. Its fixture now starts at guaranteed contact range and asserts exactly one damage call, preserving the ownership check without relying on aim randomness.
11. Adding K for dodge displaced a legacy saved clip binding. The existing regression failed; migration now allocates older missing actions first and preserves their key.
12. Bot handoff left a queued dodge behind. The failing release regression now proves the action is cleared.
13. Fighter-owned movement and vine swinging bypassed dodge advancement, potentially leaving protection active. Two failing regressions now prove the handoff cancels the dodge.
14. Held pouring consumed 70 flask units during the dodge browser scenario. The action lock now covers held pouring and siphoning; the same probe records zero units spent.
15. Initial motion echoes were thin stick figures. The second art pass fills heads and clothing silhouettes and raises the recovery arm. The gallery retains actual native game detail for comparison.

## Visual comparison and remaining gaps

The actual stage follows the concept's slate refinery depth, amber platform edges, teal lamps, symmetric geometry, and open space underneath. The renderer samples the generated backdrop; platforms and lamp housings are real cells.

The platform now has a deeper tapered body, copper ribs, inset gear-and-flask medallion, and teal lamps. It remains simpler than the concept. Existing fighters retain their authored clothing and proportions; existing portraits are reused in the HUD. The first general sheet's amber Ilyra and ivory Brann differed from the established teal coat and black iron; the new motion sheet uses the established portraits to correct that drift. Dodge anticipation, tucked air poses, silhouette echoes, evasion arcs, and recovery/launch accents are implemented. The native sprites and echoes remain simpler than the new concept. Richer structural detail, full roster animation, and additional stage selection remain unfinished. The concepts have NOT been declared matched.

The checkpoints below bring the lobby, controller ownership, results, and the first three melee movesets into the player build. Broader recovery coverage, the remaining roster, richer attack animation, and additional stages remain in progress.

## Local versus implementation

- A title-menu Duel entry opens the two-seat lobby with all ten existing fighters and the Foundry stage. CPU, keyboard plus controller, and two-controller assignments are supported.
- Each controller has one owner. Press A to join, d-pad left/right to choose a fighter, A to ready, Start to launch. CPU seats are ready automatically.
- Disconnect pauses the game and reserves the missing controller's seat. Reconnection waits for explicit resume and retains a pre-existing pause.
- Match results now show a portrait, remaining stocks, and attributed ring-outs, with rematch and change-fighter actions. Pause restarts the match or returns to the title. The wand bench cannot alter signature loadouts during versus.
- The browser probe launches through visible controls in the production build and confirms the debug handle is absent. Development-only state reads measure movement ownership and inspect the saved campaign checkpoint.
- A failed rival join now returns to the lobby with a message. A failing regression reproduced the prior stuck loading screen.
- Visual review found a clipped mobile heading from inherited global header styles. Explicit lobby header layout fixed it. Desktop and 390-pixel captures show the revised result.
- Save isolation dogfood found that RunDirector treated entering an untracked arena as campaign abandonment. A failing unit regression and the real browser save check reproduced it. Disposable matches now suspend the campaign, preserving its checkpoint and run history for Continue.
- The mixed-input sample moved the keyboard fighter from x=690 to 706 while its controller rival moved from x=910 to 898. With two controllers, the assigned pad moved Player 1 from x=690 to 703 while Player 2 remained at x=910. Controller button fixtures now wait for presentation frames, avoiding missed synthetic presses during heavy build/test load.

The actual lobby follows the concept's paired portrait layout, amber/teal identity, slate panels, copper borders, and stage preview. Results follow its portrait/statistics/actions arrangement. The game's established portraits replace the generated sheet's drifted character identities. Native gameplay sprites, fine frame ornament, and additional stages remain unfinished; this is not a claim that the whole game matches every concept.

Next: distinct attack roles and animations, broader recovery distances and all-roster coverage, ledge behavior, full roster art, the remaining stages, optional hazards/items, and the group-match proxy redesign. Physical controller feel, controlled performance comparison, and human enjoyment remain unverified.

## Saved evidence

- evidence/duel-before.png: original health room.
- evidence/plan-desktop.png and evidence/plan-mobile.png: HTML captures.
- evidence/foundry-first-pass.png and evidence/foundry-verified.png: staged local stock captures; a single capture may catch invulnerability flashing.
- evidence/foundry-bot-dogfood.png: actual running match.
- evidence/stock-hud-1280.png and evidence/stock-hud-390.png: current presentation; desktop capture shown in HTML.
- evidence/stock-sound-1280.png and evidence/stock-sound-390.png: sound controls inside the view.
- evidence/stock-match-results.json and evidence/stock-dogfood.json: mechanics and bout snapshots.
- evidence/stock-recovery-matrix.json, evidence/stock-presentation.json, and evidence/stock-performance.json: recovery, layout, and timing results.
- evidence/stock-movement.json, evidence/stock-dodge.png, and the fighter/action PNGs: defensive mechanics and rendered motion details.
- evidence/versus-lobby-desktop.png, versus-lobby-mobile.png, and versus-lobby-player.png: local lobby captures, including the production build.
- evidence/versus-match-player.png, versus-results.png, and versus-reconnect.png: player-build combat, the revised results card, and the reconnect pause.
- evidence/local-versus.json and local-versus-player.json: visible-flow and input-ownership checks.

## Reproduce locally

Run npm run dev -- --host 127.0.0.1 --port 5217 --strictPort from the isolated worktree. The HTML is at /docs/arena/platform-fighter/IMPLEMENTATION-PLAN.html. The stock browser probe opens the Duel test level, chooses Ilyra, selects Stock duel in Match rules, and adds Brann through visible controls.

Run node scripts/verify-stock-match.mjs for mechanics and recovery; node scripts/verify-stock-movement.mjs for defensive movement and native captures; node scripts/verify-stock-presentation.mjs for HUD and the short timing sample; node scripts/capture-arena-baseline.mjs http://127.0.0.1:5217/ --docs-only for the illustrated plan. The baseline script without --docs-only captures the health room; preserve the saved original when comparing later versions.

The goal remains active. The plans and first implementation slice are delivered; the complete roadmap and concept-to-runtime visual match are not finished.

For the player-facing flow, choose Duel at the title, choose fighters/devices, ready each human seat, and enter the Foundry. Run node scripts/verify-local-versus.mjs for the development probe. After npm run build and node scripts/serve-dist.mjs --port 5218, run node scripts/verify-local-versus.mjs http://127.0.0.1:5218/ --production to check the player build without debug access.

## Core attacks and art iteration

- New ImageGen concept: concepts/core-attacks.png, using the existing Ilyra, Brann, and Mara portraits. Prompt provenance is in concepts/core-attacks-prompt.md.
- Three authored movesets: quick opener, upward launcher, aerial, and finisher. The other seven fighters use common prototype timing until their dedicated pass. All are stock-only; health duels retain the existing kick.
- Data includes startup, active time, end lag, raw damage, contact bounds, launch direction, growth, and stun. Each swing has an ID and a victim set. Damage still passes through arena tempo and the defender's armor.
- Tests cover delayed contact, one hit per swing, solid-cell occlusion, evasion, end lag, simultaneous trades, interruption, reset, restrained bodies, mass scaling, and stun limits.
- The live probe measured 0 volatility before active contact, then 10.2888 on Brann through his actual damage path, with HP remaining 208/208. Remaining active ticks did not hit again. A metal wall blocked all damage. End lag rejected a second attack, dodge, casting, flask throw/pour, and tactical ability; an incoming blow added 8 volatility and interrupted the action. Air attacks retained the held jump input without starting recovery.
- The controller probe used down plus B on the pad assigned to player 1. Player 1 entered a finisher; player 2 remained idle. Both independent movement assignments, reconnect, rematch, and durable campaign checkpoint checks still passed.
- First visual comparison found overly similar crescents. The second pass gave Ilyra a straight finishing thrust, Brann a crouched shield slam with a small spark fan, and Mara a low bell sweep. The shield and bell move with the skeleton. Reduced flashes lower accent density and opacity.
- Evidence: evidence/stock-attacks.json, evidence/stock-melee-match.png, and the twenty-four fighter/action/startup-or-active PNGs. Reproduce with node scripts/verify-stock-attacks.mjs.
- Remaining: native silhouettes remain smaller and less detailed than the concepts. Current attacks are single-hit prototypes; multi-hit accounting across the wider combat system, true combo tuning, audio/rumble differentiation, and the seven remaining authored movesets are unfinished.
