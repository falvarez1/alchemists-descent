# Arena and Duel: platform-fighter implementation plan

Date: 2026-10-03
Baseline: c90e850
Working branch: feature/arena-stock-matches
Status: implementation started; milestone completion requires the evidence below.

## Objective

Build a readable local platform fighter around damage, launch, recovery, and ring-outs while retaining Alchemist's Descent's material simulation and fighter identities. Use the ImageGen concept sheets as visual targets, then compare real gameplay captures against them. A generated concept is not evidence of implemented gameplay or visual parity.

Duel is the controlled competitive mode. Arena is the training ground and home for optional hazards, destructible terrain, items, and eventual group matches. Keep health duels selectable. Campaign behavior and save formats stay independent.

## Findings at baseline c90e850

- Ten fighters already have distinct body profiles, movement techniques, signature loadouts, kit abilities, and procedural sprites.
- Player movement already includes variable jump height, coyote time, buffered jumps, levitation, wall interaction, and mass-adjusted impulses.
- Damage currently subtracts health. Knockback is not driven by accumulated damage; hitstop exists.
- ArenaSlots owns two fighter bundles and one opponent proxy. This is deliberately a two-player implementation, not a ready four-player engine.
- A health knockout immediately ends the bout. There are no implemented stock lives, blast boundaries, or match timer.
- The current Duel stage is a closed, metal-backed room. Its fixed view does not test offstage recovery.
- CPU behavior includes delayed perception, projectile prediction, hazard-aware movement, mana conservation, and fighter-specific playbooks. Offstage recovery and stock strategy need dedicated work.
- Gamepad support selects the first connected standard controller. Local versus needs explicit device ownership.
- The current duel panel exposes rival and bot controls useful for development. A player-facing lobby, match HUD, and results flow are still needed.
- docs/arena/ARENA-RULES.md already proposes stocks and volatility. Its proposed weight and HP formula must be reconciled with current body.mass and body.maxHp, avoiding double weight scaling.
- Direct hazard damage paths also exist outside Player.damage. All of them need auditing for stock rules.

## Visual direction and concept inventory

Use crisp pixel clusters, wet blue slate, worn copper, ivory silhouettes, amber edges, and teal lamps. Quiet backgrounds establish scale; platform tops, fighters, and attacks carry the highest useful contrast. Preserve existing character identities where generated faces or clothing drift.

- concepts/foundry-match.png: primary gameplay composition, open recovery spaces, readable platforms, stock HUD.
- concepts/stages.png: Foundry, Kiln, Cistern, and Gallery environment targets.
- concepts/fighters-actions.png: all ten silhouette targets and an initial action vocabulary.
- concepts/local-versus.png: controller lobby, stage selection, match HUD, and results.
- concepts/prompts.md: exact ImageGen prompts and provenance.

These are concept sheets, not sprite atlases. Do not paste a flattened gameplay painting over the game. Build collision from real cells; decorative art must remain distinguishable from playable surfaces. Generate separate background or sprite assets when the renderer needs them.

Palette targets: deep slate #142334, distant steel #293e51, worn copper #ac744b, warm ivory #e8dcc0, amber #efac58, teal #65cac5. Use the project's existing fonts for game UI; the illustrated plan uses Georgia headings and system sans-serif body text for offline portability.

## Milestone 0: plans, concepts, and baseline

Deliver the Markdown plan, a responsive offline HTML edition with all concept images, prompt provenance, and an implementation evidence log. Capture the existing local Duel screen before changing gameplay. Record the branch and baseline revision.

Acceptance: both documents open locally; all image paths resolve; HTML works at desktop and narrow widths; proposals and completed work are distinguishable.

## Milestone 1: one playable stock duel

Implement in this order:

1. Introduce typed match rules and a match director for health versus stock rules, stock counts, volatility, remaining time, respawn delay, protection, winner, and draw handling.
2. Add pure, tested launch calculations with attack direction, base impulse, damage growth, and bounded hitstun. Apply body mass exactly once. Healing and damage-over-time have explicit stock semantics.
3. Route direct hits and environmental damage through the stock damage seam. Volatility alone cannot kill; crossing blast boundaries loses one stock. Guard duplicate KO events.
4. Check all fighters for ring-outs before deciding the winner so simultaneous last-stock KOs do not favor slot order. At timeout compare stocks, then lower volatility; an exact tie is a draw initially.
5. Respawn with cleared transient state and finite invulnerability. Reset volatility, momentum, status, recovery resources, projectiles that would unfairly spawn-camp, and hit attribution as appropriate. Preserve the opponent's live stock state.
6. Build the Foundry as actual Metal/Stone cells with one main platform, two raised side platforms, open recovery space, and an explicit blast box inside world limits.
7. Add an accessible stock-rules selector, timer, percentage/stock HUD, result, and rematch. Keep health-duel probes valid.
8. Retain existing levitation as the first recovery system, with a controlled upward recovery action and limited aerial resources added in milestone 2.

Initial numbers are tuning hypotheses: 3 stocks, 6 minutes, brief respawn delay, 2 seconds of protection. Match clocks use simulation ticks, not wall time, and pause when gameplay pauses.

Primary files: src/core/arena.ts; new src/core/arenaMatch.ts, src/arena/MatchDirector.ts, src/config/stockRules.ts; src/arena/ArenaSlots.ts; src/entities/Player.ts; src/world/duelStage.ts; new src/world/stockStage.ts; src/ui/ArenaDuelPanel.ts; arena styles.

Acceptance: a real attack raises volatility; the same blow launches farther at high volatility; each boundary costs exactly one stock; respawn restores control; simultaneous KOs and timeout are deterministic; rematch fully resets. Verify both human-controlled and bot bouts in a local browser. Campaign and health duel regressions pass.

## Milestone 2: recovery, movement, and defense

Add readable launch/tumble states, bounded directional influence, short-hop tuning, fast fall, and safe platform traversal. Prevent normal friction and speed clamps from immediately erasing launch momentum. Keep attack restraint distinct from player input used for directional influence.

Give each fighter a recovery budget with clear resets on landing and respawn. Start with Ilyra, Brann, and Mara to cover agile, heavy, and floaty bodies. Ensure all fighters remain selectable without impossible recovery. Add predictable ledge catch/release behavior only after real-cell ledge detection is reliable.

Add a shared grounded dodge and one air dodge per airborne sequence. Both have visible startup/recovery and punishable end lag. Defense may not erase Brann's plate or Edda's prism identity. A universal shield is a later design decision; if added, ship grabs or another intentional counter at the same time.

Acceptance: measured recoverable launch distances; no infinite hovering or repeated invulnerable dodge; no permanent stun; explicit tests for resource reset, DI bounds, ledge destruction, and collision at maximum launch speed. Runtime probes exercise recovery by inputs, not only teleporting.

## Milestone 3: attack roles and readable combat

Prototype Ilyra, Brann, and Mara first, then expand to the other seven fighters.

Each prototype needs a quick opener, upward launcher, aerial attack, committed finisher, and recovery move. Existing spells and tactical abilities remain part of the identity. Store startup, active frames, end lag, damage, launch direction, growth, hitstun, and hit IDs as data.

Replace blanket post-hit immunity with attack-aware hit accounting where needed so multihit moves work without permitting accidental repeated contact. Audit reflected, persistent, piercing, area, and hazard ownership. Avoid changing shared campaign timings.

Map actions to a coherent keyboard/gamepad vocabulary. Animation anticipation, contact, follow-through, launch trails, impact sound, hitstop, and rumble must describe the same event. Honor reduced motion, reduced flashes, and rumble preferences.

Acceptance: players can punish a missed finisher, launch into an aerial, and choose an attack by position. Tests cover exactly-once hits, multihits, interruption, trade hits, and projectile ownership. Browser captures show silhouette and active-hit readability.

## Milestone 4: local versus as a complete flow

Add independent input devices per slot, press-to-join, per-player fighter selection, stage/rules selection, readiness, countdown, pause, results, rematch, and change-fighter flow. Keyboard plus gamepad and two gamepads must both work. Disconnect pauses with a clear reconnect path; one controller cannot operate both fighters.

Move development controls into an optional training panel. Put percentages and stocks at the bottom, timer at the top, and reserve the center for action. Show player identity by shape/label as well as color.

Fit the camera to live fighters and meaningful recovery space within scale limits. If the render architecture cannot support zoom safely, keep the first stage entirely within a fixed view and use honest offscreen indicators. Do not let camera position determine whether an offscreen fighter's physics runs.

Acceptance: complete the local flow through visible controls, test device disconnect and rematch, verify narrow-screen overlays, keyboard focus, and safe HUD placement. Physical-controller feel remains a human check beyond synthetic browser gamepad tests.

## Milestone 5: bots that understand stocks

Add recover, contest landing, hold center, juggle, pursue finish, and disengage intents. Recovery must outrank firing when a fighter is below or outside the main platform. Choose a reachable landing using current cells and remaining resources.

Retain tunable behavior and delayed perception. Difficulty changes reaction delay, prediction, commitment, and mistakes, not hidden damage or impossible information. Teach defensive timing and deliberate risk without repeated self-destruction.

Acceptance: seed-controlled matches across sides and fighter weights; record recoveries attempted/succeeded, unforced self-destructs, time near edges, ring-outs, and timeouts. Use actual browser inputs and moving opponents. Win rate alone does not prove good behavior.

## Milestone 6: Arena variants and the full roster

Translate all ten fighters toward the silhouette/action sheet while preserving recognizable existing looks. Add Kiln, Cistern, and Gallery from the concept sheet as authored stages. Competitive variants have stable collision and hazards off; Arena variants permit controlled material interactions.

Hazards are finite real-cell systems with clear telegraphs. Stage collapse is optional, never the default Duel timer answer. Add items only after base combat works. Keep respawn and recovery areas free of unavoidable hazards.

Before three/four-player free-for-all or teams, replace the single opponent proxy with per-slot proxies, audit targeting and owner binding, remove two-slot assumptions, update camera/sim budgets, and test team-aware damage and abilities. This is a separate architecture milestone.

Acceptance: symmetric competitive spawns and mirrored-match tests; no sealed fighters; bounded simulation cost; reproducible stage reset; every new variant has a runtime probe. Network multiplayer is a later project after local play is stable.

## Visual dogfood loop

For each changed screen, stage, fighter, and major effect:

1. Capture a fixed local scenario at the same viewport, camera, lighting, and fighter positions.
2. Compare with the relevant concept: composition, collision silhouette, palette, material treatment, fighter readability, effect restraint, HUD hierarchy.
3. Record specific differences in EVIDENCE.md. Fix the largest mismatch, recapture, and retain useful before/after evidence.
4. Play a normal match with ordinary inputs after staged screenshots. A beautiful forced screenshot is insufficient.
5. Repeat until the implemented milestone matches the target's achievable composition and style, or record the unresolved gap clearly.

Visual acceptance: platform proportions within roughly 10% of the selected layout target; clear top edges and recovery gaps; background substantially quieter than fighters; copper/slate/amber/teal material identity; no UI over the combat center; readable silhouettes at native view size. These checks guide review and are not a claim of pixel-identical generated art.

Measure frame timing with the existing perf overlay/probe. Preserve the project's sim/entities/render budgets and compare like-for-like scenes on the same machine. Do not trade away input responsiveness for decorative fidelity.

## Engineering and regression gates

- Work in an isolated sibling worktree. Preserve unrelated worktrees and user changes.
- Write a failing regression test before each behavior fix. Add focused unit coverage for new match rules.
- Use Ctx contracts, typed EventBus events, and in-place shared arrays. Do not reorder Game phases casually.
- Cell IDs remain append-only. Reuse existing materials; no new material IDs are required for the first stage.
- Sandbox grid saves, Builder documents, and expedition saves remain separate.
- An authored test-stage change is not procedural campaign generation. Bump GEN_VERSION only if procedural worldgen changes.
- Run targeted tests during implementation. At milestones run typecheck, suite, lint, build, and relevant local runtime probes.
- Check exactly-once damage, owner binding, asynchronous rival lifecycle, health equality, stage reset, and campaign exit.
- Validate documents in a browser and inspect real captures. Never claim runtime or visual parity from static code alone.
- Keep requested concepts, plans, and selected evidence. Remove disposable output, logs, fixtures, and task-owned processes after use.
- Do not deploy or publish this work as part of this plan.

## Delivery sequence and completion

Milestone 0 precedes implementation. Milestone 1 establishes the playable loop. Milestones 2 and 3 refine the loop before balancing the full roster. Milestone 4 completes local versus; milestone 5 extends CPU play; milestone 6 expands content and player count.

The first playable acceptance target is one open Foundry stage, three contrasting fighters, three stocks, damage-scaled launches, dependable recovery, two independent local inputs, and a readable HUD. Complete means gameplay probes and actual local dogfood pass, the documents record remaining limitations, and captured game art supports the claimed visual match.

See EVIDENCE.md for actual progress. This plan does not mark unbuilt milestones complete.

## First implementation checkpoint

The documents and five ImageGen outputs are saved. The first stock-match implementation includes three stocks, volatility-scaled launches, blast boundaries, countdown, respawns, draws, timeout rules, directional influence, a recovery burst, Foundry navigation, real-cell platforms, the generated backdrop, and a portrait HUD. Health duels remain selectable.

Local verification passed 3,185 tests, typecheck, lint, production build, stock mechanics and presentation probes, and six mirrored recovery cases across Ilyra, Brann, and Mara. Visual iterations deepened the platform and furnace emblem, moved lamps out of recovery paths, and moved portrait-screen HUD cards below the game view.

The complete roadmap and visual match remain in progress. The art still needs fighter/action refinement, detailed stage structures, trails, and complete lobby/results screens. Local controller ownership and defensive/attack depth remain upcoming work. The short performance sample exceeded render sub-budgets; it is not a performance pass. EVIDENCE.md records the exact measurements and limitations.
