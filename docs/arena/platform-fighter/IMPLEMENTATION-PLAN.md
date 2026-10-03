# Arena and Duel: platform-fighter implementation plan

Date: 2026-10-03
Baseline: c90e850
Working branch: feature/arena-stock-matches
Status: implementation started; milestone completion requires the evidence below.

Latest camera checkpoint: Foundry main platform is 480 cells wide, with a separate 1120-by-760-cell blast box. Fighter-follow framing now pans and zooms from 0.4 to 1.65, preserving recovery margin. Expanded world sampling fills wide views on WebGL and WebGPU; wide shots currently use CPU composition. Live performance and visual captures are recorded in EVIDENCE.md. Further camera polish, CPU footwork, controller remapping, combat balance, and music remain active work.

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

## Playtest feedback and revised priorities

The 3 October playtest found the Duel space too small, ring-outs too close to the screen, distracting CPU direction changes, excessive projectile use, solid raised-platform undersides, and unsatisfying music. This feedback supersedes the initial fixed-camera tuning. Finish these revisions before adding more stages or expanding the roster's movesets.

1. Camera and stage scale: enlarge playable space and recovery room together. Derive framing from the bounds and velocity of living fighters. Ease into close combat, pull back promptly for launches, and pan without reversing on every small movement. Keep a stable vertical composition and reserve HUD space. Blast boundaries must remain fixed world coordinates independent of the camera. A fighter leaving a close view must trigger reframing, not death. Implement true expanded world sampling so zooming out never reveals blank image borders. Verify both renderer backends, mouse/world mapping, narrow windows, sudden launches, respawn transitions, and frame times. Capture a repeatable camera sequence for visual review.
2. Raised platforms: pass upward through them and land on the surviving top cells when descending. A jump that ends inside the slab must fall back through it. Preserve the main stage's solid underside and actual destructible-cell geometry. Add deliberate drop-through separately, with a short ignore window instead of disabling all collisions.
3. Close combat: make attack the primary action; constrain projectile cadence with a visible special budget and meaningful recovery. Tune reach, approach movement, hit confirmation, shield pressure, grabs, and throws together so opponents have reasons to close distance. Audit fighter-specific projectiles and abilities, not just the default wand. Measure attack mix and long-range stalling in CPU bouts.
4. Human-like CPU movement: retain a direction or destination long enough to express an approach, retreat, or bait. Add distance hysteresis and minimum commitments instead of repeatedly crossing a single range threshold. Allow urgent threats and edge safety to interrupt. Record reversal counts, idle time, melee attempts, and unforced falls across fighters and seeds, then watch the bouts.
5. Controller-first Duel and Arena: default to an available Xbox-compatible standard controller. User-confirmed button roles are A attack, B special, X/Y jump, LT/RT shield or dodge, LB/RB grab, right stick directional smash, Start pause. Implement shield and grab together before advertising those actions. Keep A confirm/B back in menus. Preserve explicit device ownership, reconnection handling, keyboard accessibility, and two-controller play. Replace the dedicated-GPU tip with a controller recommendation that hides when a controller is connected.
6. Music: replace the current versus soundtrack with an original energetic battle arrangement, using strong melodic phrases, driving percussion, bass, and orchestral/rock instrumentation. Avoid copying existing game melodies. Include a clean looping section and match-opening, final-stock, and result transitions. Listen to actual game playback and check relative loudness against hits, recovery, and KO cues; generated waveforms or code alone do not prove a satisfying score.

Completion means the revised behavior is visible and audible in the playable build, with recordings and measurements in EVIDENCE.md. The existing screenshots document earlier checkpoints and are not approval of the fixed camera or current stage dimensions.

## Visual direction and concept inventory

Use crisp pixel clusters, wet blue slate, worn copper, ivory silhouettes, amber edges, and teal lamps. Quiet backgrounds establish scale; platform tops, fighters, and attacks carry the highest useful contrast. Preserve existing character identities where generated faces or clothing drift.

- concepts/foundry-match.png: primary gameplay composition, open recovery spaces, readable platforms, stock HUD.
- concepts/stages.png: Foundry, Kiln, Cistern, and Gallery environment targets.
- concepts/fighters-actions.png: all ten silhouette targets and an initial action vocabulary.
- concepts/local-versus.png: controller lobby, stage selection, match HUD, and results.
- concepts/motion-defense.png: prototype fighter poses, ground and air dodges, recovery, and restrained state accents. Uses the existing portraits to correct identity drift in the first general sheet.
- concepts/core-attacks.png: Ilyra, Brann, and Mara opener, launcher, aerial, and finisher targets. Exact prompt and portrait references are in concepts/core-attacks-prompt.md.
- concepts/ledge-movement.png: ledge catch, climb, release, and fast-fall targets for the three prototype fighters. Compare against the native runtime captures in the illustrated plan.
- concepts/camera-direction.png: revised close-combat, wide-separation, and offstage-recovery compositions. The generated panels are panoramic; actual camera acceptance uses the game's 16:9 frame and greater bottom clearance.
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

Make the versus runtime and title entry available in the player build. The baseline constructs ArenaSlots and exposes Arena/Duel only behind __AUTHORING__; shipping the existing authoring controls is not the player flow. Keep debug panels and console restricted to authoring builds, and verify the production player build through visible controls.

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

## Defensive movement checkpoint

Ground and air dodges now have three startup ticks, ten movement ticks, eight protected ticks, twelve end-lag ticks, and ten further cooldown ticks. Air dodge is available once before landing; rematch and respawn reset it. Damage during startup/end lag can punish the move. Dodging follows ordinary body collision and cannot tunnel through metal.

The default keyboard action is K, rebindable in Controls. Left bumper dodges in stock matches. Existing campaign bindings remain intact, including older saved layouts whose clip key already occupied K. CPU fighters can request the same dodge after their existing delayed projectile perception and check the full roll distance before choosing a direction.

The HUD shows separate recovery-burst and air-dodge resources. The renderer uses lowered/tucked poses, short silhouette echoes, a broken evasion arc, and fighter-colored recovery/launch trails. Reduced-flash settings suppress the echoes and reduce effect density. The illustrated plan includes native gameplay details for ready, ground dodge, air dodge, and recovery across Ilyra, Brann, and Mara.

Milestone 2 still needs broader movement tuning, ledge behavior, and complete recovery-distance coverage. Later attack, controller, lobby, stage, and multiplayer work remains in scope.

This checkpoint passed 3,194 tests across 250 files and the defensive movement browser probe. At that point the mode still ran through authoring-only entry points. The following implementation slice brought versus into the player build and assigned independent devices before further content expansion.

## Player-facing versus checkpoint

The title now opens a dedicated Duel lobby in both player and authoring builds. Two portrait cards follow the local-versus concept with amber/teal player identity, fighter and device selection, individual readiness, the Foundry stage card, and fixed three-stock/six-minute rules. All ten existing fighters are selectable. Other stages remain planned.

Keyboard plus controller and two controllers have independent seat ownership. A controller joins by pressing A, changes its fighter with the d-pad, readies with A, and starts with Start. One controller cannot own both seats. Unplugging a controller pauses the match; reconnecting requires explicit resume. A CPU can fill either seat.

The stock HUD runs independently of the authoring panel. Results use the winner's existing portrait, stocks remaining, attributed ring-outs, rematch, and change-fighter actions. Pause can restart the match or return to the title. Signature wand loadouts stay fixed during versus.

Browser dogfood uncovered an existing lifecycle problem: entering a disposable arena ended the tracked campaign and removed its checkpoint. RunDirector now suspends that run when starting an untracked arena. The regression covers checkpoint preservation and restoring phials; the browser checks the actual saved checkpoint and Continue flow.

The lobby and result screen now follow the concept's composition and slate/copper palette using established portraits. Ornamental framing, more stage choices, richer native fighter animation, attack roles, and the remaining Arena variants still need implementation. Synthetic gamepads verify ownership and reconnect behavior; physical controller feel remains unverified. See EVIDENCE.md for the latest checks and captures.

Validation at this checkpoint: 3,208 tests across 252 files, typecheck, lint, build, development and production local-versus probes, the 16-check health-duel probe, and stock mechanics/recovery dogfood. The performance limits from the preceding sample still apply.

## Core attack prototype checkpoint

Ilyra, Brann, and Mara now have four stock-only melee roles with separate authored timing, reach, damage, launch direction, volatility growth, and hitstun. F / controller B uses an opener on the ground and an aerial in the air; up plus melee launches, and down plus melee commits to a finisher. Bindings remain configurable. Existing spells and tactical abilities remain available outside the attack commitment.

An attack locks its facing, waits through startup, hits each victim once, and has punishable end lag. Real solid cells block contact. Both contacts are collected before damage so simultaneous attacks can trade. Incoming launch interrupts the attack; existing armor resistance still applies. Dodge, casting, flasks, and abilities cannot cancel the commitment. The other seven fighters currently use Ilyra's common prototype timings pending their authored pass.

The new ImageGen sheet uses the three existing portraits. Native poses now show a drawn-back windup, extended or raised striking arm, airborne leg spread, and finishing follow-through. Brann's shield follows the attacking hand; Mara's bell follows the strike. Browser comparison prompted a second art pass: quick strikes and Ilyra's finisher use a narrow contact spark, Brann ends in a low shield slam, and Mara keeps violet sweeps. The HTML includes startup/contact pairs from the running game.

The attack browser probe covers real keyboard input, delayed and exactly-once contact, unchanged HP, solid-wall blocking, punishable end lag, action/resource locks, interruption, and preservation of held jump during an aerial. The local-versus probe also verifies that controller B attacks only its assigned fighter. Unit coverage includes simultaneous trades and bounded growth/stun. The complete suite passed 3,218 tests across 253 files at this checkpoint.

This is a prototype milestone. The shared post-hit immunity still applies; no multi-hit moves or guaranteed launcher-to-aerial combos are claimed. Full roster moves, ledges, broader recovery/balance trials, differentiated impact audio and rumble, remaining stages, Arena variants, and final art parity remain in scope. Native character detail and some weapon arcs remain simpler than the concepts.
