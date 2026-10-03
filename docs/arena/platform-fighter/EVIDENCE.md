# Implementation evidence

Baseline: c90e850. Branch: feature/arena-stock-matches.
Local environment: isolated worktree, Vite 127.0.0.1:5217, headless Edge through the repository's Playwright launcher. No deployment.

## Delivered

The Markdown and responsive offline HTML plans cover the full roadmap. Four ImageGen sheets cover the primary match, four stages, ten fighters/actions, and local-versus flow. A fifth ImageGen output is the runtime Foundry backdrop in public/assets/arena/foundry-backdrop.png. Exact prompts are in concepts/prompts.md. The HTML also shows an actual gameplay capture.

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

- Whole suite: 249 files and 3,185 tests passed.
- Typecheck, ESLint, and production build passed. Vite reports large output chunks; no bundle optimization is claimed.
- Existing health-duel runtime probe: 16 checks passed, including exactly-once damage, owner binding, and listener cleanup.
- Stock browser probe passed: damage, launch movement, stocks, protected respawn, recovery by ordinary inputs, winner, geometry, stable camera, and HUD restoration.
- HTML: every image loaded, no horizontal overflow at 390 pixels, desktop/narrow captures saved.
- Stock presentation: portrait images load, cards fit at 1280 and 390 pixels, pause does not overlap the cards, and sound settings open inside the view. Portrait layouts place the cards below the small game view.
- Six input-driven recovery cases passed: Ilyra, Brann, and Mara from both sides, all landing with three stocks intact.
- Real-time bot dogfood: twenty-second bouts with actual simulation/rendering and no page errors. These are smoke playtests, not a full balance or performance study.

## Measured behavior

The real damage path produced launch speeds of 5.94 and 10.84 cells/tick at low/high volatility. The stronger launch moved Brann 29 cells over three body ticks.

Ilyra recovered using ordinary direction and jump inputs from x=599, y=650. After the platform refinement, her feet rose to y=567, then she landed at x=703, y=609 with three stocks intact. Brann reached y=582; Mara reached y=566. Mirrored checks passed on the right.

The final mechanics-probe bot sample produced four attributed ring-outs in about twenty seconds. Earlier samples included an unforced CPU ring-out. Recovery strategy needs longer multi-fighter sampling.

A separate 300-frame local bot sample with GPU composition enabled recorded median frame work of 4.46 ms and p95 of 8.82 ms. Render p95 was 6.17 ms, above the 5 ms budget; composition p95 was 5.81 ms, above the 3.5 ms budget. A maximum frame interval of 486 ms was also recorded and has not been attributed. Earlier samples varied, including larger entity spikes. This is a short development-server measurement, not a controlled before/after benchmark or a performance pass. Fixed platform material calculations are cached; the renderer still checks surviving cells each frame.

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

## Visual comparison and remaining gaps

The actual stage follows the concept's slate refinery depth, amber platform edges, teal lamps, symmetric geometry, and open space underneath. The renderer samples the generated backdrop; platforms and lamp housings are real cells.

The platform now has a deeper tapered body, copper ribs, inset gear-and-flask medallion, and teal lamps. It remains simpler than the concept. Existing fighters retain their authored clothing and proportions; existing portraits are reused in the HUD. The new concept sheet's amber Ilyra and ivory Brann differ from the established teal coat and black iron, so character art needs a reconciled art pass. Authored launch/recovery trails, richer structural detail, and complete screen flows remain unfinished. The concepts have NOT been declared matched.

Next: broader recovery distances and all-roster coverage, universal dodges, distinct attack roles/animations, independent local controllers, full lobby/results, full roster art, remaining stages, optional hazards/items, and the group-match proxy redesign. Controlled performance comparison, renderer parity, physical-controller feel, and human enjoyment remain unverified.

## Saved evidence

- evidence/duel-before.png: original health room.
- evidence/plan-desktop.png and evidence/plan-mobile.png: HTML captures.
- evidence/foundry-first-pass.png and evidence/foundry-verified.png: staged local stock captures; a single capture may catch invulnerability flashing.
- evidence/foundry-bot-dogfood.png: actual running match.
- evidence/stock-hud-1280.png and evidence/stock-hud-390.png: current presentation; desktop capture shown in HTML.
- evidence/stock-sound-1280.png and evidence/stock-sound-390.png: sound controls inside the view.
- evidence/stock-match-results.json and evidence/stock-dogfood.json: mechanics and bout snapshots.
- evidence/stock-recovery-matrix.json, evidence/stock-presentation.json, and evidence/stock-performance.json: recovery, layout, and timing results.

## Reproduce locally

Run npm run dev -- --host 127.0.0.1 --port 5217 --strictPort from the isolated worktree. The HTML is at /docs/arena/platform-fighter/IMPLEMENTATION-PLAN.html. The stock browser probe opens the Duel test level, chooses Ilyra, selects Stock duel in Match rules, and adds Brann through visible controls.

Run node scripts/verify-stock-match.mjs for mechanics and recovery; node scripts/verify-stock-presentation.mjs for HUD and the short timing sample; node scripts/capture-arena-baseline.mjs http://127.0.0.1:5217/ --docs-only for the illustrated plan. The baseline script without --docs-only captures the health room; preserve the saved original when comparing later versions.

The goal remains active. The plans and first implementation slice are delivered; the complete roadmap and concept-to-runtime visual match are not finished.
