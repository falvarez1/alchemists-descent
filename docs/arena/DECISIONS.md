# Arena programme: decision log

One entry per decision, newest last. An entry says what was decided, why, what was rejected, and what would make us revisit
it. Ids are stable (`D-001`...). A cut task in `TASKS.md` (`[-]`) must have an entry here.

## D-001 (2026-10-01): two fighters via a slot swap plus a proxy Enemy for every other slot

**Decision.** Each fighter is a *slot* (its own player state, input, controller, wands, flask, fighter system, chill system);
a slot's bundle is installed on the base `ctx` while it acts. Every other slot appears to the bound slot as an `Enemy` of a
new kind `'fighter'`, synced from the real body, whose `damage`/`kill`/`gustShove`/`splashHazard` redirect to the victim's
`playerCtl.damage`. Invariant: all proxies are visible except the bound slot's own. (`ARCHITECTURE.md`)

**Why.** `ctx.player` is read from 134 files (737 lines); everything that can hurt a fighter is written as player-vs-enemy,
and `Enemies.damage` is one choke point with about 28 callers. Redirecting it makes spells, kicks, explosions, flame,
liquids, rigid bodies and every kit's `ctx.enemies` loop work against a fighter with no edits to those systems. Cell hazards
already hurt a second real `PlayerControl` for free.

**Rejected.** (D2) A `Combatant` interface: about 60 sites in hot code, 2.5-4k edited lines, still needs the status/knock
bridge. (D3) The rival as a real `Enemy` kind: its locomotion would not be the fighter's (1,500-line per-kind chain), and role
reversal needs the swap anyway.

**Revisit if** the proxy fidelity gaps (`ARCHITECTURE.md` 8) cost more than a `Combatant` refactor would, or a third and
fourth fighter make slot-ordering asymmetry unmanageable.

## D-002 (2026-10-01): the fighters are for the arena mode, not the campaign

**Decision.** The campaign is the classic Alchemist only (no Fighter row on New descent, no fighter in the ledger, the daily
unchanged). The title's Arena door (authoring builds) opens the roster and starts the Proving Yard. The engine still carries a
fighter on a run so the arena mode can reuse it. **Why.** The user's direction: the roster belongs to a Smash-style arena mode.

## D-003 (2026-10-01): per-fighter physics through a `BodyProfile`, not by editing `PLAYER_PARAMS`

**Decision.** A frozen profile of multipliers on the fighter system, read once per update by `Player.ts`; `PLAYER_PARAMS`
stays shared and unchanged. **Why.** `ctx.params.player` is shared, live-tunable and persisted (`tuningStore.ts:105`);
writing per-fighter values into it would leak into other fighters, the Sandbox and saved tuning. About 35 edited lines; the
classic hero stays byte-identical (`NEUTRAL_BODY`).

## D-004 (2026-10-01): the hitbox stays 4x17 in phase 1

**Decision.** No fighter has a different hitbox yet; weight, speed, traction, jump, gravity and levitation carry the
identity. **Why.** The hitbox constants are read in 70+ places in 24 files (plus literals in `Projectiles`, `explosion`,
`Spells`, the contact shadow) and the rig skeleton is fixed; `docs/FIGHTERS.md` principle 1 ("same hitbox") exists for this
reason. **Revisit** after the bodies and the telemetry exist, as a halfW-only experiment.

## D-005 (2026-10-01): build the telemetry on gauntlets first; keep the schema PvP-ready

**Decision.** The recorder, the override API, the batch runner and the analyser are built against fighter-vs-foe gauntlets
(`FOE_PRESETS`) while PvP is built; the schema carries `src` and `dst` fighter indices from day one. **Why.** PvP is the long
pole (P3); telemetry should not wait for it, and the same data answers "does the fighter work" (damage per second,
uptime, time-to-kill) before it answers "who beats whom".

## D-006 (open): a universal defensive option

**Question.** Smash gives everyone a shield, roll and spot dodge; this game gives the Alchemist none and the fighters each
carry a defensive tool. **Leaning:** a single air-dodge/roll with a stamina cost, so every fighter always has a recovery
option, tuned by telemetry, added in phase 6 after the match rules exist. **Decide by** the first stock-match telemetry.

## D-007 (2026-10-01): batches are statistical, not replayable

**Decision.** Treat fight batches as statistical. Measure the replay-match rate (T2.1) and only then decide whether a replay
tool is worth building. **Why.** Whole-tick determinism is unproven (the entity stream diverges from about tick 14; Rapier
is not the enhanced-determinism build; a few gameplay paths read the wall clock).

## D-008 (2026-10-01): parallelism is capped at 3-4 agents

**Decision.** At most 3-4 concurrent work packages, each on its own Vite port, probes run sequentially. **Why.** The system was
stopped once by memory pressure during a probe batch on this machine.

## D-009 (2026-10-01): arena features are authoring-only until the user says otherwise

**Decision.** The Arena door shows only in authoring builds; nothing in this programme merges to `main` (which deploys) without
an explicit go-ahead. **Why.** A push to `main` deploys the public game.

## D-010 (2026-10-01): D-007 revised: fights ARE reproducible from a seed

**Decision.** Treat a headless duel as reproducible from (build, seeds, overrides): the same inputs gave the same outcome, to the last
digit, across separate page loads (a repeated mirror run gave identical win counts), so a batch can be compared with a previous one and a
single fight re-run to look at it. Still not promised: bit-identical replays of a live (rendered, real-time) fight. **Why.** The paused-step
regime reseeds every stream from (worldSeed, tick); the bots draw from their own seeded Rng; nothing in a duel reads the wall clock. The
replay-match rate over many pages is still to be measured (T2.1).

## D-011 (2026-10-01): a fighter's primary attack is its signature wand, as data

**Decision.** In a duel each fighter carries its own wands, cards and flasks (`content/fighterLoadouts.ts`), applied by the arena; they are
chosen by measurement (`loadout-lab`, `fight-dps`) and kept in one TTK band with different shapes. **Why.** 80% of all damage in a fight is
the primary; while it was the shared Spark Bolt the bodies decided every fight and the kits decided none. **Rejected:** new combat code per
fighter first (6b: it comes after the data version shows which fighters still feel alike).

## D-012 (2026-10-01): the duel's tempo is a dial, and blasts are capped for a fighter

**Decision.** `config/arenaRules.ts` `blowScale` (0.4) scales every fighter's blow on a fighter; a blast does at most 42 to a fighter (the
player's old cap). **Why.** At 1.0 a fight lasted 6 s and the abilities never mattered; an uncapped bomb did 746 damage to a standing foe.
Both are numbers the registry turns (`ftune set arena.blowScale ...`), so they stay open to the telemetry.

## D-013 (2026-10-01): one stand-in, not one per slot

**Decision.** `ArenaSlots` rewrites ONE stand-in enemy to mirror the opponent of the bound slot (1v1) rather than toggling a proxy per slot in
and out of `ctx.enemies`. **Why.** The array is never mutated while a system iterates it (an explosion loops the enemies and calls `damage`,
which binds the victim). **Revisit** when a third fighter is wanted: that needs one stand-in each and the toggling D-001 describes.

## D-014 (2026-10-04): the balance gates measure Hard AND Expert

**Decision.** A fighter must sit inside the balance band at CPU level 4 (Hard) and at level 5 (Expert); both are part of the
official setup (`BALANCE-LAB.md` 3 and 9). **Why.** Win rates shift with skill: simple, safe tools dominate low skill and fall
off at high skill, and the reverse. Gating on both is the most robust definition of balance for a game people will play
seriously. **Rejected:** Hard only (a fighter broken only at high skill slips through); Expert only (blind to what most
players meet); all five weighted (the low levels add noise and the weights are arbitrary). **Revisit** if human telemetry
(L5) shows real play sits outside the Hard-Expert range.

## D-015 (2026-10-04): mirrored personality rotation for the gates

**Decision.** In gate runs both sides of a match play the same CPU personality, rotating through all six across the seeds.
Each fighter's own lobby personality is run and reported, not gated. **Why.** A single profile for everyone measures the
roster through one playstyle and favours the kits that suit it; per-fighter personalities mix kit strength with playstyle
strength, so tuning would partly fix personalities. Mirroring removes the style advantage; rotating covers every style.
**Rejected:** Duelist on both sides (what pass 1 used); each fighter's own; gating on the lobby view. **Revisit** when a
personality is added or removed (the rotation must cover them all).

## D-016 (2026-10-04): fighter data is JSON sheets with a generated schema

**Decision.** One JSON sheet per fighter (body, Duel levers, moves, kit numbers, loadout, CPU hints, identity) in
`packages/fighters`, typed by TypeScript, validated at runtime, with a JSON Schema generated from the types (CI fails when
it is stale) and a `notes` map for field help. Behaviour stays in code. **Why.** Clean separation of data and behaviour;
any tool (the Lab, the tuner, a future web editor or modding) reads and writes it safely; every change is a clean diff.
**Rejected:** TypeScript data modules written through an AST tool (heavier, fragile, TypeScript-only); today's tables with
pattern-matched rewrites (breaks on nested movesets). **Revisit** never for the format; the schema evolves with versions.

## D-017 (2026-10-04): the full move vocabulary, with a required core

**Decision.** The engine, inputs, schema, analyser and CPU support the full platform-fighter slot set (28 slots). Every
fighter must fill 16 core slots; the other 12 are optional and resolve through an explicit, schema-declared fallback table
(`BALANCE-LAB.md` 5.2). Missing core slots are explicit, expiring waivers until each moveset is authored. **Why.** One
architecture that never needs a rewrite, with design and art effort spent where a character's identity lives. **Rejected:**
all 28 for everyone (about 280 moves before the roster is complete); a compact fixed set (the engine and inputs would need
reworking as the game grows); free-form named moves (inputs differ per character; nothing compares like with like).
**Revisit** if a slot proves unused across the roster.

## D-018 (2026-10-04): stale-move negation is a match rule, on by default

**Decision.** A fighter's recently landed moves form a queue; a move in it deals reduced damage and knockback until variety
refreshes it. Rule data in `config/stockRules`, on by default, switchable per mode. The analyser, the KO calculator and the
gates always measure fresh values. **Why.** It structurally discourages one-move spam, so a single slightly strong move
cannot carry a fighter, and it rewards variety; measuring fresh values means it never hides an overpowered move. **Rejected:**
built but off (anti-spam left entirely to numbers); not built. **Revisit** if telemetry shows it makes damage feel
unpredictable to players, or blow concentration does not fall when it is turned on.

## D-019 (2026-10-04): runs are self-contained; drafts are local

**Decision.** Every run record embeds the complete override set, build hash and sheet hashes it played. Drafts are local
working state (`.lab/drafts/`, git-ignored) that can be exported to share. The repository records what was applied: the
sheets, `balance/CHANGELOG.md`, the baseline. **Why.** Reproducibility must not depend on a draft file that can change or
vanish; the repository should hold decisions, not abandoned experiments. **Rejected:** committing every draft; committing
named drafts only (both still need self-contained runs to be reproducible). **Revisit** if a hosted Lab (BL7.3) needs shared
drafts; they would live on the relay, not in git.

## D-020 (2026-10-04): the balance gates are strict, with waivers

**Decision.** The schema and power-budget gates (L0, L1) fail every build. The smoke matrix (L2) is a required check on
pull requests touching fighter, move or arena code. The nightly full matrix (L3) opens an issue and blocks releases on a
fail-level gate. The only escape hatch is a written, expiring waiver in `balance/waivers.json`, reviewed like code.
**Why.** Advisory gates get ignored the week they matter; a required check with a deliberate, visible exception is what
keeps an overpowered change from landing. Determinism (fixed seeds, frozen builds) keeps a required check from failing at
random. **Rejected:** static strict with simulation advisory; everything advisory. **Revisit** if the smoke's cost or a
determinism gap makes the check unreliable; fix the cause rather than loosening the gate.

## D-021 (2026-10-04): the Balance Lab is built after the CLASHFORGED split

**Decision.** The Lab starts once the split (`docs/split/SPLIT-PLAN.md`) has reached at least its phase 6, and is built
directly in the monorepo (`packages/fighters`, `apps/clashforged/lab/`, `tools/clashforged/lab/`). **Why** (the user's
choice): no path churn, built once in its final home under the boundary rules. **Accepted cost:** balance tooling waits on
the split; until then every fighter change follows the interim routine in `BALANCE-LAB-PLAN.md` ("Before the Lab").
**Rejected:** building now in isolated folders (recommended at the time: balance work would proceed sooner); data now and
the Lab later. **Revisit** if the split stalls for long while new moves keep landing.

**Revised 2026-10-04, the same day: the split became two repositories** (`docs/split/SPLIT-PLAN.md` D1: CLASHFORGED gets
a copy of this repository with the full history and deletes the campaign; Descent deletes the arena). The monorepo, its
phase 6 and its packages no longer exist. The decision's reason holds, and is met sooner: the Lab's final home is the
CLASHFORGED repository, which keeps this repository's layout, so the Lab starts there **the day the copy lands** (split
phase 1). Its paths, also for D-016's sheets: `src/content/fighters/sheets/` (sheets and schema),
`src/fighters/analysis/` (the analyser), `lab.html` and `src/lab/` (the page), `src/dev/` (the bridge's game side) and
`tools/lab/` (server, runner, store, gates). The interim routine applies until then.

## D-022 (2026-10-04): CLASHFORGED is hosted as a Cloudflare Worker with static assets; Descent stays on Pages

**Decision.** CLASHFORGED deploys as one Cloudflare Worker with static assets (Ajar Red account). The same deployment holds
the static game, the online Duel's room Durable Objects (one per room) and, later, the Containers for server-run matches.
Its `_headers` file sends COOP/COEP natively. A custom domain, if it gets one, keeps its DNS on Cloudflare. In dev, the
Cloudflare Vite plugin runs the room code in Cloudflare's runtime inside the app's Vite server, replacing the Node `ws`
plugin, so the room logic (`servers/duel/Room.ts`) is hosted once. Descent stays on Pages (`alchemists-descent.pages.dev`)
and GitHub Pages. This revises split decision D5 (`docs/split/SPLIT-PLAN.md`), which had chosen a Pages project; nothing
had been deployed.

**Why.** For static files Workers and Pages are equivalent (asset requests free, server code at the same rate). An online
game needs what only Workers has (Cloudflare's Pages-to-Workers compatibility matrix):
- Durable Objects and Containers **in the same deployment**. With Pages the room server must be a separately deployed
  Worker bound in production and preview, so the site and the server ship on separate schedules and a new client can meet
  an old room protocol.
- The Cloudflare Vite plugin: dev runs the real room code, not a second Node implementation.
- Gradual deployments: a protocol change can reach a slice of players first.
- The rate-limiting binding: abuse control on room creation and joins, required before public play (`docs/DUEL-LAN.md`).
- Workers Logs, Logpush, Tail Workers and source maps: diagnosing production room failures after the fact.
- Queue consumers: ingesting recorded human matches (the Balance Lab's BL7.2) without touching the match.

Descent is purely static (it needs only the COOP/COEP headers), so moving it would gain nothing.

**Accepted costs.** A custom domain must use Cloudflare nameservers (Pages also accepts a CNAME from outside DNS). Workers'
branch previews are less configurable than Pages' (custom branch aliases are still "coming soon"). Early Hints need the
zone setting turned on.

**Rejected:** a Pages project with a separately deployed Durable Object Worker (two deploy units, version skew, no Vite
plugin); a non-Cloudflare host for the room server (the AuthorLink relay already proves Durable Objects here, and the room
logic was written to be hosted that way).

**Revisit** if CLASHFORGED needs a domain whose DNS cannot move to Cloudflare, or if Cloudflare closes the gap (Durable
Objects defined inside Pages projects).

## D-023 (2026-10-04): a Duel replica plays the host's ticks back on the host's clock; own-fighter prediction is built in CLASHFORGED after the copy

**Decision.** The LAN Duel's host publishes a frame at the end of every tick (counted in ticks, never a wall-clock timer),
and its terrain capture compares only what the renderer's contract says can have changed. The guest buffers frames and
plays them back on an estimate of the host's clock: the world and the opponent late enough to absorb measured jitter, its
own fighter as early as the network allows, both interpolated at display rate (`docs/DUEL-LAN.md`, "Replication").
Prediction of the guest's own fighter (restorable slot state, per-tick input stamps, replay of unacknowledged inputs,
terrain write isolation) is the next step, and it is built **in the CLASHFORGED repository after the copy** (split
phase 1), not here. Each snapshot's `ack` (the newest guest input the host applied) is its starting point.

**Why.** The guest's lag was measured, not assumed: a 33 ms wall-clock timer beat against the 16.7 ms tick and delivered
23 uneven frames a second, the full-grid diff cost the host 6-7 ms a frame, and frames were applied on arrival. Fixed,
guest key-to-screen fell from 91 to 53 ms (host: 30-33 ms) and its fighters no longer freeze between frames. This
playback is needed whatever comes later: with server-run matches (D-022) both players are replicas, and prediction only
replaces the controlled fighter's playhead. Prediction waits for the copy (the user's choice, recommended) because it is
Duel-only work that reaches deep into shared engine code (`Player.ts`, `ArenaSlots`) while the split is moving files.

**Accepted cost.** Until prediction lands, the guest's own fighter answers one network round trip after the host's would:
about 20 ms on one machine, plus the network round trip over a real link. Fine on a LAN; not for Internet play.

**Rejected:** rollback (the whole tick is not deterministic and resimulating the cell grid per frame is out of budget,
`docs/BATTLE-ROYALE-AND-SPACETIMEDB.md`); prediction now in this repository (conflicts with the split in progress);
extrapolating the own fighter past the newest frame (overshoots on every stop and turn).

**Revisit** when online play is scheduled: prediction becomes a requirement then, not a refinement.
