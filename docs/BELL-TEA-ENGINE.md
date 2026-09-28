# The Unreasonable Bell & Tea Engine

The first level's required bell-making workshop occupies the hall above the Intake's inspection catwalk. Its crank stands on the balcony at the end of the Intake, behind the oil-soaked timber barricade a new alchemist burns with a Spark Bolt in the first few seconds (see DESIGN.md); there is no other lock. While the barricade stands, the engine's caption card stays hidden, so the only instruction on screen is the barricade's. Pulling it (E by default) starts a physical chain reaction that casts the brass bell the lower descent gate requires. Walking past the machine cannot clear the level.

## Played, not watched

The engine is **played**. The alchemist keeps every control while it runs; there is no cutscene and no input lock. Every station sits in the lower half of the hall, directly over the catwalk, so the player walks east beneath the chain as it happens. While the engine runs and the player is in the hall, the camera frames the hall from the catwalk to the roof at 1.2× zoom (1× with reduced camera motion) on the active station, clamped so the player never leaves the shot. At the duck's bath the frame drops so the bath shows. Leave the hall and the normal camera returns; the chain keeps running either way (the director keeps the whole hall, the catwalk and the bath in the simulation window).

Three stations are **built to stop**. Each has a service fixture hanging into the catwalk that a *starting verb* fixes, and each has a slow physical **backup**, so waiting is always a choice and nothing ever depends on the player:

| Station | What stops | The verb | The backup |
|---|---|---|---|
| Ignition | The first fuse always dies at a cracked metal coupling | **A wand shot** at the brass priming pan under the floor. The pan's percussion cap fires on any projectile strike (the `structureStrike` every impact announces), and its current runs through the floor into the coupling and lights the powder beyond it. A Spark Bolt's own blast current does the same, so a player who slotted another card over Spark Bolt still has the verb | A slow match creeps along the catwalk ceiling from the striker to the pan (9 s) |
| Tollgate | The boulder fetches up against a gate that will not lift | **Kick** (F) the Persuader, a brass weight on a chain. The chain runs up through the floor over two pulleys to the ratcheted gate | A clockwork knocker beside it winds up, then whacks the Persuader (10 s) |
| Downpipe | The header tank drains into a clogged downpipe | **Pour water** (Q, starting flask) through the grate into the duck's bath under the catwalk. The floating duck's rod lifts the marble's pin | The clog seeps: one real water cell every 6 ticks moves from the pipe to the nozzle over the bath (~9 s) |

While a station waits, its fixture pulses with a halo. The caption card at the top of the frame shows the verb with its live key binding and a meter for the backup's progress.

## The chain

1. **First, a little powder.** The crank's striker lights a fuse on a stone bed along the hall floor. It burns to the cracked coupling and dies. *(Fault: spark the pan.)*
2. **The knot is the fuse.** The pendulum's hemp cord runs from the bob over a pulley and down to a cleat set in the fuse. Fire at the cleat is the cut. The steel chain survives, and the bob swings into the boulder.
3. **Downhill, briskly.** The boulder rolls down a ramp to the tollgate. *(Fault: kick the Persuader.)*
4. **Six dominoes and a wound spring.** Released, the boulder topples six dominoes. The last falls against a backstop (it can no longer jam the crank) and its cable draws the latch out from under the torsion-spring crank.
5. **The spring lets go.** The crank whips round and its cable lifts the header tank's plug. The tank drains into its downpipe. *(Fault: pour water for the duck.)*
6. **A marble of some urgency.** The duck's rod lifts a pin. A steel marble runs 260 cells of rail (slope 0.25, top guard rail) and strikes the flint at the head of the second fuse.
7. **This is probably enough heat.** The second fuse runs past three packed charges. The last blast burns the copper tea bag's cord.
8. **A most electrifying tea bag.** The falling copper bag is a linear generator (opposing drag). Its current runs up the real overhead wire to an electromagnet.
9. **The magnet has opinions / Gravity gets the last word.** The coil pulls the iron latch from under the counterweight. Its braked drum and four pulley strands lift the bell latch, and the bell drops to the receiver below the catwalk's east end.

A player who answers each fault within a second or two finishes in about 24 s. Nobody helping at all finishes in about 47 s.

## Rules the director keeps

- **Every stage advances on physical evidence.** Examples: fire in the fuse's tail, a cut cord, a body's travel, plate travel, a charge's powder gone, current at the magnet's terminal. Linkage plates move one cell at a time by `World.swap` (`pullTeaValve`), ratcheted, and jam on obstruction. No material is conjured: the seep moves existing water cells, and the tank is sized so the bath can never overflow onto the route.
- **Linkages engage in causal order.** The duck's rod only lifts the pin once the engine reaches the duck, so a bath filled early cannot fire the finale out of order.
- **Never hard-locks.** Every non-fault stage has a watchdog. After a few seconds without progress it applies a visible nudge to the stuck body (the striker re-strikes, the boulder or a domino gets a shove, the marble a flick). After repeated nudges it forces the linkage (a plate pulled home, a cord cut, the reserve cell discharged into the wire, the bell gate opened). A blast-open bell gate counts as success.
- **A disturbed engine recharges on the crank.** The fuse can be sparked, or the Persuader kicked, before the crank is pulled (the catwalk is reachable from below). In that case, pulling the crank first re-stamps the hall and re-spawns its props, so every run starts whole. The labelled maintenance recharge still exists for a stalled save. Neither touches the rest of the level.
- Plates wake any sleeping body resting beside them when they move (a marble asleep against its pin would otherwise never roll).

## Implementation

- **Geometry and constants:** `src/world/teaMachine.ts` holds `TEA`, `TEA_STAGE`, `TEA_VALVES` (gate, spring, tap, pin, bell), `TEA_BODIES` and `TEA_BACKUP`, plus `stampTeaMachine` (repair re-stamps only `TEA.bounds`).
- **Director:** `src/game/TeaMachine.ts` owns the stage checks, watchdogs, backups, seep and camera framing.
- **Linkage drawings:** `src/render/TeaMachineLinkages.ts` draws cables, rods, pulleys, the slow match, the knocker, halos and the rails. `src/render/TeaMachineDecor.ts` draws the duck.
- **Caption card:** `src/ui/TeaMachineOverlay.ts`, fed by the `contraptionView` event (title, detail, and `fault` with its verb, prompt and backup progress).
- **Saves:** expedition saves keep every surviving prop's pose and velocity, rope and tether flags, plate travel, the watchdog and fault counters, and the stage. Restores are bounded (`restoreTeaMachine`) and cannot manufacture completion.
- **Lower Bell gate:** the bell opens a real floor grate (`WORKS_GATE` in `src/world/breathingWorks.ts`; `LivingExpedition` slides its two metal leaves into their slots with `World.swap` once the bell is carried within 95 cells), and `Levels` starts the descent only once the pit is clear. `render/WorksFixtures.ts` draws its archway, lock bell and bars, and the barricade's straps and sign.
- **Generation:** `GEN_VERSION` 48 records this layout (47: the engine; 48: the opening's barricade, the cold lock's removal and the floor grate). Earlier-generation expeditions are retired as usual.

## Validation

- **`tests/tea-machine.test.ts`** runs the whole chain through the real cell simulation, rigid bodies and director across three seeds, in two modes:
  - a scripted player answering each fault with the verb's real effect;
  - nobody helping, where the backups must finish it.

  It also covers:
  - the coupling always holds and the pan relights it;
  - recharge-on-crank;
  - out-of-order protection;
  - watchdog forcing;
  - fail-open bell gate;
  - camera framing that keeps the player in shot without taking control;
  - simulation bounds;
  - bell gating, resume and bounded restore;
  - generator/magnet, hinge, plate-conservation and cord-cutting physics.
- **`scripts/trial-tea-machine.mjs`** runs the real game tick as fast as the CPU allows. By default a scripted alchemist uses the *real* verbs: a Spark Bolt through the wand system, the player controller's kick, and the flask's pour. `--idle` runs with nobody helping, `--away` with the player elsewhere in the level, and `--enemies` keeps the level's creatures alive.
- **`scripts/film-tea-machine.mjs`** films it in real time, with an autopilot walking the catwalk on the real movement keys.
- **`scripts/verify-living-traversal.mjs`** plays it with real input as part of the full D1 route: it clicks the pan, presses F at the Persuader and holds Q over the grate.
