# Implementation evidence

Baseline: c90e850. Branch: feature/arena-stock-matches.
Local environment: isolated worktree, Vite 127.0.0.1:5217, headless Edge through the repository's Playwright launcher. No deployment.

## Concept fidelity checkpoint

Branch feature/arena-duel-visuals (main 76638da merged in). Local server 127.0.0.1:5241. No deployment.

- Gap measured at the start: in-game fighters were 34-pixel procedural rigs at 0.4-1.65x zoom (about 20 px tall in wide shots, 60 px at the closest); the concept's in-match fighters are about 90 px at 720p. The Foundry's top was a flat orange band over an X-truss; the backdrop had no furnace, banners or waterfalls. One stage existed.
- Fighters: 20 generated pose sheets (gpt-image-2, references: portraits, animation sheets, concept rows), 36 frames per fighter, 258 KB of atlases for all ten. The first sprite capture showed a dark vertical bar per fighter: the atlas loader read every frame from row 0 because a closed ImageBitmap reports width 0. Fixed by reading the width before closing; the next capture showed the sprites.
- Stages: four backdrop plates edited from the concepts; nine baked platform slabs (main and raised platforms, the Gallery's third). The first Foundry bake made the lanterns solid (they hang directly under brackets); lanterns are now found by their glass and kept out of the hull. The baked colours first rendered as the generic tan plate texture; they are now colour overrides. A row of magenta fringe tinted the deck top red; the walking edge is now the concept copper and hull colours stay under the bloom threshold (the Gallery's pale stone under a lower ceiling). Collision for every stage is generated code; tone changes leave the masks byte-identical.
- Light: during CPU bouts a lightning cast charged 250-290 cells per row of the Metal deck (measured), which both glowed white and counted as electrified contact for both fighters. The competitive hull is now earthed at the end of each tick; the same measurement reads 0 charged deck cells. The campaign wand light measured 1.7x at the deck around each fighter (1.37x even at 30%, because light adds over the 0.92 ambient); stock matches keep 10%, measured at most 0.97x.
- Camera: close combat reaches 2.3x with the feet at 60-68% of the frame (new regression test); dead zones and HUD margins are screen space; the composition never pushes a fighter out of frame across the blast box (existing test).
- Render cost after the pass (one headless Edge sample, fixed scene): median 3.8 ms per frame at 1.0-2.3x including the fine platform faces; 14.5 ms at 0.6x, the pre-existing CPU composition path for expanded wide shots.
- Probes run on this build: verify-stock-match (mechanics, input recovery matrix, CPU bout), verify-stock-platforms, verify-stock-ledges, verify-stock-movement, verify-stock-attacks, verify-stock-shield, verify-stock-controls, verify-stock-recovery-ai (all ten fighters, both sides), verify-stock-camera on WebGL2 and WebGPU, verify-arena-duel (16/16). All passed. Corrected stale staging: the movement probe's dodge-into-wall test stood 31 cells above the deck (it failed identically on the baseline server), the platform probe spawned on a half cell, and three probes cropped evidence without the camera zoom.
- Live CPU bouts on the Foundry, Kiln, Cistern and Gallery with eight different fighters: no page errors.
- Whole suite: 3,290 tests in 269 files; typecheck; lint (src, tests, scripts); production build.
- Remaining: single-frame poses; kit abilities use the cast pose; facial detail at 38 px; washed-out WebGPU presentation of expanded wide shots (pre-existing, WebGL2 is the default); stage hazards are art, not cells, in the competitive variants.
- Side-by-side sheets: evidence/fidelity/compare-*.png (scripts/compare-duel-concepts.mjs).
- verify-stock-stationary first failed one of 18 cases: a level-3 CPU's projectile launched the idle target off the new outer ledge, and the long fall outlasted the 90-tick credit window, so the ring-out read as self-inflicted. The new landing-aware credit (regression test in arena-slots.test.ts) makes all 18 pass; the two knockouts are credited to the CPU.
- Generation spend for the pass: about $16.7 for 36 fighter sheet images and about $5 for the three later stages, plus the Ilyra and Foundry sheets made first (gpt-image-2, ElevenLabs).
- Environment note: removing the temporary arena-duel-ui worktree on Windows also deleted entries from the main checkout's shared node_modules through its junction (scoped packages, .bin). It was restored from the lockfile (package files unchanged); this worktree now keeps its own node_modules.

## Special-charge checkpoint

- Stock cast groups and fighter abilities now share a per-slot reserve of two charges. Cast group/tactical cost: one. Ultimate cost: two, alongside its existing ultimate meter. Passive recharge: 180 active simulation ticks per charge. Melee contact credit: 60 ticks. Accepted use commits to 24 ticks before another attack, grab, shield or dodge. Normal movement continues. Recovery burst is independent of the reserve, after that commitment ends.
- The gate runs before wand mana, cast-index and projectile changes. Fighter abilities reserve their charge before effects run and refund it if the kit refuses. A failing regression showed why: an ability changing its own action state could otherwise skip payment. Refunds preserve prior refill progress and remove the cancelled commitment. A multicast group consumes one charge. Brann's guard lowering and Selene's recall remain continuations of their already-paid tactical; kit cooldowns and active effects retain their own clocks. Campaign and legacy health-duel rules retain their existing resources.
- The new built-in ImageGen sheet is concepts/special-charges.png. The exact prompt and screenshot reference are recorded in concepts/special-charges-prompt.md. HUD cells follow its gold ready fill, dark spent outlines and teal refill. Existing fighter portraits remain in use. The concept's long decorative energy trail is not implemented.
- Browser verification held Xbox B for 180 ticks: Ilyra produced two double-shot groups, using two charges. The independent rival reserve stayed full. An empty reserve still allowed a -7.5 cells/tick upward burst after cast recovery. A real opener added 10.2888 volatility and advanced refill by 60 bonus ticks plus 10 elapsed ticks. All ten fighters refused tactical, ultimate and wand requests while empty. With a full reserve, nineteen tactical/ultimate starts paid the expected one/two charges; Father Thorne's tactical correctly refused without a valid setup and retained both charges. Ready/spent/empty, desktop and 390-pixel captures are saved beside stock-special.json.
- Visual iteration enlarged the cards to make a separate charge row, then corrected mobile defense/percentage overlap with explicit line height and spacing. The browser checks both card bounds and non-overlapping text.
- Reducing spells exposed a CPU dead zone: fighters could stop 29–31 cells apart, outside jab range, for long periods. The regression failed before narrowing stop/restart distances to 16/24 cells and steering toward ten-cell spacing. The revised three-bout sample produced ring-outs in each bout, 142 spell-card casts and 28 melee contacts, compared with 247/24 in the earlier footwork sample. These are short runtime samples with randomized systems, not a controlled balance result. Unforced falls and inconsistent reversal counts remain; this does not establish human-like CPU behavior.

The real stock-loss probe also verifies that respawn refills the lost fighter's two charges while preserving the opponent's one remaining charge. The final full suite passed 3,268 tests in 264 files, including the spacing and atomic-payment regressions. Typecheck, build and lint passed after the HUD and reservation corrections. The existing controller-role probe passed for both Duel seats and the Arena path, the production versus probe passed 13 checks, and the illustrated plan passed desktop/phone image and layout checks.

Verification commands: node scripts/verify-stock-special.mjs, node scripts/verify-stock-bots.mjs http://127.0.0.1:5217/ --tag special-pressure. Evidence includes stock-bots-special-stall.json for the diagnosed failure and stock-bots-special-pressure.json for the next iteration.

## Earlier delivered checkpoints

The Markdown and responsive offline HTML plans cover the full roadmap. Four ImageGen sheets cover the primary match, four stages, ten fighters/actions, and local-versus flow. A fifth output is the runtime Foundry backdrop in public/assets/arena/foundry-backdrop.png. The sixth, concepts/motion-defense.png, guides defensive poses and effects using the existing fighter portraits as references. The seventh, concepts/core-attacks.png, guides the three prototype fighters' melee moves. Each supplemental sheet has its exact prompt beside it. The HTML shows actual gameplay, twelve movement details, and twenty-four startup/contact captures.

The next ImageGen sheets, ledge-movement.png and camera-direction.png, cover ledge movement and revised framing after the user playtest. Twelve additional native captures document ledge catch, climb, release, and fast fall. The camera storyboard guides the implemented camera checkpoint below.

## Controller, grab, and throw checkpoint

The confirmed Xbox layout is implemented in the player-facing Duel and Arena stock-match input paths. Controller zero and one retain independent ownership. The first lobby opening selects an already-connected standard controller for player one; later explicit keyboard choices are preserved. A/B menu roles and Start pause remain intact. Up + B has a dedicated recovery request, including from the ground. The right stick requires returning to neutral before another attack; upward smash has longer startup and recovery than the regular launcher. Down + B uses the existing tactical ability.

Grabs have six startup ticks, three contact ticks, and twenty-two recovery ticks. A successful grounded grab defeats a shield and holds the opponent for up to fifty ticks. Directions throw after eight hold ticks; releasing through damage, invalid terrain, or reset clears ownership. Both bodies use real collision clearance. Simultaneous contacting grabs clash without slot priority. The keyboard carry binding, G by default, requests a grab in stock mode. Pummels and escape mashing are not implemented.

scripts/verify-stock-controls.mjs verifies both jump buttons, both triggers, both bumpers, melee ownership, neutral special casting, recovery, air dodge, shield-to-roll, shield-countering grabs, directional throws, and right-stick edge handling in both Duel seats and the Arena path. It also captures reach, hold, and throw for all three prototype fighters. The synthetic standard gamepads prove browser wiring, not physical Xbox hardware feel.

Visual dogfood caught the thrown fighter disappearing during the campaign's invulnerability blink. Stock fighters now stay visible through hurt and respawn protection, while campaign flashing is unchanged. A failing regression test covers all six blink frames. Native poses extend the grabbing hand to the opponent and show a short throw-release arc. Character detail still falls short of the ImageGen reference.

The combined controller, grab, CPU-spacing and audio checkpoint passed 3,260 tests in 263 files, typecheck, build and lint. The production local-versus probe passed 13 checks without page errors. Runtime evidence is stock-controls.json, local-versus-player.json and the nine *-grab-*.png captures.

## Premium audio checkpoint

Three original ElevenLabs music_v2_5 recordings now replace the campaign score in Arena/Duel: battle, lobby/rematch and results. Twenty-three eleven_text_to_sound_v2 takes replace light/heavy contact and grunts, with shield, grab and throw accents. Victim binding selects the correct voice family; tagged melee and throws avoid duplicate impact layers. Music continues through stock loss, plays the results cue once, and restores campaign/title routing on exit.

The music browser probe passed 16 checks. The SFX probe verified real contact timing, victim voices, blocks without grunts, idle silence, decoded signal and a 180-request mix stress test with peak 0.61. Production verification confirmed actual lobby/battle playback and all 23 hashed effect files loading, with no debug API or page errors. The illustrated HTML now includes the three mastered score players; desktop and 390-pixel layouts and all three media durations were checked. See AUDIO.md for prompts, provenance, mastering, reproductions and limits. These are technical playback checks; human listening approval remains open.

## Shield checkpoint

The new built-in ImageGen output concepts/shield-grab.png defines shield, depletion, break, grab, hold, and throw poses. Its exact prompt is concepts/shield-grab-prompt.txt. Only the shield actions are implemented in this checkpoint; the grab and throw panels remain targets.

Grounded shields drain while held, absorb opponent contacts before hurt effects, regenerate after a quiet delay, and break under pressure. Contact stun prevents an immediate roll; release has seven ticks of lag. A break leaves ninety ticks of vulnerability and requires releasing the defense input before raising a new shield. Unowned environmental damage remains dangerous. The existing keyboard defense binding now guards when held and dodges with direction or in the air. The approved Xbox remap is still pending with grabs.

The shield browser probe exercises actual melee contact, the opponent-owned direct-hit redirect, damage after a break, environmental damage, release lag, and real held-key transitions. It captures three states for Ilyra, Brann, and Mara. An initial probe was inconsistent because the run's arrival protection was still active; the controlled combat fixture now explicitly ends that grace period before attacking. The hit trace records the actual startup and contact frames.

Visual iteration added a second partial ring and alchemical marks after the first plain ellipse looked too sparse beside the concept. Depletion changes the shield to a broken amber rim; guarded hands and lowered stance distinguish defense. Native character detail and break effects still fall short of the sheet. These are comparison captures, not a visual-parity claim.

The full suite passed 3,241 tests in 258 files. Typecheck, lint, and production build passed. The camera checkpoint was committed as 31e78d2; the health-duel browser regression passed all sixteen checks before that commit.

## Larger stage and camera checkpoint

The Foundry's main platform grew from 360 to 480 cells wide. Raised platforms grew from 100 to 160 cells wide and became thinner. The blast box is now x=240..1360, y=180..940, leaving 320 cells beyond each main-platform side and 300 below its top. These coordinates stay fixed while the camera pans and zooms.

The first larger layout put raised platforms 90 cells above the main top. Browser testing found Brann's normal jump and levitation stopped two cells short. The final layout keeps an 80-cell rise so the heavy fighter can traverse upward without spending the dedicated recovery burst.

StockCameraRig frames living fighters using their bounds and limited velocity lookahead. It pulls back faster than it closes, uses a small positional dead zone, reserves recovery/HUD clearance, and fits extreme vertical separation. Its range is 0.4..1.65. The frame composer expands world sampling below 1.0 instead of shrinking the presentation quad. Terrain, sprites, lighting, simulation bounds, and mouse-to-world input use the same extent. Campaign framing returns to its normal extent when stock play ends.

- scripts/verify-stock-camera.mjs passed on actual WebGL2 and WebGPU backends. It captures close, wide, and offstage views, checks both fighters' usable framing, tests pointer mapping against a real fighter position, and proves survival at x=1190 beyond the old right boundary. The first capture attempt exposed stale paused-frame textures; the probe now explicitly refreshes the frame before capturing.
- A real high-volatility launch was stepped and rendered for 90 frames on each backend. Every living fighter remained inside the frame, and the launch pulled the camera below zoom 1.0, exercising the change between normal and expanded composition.
- Visual iteration fixed repeated background seams in wide shots and paints platform top highlights after their undersides so downsampling retains the collision rim. The current wide view has no repeated background seam or blank canvas border.
- The stock-match probe passed damage, launch, stocks, respawn, real input recovery, results, simultaneous draw, and live framing. Six player recovery cases and all 22 CPU recovery cases passed on the enlarged geometry.
- A live 300-frame bot sample measured median frame work 5.84 ms, p95 12.16 ms; median presentation interval 8.34 ms and p95 16.70 ms. This is one local headless Edge sample, not a hardware-wide guarantee. The associated HUD checks passed at 1280 and 390 pixels.
- Wide shots currently use the shared CPU composition path on both presentation backends. The final fixed-scene WebGPU run measured 12.85 ms median frame submission work for a wide shot versus 2.93..3.47 ms for the closer shots. These synchronous costs exclude asynchronous GPU completion. Improving wide-shot sprite detail and composition cost remains required polish.
- Live AI dogfood still recorded two self-attributed falls. The camera work does not resolve the reported CPU direction changes or all recovery decisions. Controller mapping, shield/grab, melee balance, and the soundtrack remain pending.
- Whole suite passed 3,236 tests in 257 files. Typecheck, lint, and production build passed. The enlarged-stage ledge probe passed both climbs, protection, release, destruction, and fast fall. The final 80-cell raised-platform layout passed upward traversal and landing for both Ilyra and Brann.

Evidence: camera-close.png, camera-wide.png, camera-recovery.png and their WebGPU counterparts; stock-camera.json, stock-camera-webgpu.json, stock-performance.json, stock-match-results.json, and stock-recovery-ai.json. These show an implemented camera checkpoint, not full concept-art parity.

## Earlier movement checkpoint

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

Remaining after the current camera pass: improve wide-shot rendering detail and cost, tune camera transitions during respawn, address melee/projectile balance and CPU movement commitments, implement the confirmed Xbox layout with shield/grab support, and create an original battle soundtrack. Visual parity is not achieved. Hanging bodies should sit lower relative to their grip.

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

## CPU spacing checkpoint

### Stationary opponent across the upper platforms

The stock intent override compared fighter heights but ignored separate navigation surfaces. Two fighters on opposite upper platforms therefore selected ordinary approach. The terrain guard repeatedly backed the CPU away from the gap. A browser regression reproduced 1,200 ticks of pacing in both directions, never closing within 317 cells.

The override now requests a route whenever grounded opponents occupy different navigation surfaces, including platforms at equal height with a clear firing lane. The CPU uses the existing drop-to-main and climb-to-opponent routes.

Run `node scripts/verify-stock-stationary.mjs http://127.0.0.1:5217/`. It enters Duel through the player lobby, places an idle human on the opposite upper platform, and runs the real CPU and physics across seeds 11/29/43, skill levels 1/3/5, and both directions. All 18 cases crossed the gap and engaged within 258–318 ticks, with no CPU falls or browser errors. Eleven ended with melee contact; seven knocked the idle human out with a spell during the approach. The probe stops at that first knockout, since respawn would invalidate the upper-platform fixture. Traces and screenshots go to ignored `verify-out/stock-stationary/`.

Typecheck, lint, all 3,268 tests across 264 files, and the production build passed. This regression covers the reported platform pacing loop; broader CPU balance and recovery work remain separate.

Stock CPUs now approach melee range instead of retaining their wand's preferred firing distance. They stop inside 24 cells, restart outside 36, and pause an abrupt reversal for an 18-tick direction commitment. They reserve projectiles for targets farther than 65 cells and prefer openers over repeatedly selecting a finisher. Health/campaign spacing remains unchanged.

Three seeded browser bouts before/after this pass recorded 4 versus 24 melee contacts and 336 versus 247 spell casts. Time within 40 cells rose from roughly 3% to 8–16%. This is a limited deterministic sample, not a balance claim. Short reversals fell from 17 to 15 across both fighters; overall reversals increased as fighters met more often. Unforced falls remain. Recovery decisions and visible footwork need further iteration; human-like movement is not yet verified. The before/after JSON files retain movement and contact evidence.

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
