# Level fidelity and foliage review, 3 October 2026

Reviewed the work merged after `855f5ef` through `9eec036`, covering PRs #14,
#15, #16 and #17. These are the changes in the 24 hours preceding this review:
opponent AI, level plates and water, brass HUD, surface foliage, vine combustion
and persistence, and animated depth machinery. The starting checkout was clean
and matched freshly fetched `origin/main`.

## Defects fixed

Each case below failed a regression test before its fix.

| Priority | Trigger and defect | Correction |
| --- | --- | --- |
| P2 | A grid flame touches quenched ambient moss. Ignition resets its saved burn age to zero, restoring consumed material and allowing another ignition flame. | Preserve the char age when encoding the renewed smoulder. A plant already 65 ticks into its burn retains those 65 ticks. |
| P2 | A level transition happens between vine and surface-foliage updates within one game tick. The heat index is keyed only by context and tick, so particles from the previous world can ignite or quench the destination's foliage. | Include world identity in heat-trace cache validity. |
| P2 | A flame occupies an interior body column between the AI's centre and edge samples. The safe-footing check approves the position, including a drop beginning at standing height. | Check every body column for hazards. Ordinary collision and support checks remain in use. |
| P2 | Removed moss disappears from the rebuilt chunk list before its old pose is deleted. New moss at the same address inherits the old plant's bend and velocity; obsolete poses accumulate. | Prune removed roots before replacing chunk membership, including the unindexed-world path. |
| P3 | A saved charred plant is drawn before its first update, or its life changes through grid ignition while its chunk remains cached. The pose initially displays pristine green material. | Read burn appearance from the current life plane during discovery without advancing the burn clock. |

The runtime foliage probe also checks saved charring before a tick, consumption
of only the remaining burn time, and a fresh pose when the root is replaced.
No generation, cell IDs, save layout, tuning, or asset files changed.

## Improvements still worth doing

1. **Restore useful performance gates.** Existing delivery notes record render
   p95 above the 5 ms budget on both the previous baseline and the richer scene.
   Profile material-detail composition, moving-piece painting and texture
   uploads separately. Optimize measured costs before deciding whether the
   threshold needs a documented hardware profile. Whole-frame success alone
   does not establish render headroom.
2. **Repair the broad renderer comparison probes.** The preceding work records
   drifting fixtures and stale WebGPU toggle expectations. Clear-water parity
   covers the changed refraction path, but cannot establish parity for actors,
   all foliage, moving machinery, and the complete frame. Freeze clocks and
   assets and make those broader checks trustworthy again.
3. **Separate distant architecture from playable ledges more clearly.** The
   captured Rillback Sluice has bright distant railings and platforms competing
   with the real platforms. Try a small, local reduction of backdrop contrast
   around traversal surfaces and controls. Validate at native scale while
   moving, particularly at pool edges. Avoid flattening the whole scene.
4. **Give habitats distinct foliage palettes and silhouettes.** Surface crowns
   currently use one green palette and one floor-frond grammar with size and
   spread variation. Their stored root colour is not used by the drawing path.
   Moss, aquatic fronds and dry-floor growth could vary by biome and current
   water state while sharing their exact drawn outline with heat contact.
   Keep any new placement change separate from these runtime fixes and update
   generation snapshots/version if placement changes.
5. **Expose an ambient-motion preference.** Machinery's switch is currently a
   development-only control. Slow gear motion and decorative lantern flicker
   should have a player-facing comfort option. Apply it to presentation while
   preserving physical foliage contact and actual gameplay light queries.
6. **Expand visual review coverage.** The current six-floor captures use seed
   1337 and hand-selected standing locations. Add a few ordinary traversal
   recordings across seeds, with enemies and effects active, and review small
   screens with maximum text/HUD scaling. Findability and still captures answer
   different questions from visibility during combat.
7. **Make probe imports resilient to development reloads.** After source edits,
   the foliage probe's direct module import observed a different pose cache
   from the running game's timestamped import. It reported zero contact on two
   runs. A cold Vite restart passed with a peak bend of 0.207 radians and a
   parting value of 0.440. Run these probes against a freshly started server;
   a future probe API should expose the exact runtime instance instead of
   importing another copy of a module with private state.

These are follow-up recommendations, not claims that they were implemented in
this patch. The initial six-floor browser audit passed 27 checks, including
terrain removal, darkness, native movement, desktop scaling and touch layouts.

## Validation

Start a fresh Vite process with `npm run dev -- --host 127.0.0.1 --port 5187
--strictPort` before browser verification. Runtime captures and machine-readable
measurements remain in ignored `verify-out/`.

- `npm run typecheck`: passed.
- `npm test`: 3,151 tests passed across 247 files. Five added regression cases
  were observed failing before their fixes.
- `npm run lint`: passed.
- `npm run build`: passed, with existing large-chunk warnings.
- `node scripts/verify-visual-fidelity.mjs http://127.0.0.1:5187/`: 27 checks
  passed during the initial review, covering all six generated floors.
- `node scripts/verify-living-foliage.mjs http://127.0.0.1:5187/`: 15 checks
  passed on the final code after a cold server restart. Includes native
  movement, burn containment for three seeds, machinery motion, vine snapshots,
  and three new moss persistence/replacement checks.
- `node scripts/probe-fidelity-parity.mjs http://127.0.0.1:5187/`: passed in
  WebGL2 across 64,454 water pixels, maximum difference one colour step.
- The same clear-water probe with `?renderBackend=webgpu&enableWebGpuLiveCompose=1`
  passed across 64,442 pixels, maximum difference one colour step, bridge
  `validated`.
- `node scripts/verify-ai-combat.mjs http://127.0.0.1:5187/ --seeds 3`: all 58
  checks passed, including 15 seeded duels, hazard crossings and native play.

The broader renderer probes and performance budget overruns from the preceding
delivery remain documented follow-ups; this review does not claim they pass.
