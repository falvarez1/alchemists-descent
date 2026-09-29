# Sandbox MT prototype: a multithreaded sweep and a sub-cell look

Status: **prototype** on branch `proto/sandbox-mt` (2026-09-29). Only the Sandbox
world uses it. Levels, the Builder and saves are unchanged.

The goal: make room for finer, busier material scenes. That means a sim that
scales across cores (Noita's approach, Web Workers over shared memory) and a
render that looks finer than the cell grid without simulating smaller cells.
The half-size-cell preview measured 4.3x the sim cost and 5.5x the compose
cost, which is why this route was taken instead.

## Part A: the multithreaded sweep (`src/sim/parallel/`)

| file | role |
|---|---|
| `sharedWorld.ts` | `createSharedWorld()`: the Sandbox World on SharedArrayBuffers (grid planes, charge flags, scar mask, activity planes, flow planes). `viewSharedWorld()` builds a participant's World over the same memory, with a `ParticipantActivity` touch recorder and logged charge/scar sets. |
| `ParallelFlow.ts` | FluidFlow over flat planes. Water flights are stored per cell (lazily expired, no global cap). The tile decay list is a flag plane. The pressure memo is per participant and reset per chunk. |
| `protocol.ts` | Control-block layout and the **wavefront schedule**. |
| `chunkSweep.ts` | `Participant`: the reclassify phase and the chunk sweep (the dispatch mirrors `Simulation.processFrame`; **keep them in step**). Also holds the narrow rule ctx that records side effects. |
| `effectLog.ts` | Per-participant records (particles, audio, events, blasts, charge/scar Set edits, large touches), segmented by chunk. |
| `simWorker.ts` | The worker loop: spin briefly, then `Atomics.waitAsync`, so tuning messages still arrive. |
| `ParallelSim.ts` | Main-side pool. It drives both phases and replays effects in schedule order. |

**Enabling it.** Use `?threads=N` (0 = serial). The default is cores−2, capped
at 6. It needs cross-origin isolation: `vite.config.ts` sends COOP `same-origin`
and COEP `credentialless` on dev and preview. A static host needs the same two
headers, e.g. a Cloudflare Pages `_headers` file. Without them there is no
SharedArrayBuffer, so the Sandbox runs serial. The runtime A/B switch is
`__game.ctx.simulation.parallel.enabled`.

**The substep.** Everything around the sweep stays serial on main, exactly
where `Simulation.processFrame` runs it: the reseed, the moved epoch, flow
decay, harvester, electrical, projectiles, shockwaves, the growth pass. Two
phases run on every participant; main is always one of them.

1. **Reclassify.** `ActivityGrid.beginStep` is split into `prepareStep` (serial:
   halo flush, full reset on invalidate), `reclassChunk`, and `scheduleStep`
   (serial). Chunks are independent, so they are simply claimed off a cursor.
   Growth-set edits come back as a log.
2. **Sweep.** Chunks run in the wavefront order below. Each chunk reseeds its own
   sim and fx streams (`reseedSimChunk`) and logs its side effects. Main then
   unions the participants' seed boxes (`adoptSeedBox`) and replays the logs
   in schedule order. Blasts go last, from their own stream.

**The wavefront.** Rows run bottom-up. Within a row, even columns run before
odd ones. Chunk (c, r) waits for (c−1..c+1, r+1) and, in an odd column, for
(c±1, r). A ready queue drains it: finishing a chunk decrements its
dependents, and whoever zeroes one pushes it. By induction over the order:

- chunks that run at the same time are always ≥ 2 columns apart;
- while (c, r) runs, every chunk below it in columns c−1..c+1 is done, and
  every chunk above it waits on it.

So a rule may touch its whole vertical band, as long as it stays within
**REACH = 32** cells horizontally. The pressure solver keeps its 192-row
surface scan; only its row scan is clamped, to ±30 around the chunk.

**Why not Noita's 2×2 checkerboard?** It was built first and measured against
the serial sweep on the multi-chunk golden fixture (four seeds, 150 ticks). It
gave **+25% fire, +23% steam, −12% water**. Two causes, bisected:

- A clamped pressure solver: deep pools stopped transmitting pressure. Deferring
  those hops to main made it worse, because after the sweep the pool's surface
  has already moved.
- Half the seams run upper-before-lower.

The wavefront lands within the seed-to-seed spread: sand −0.7%, water +0.1%,
steam −2%, fire +5%.

**Determinism and the tests.** The result does not depend on thread count or
timing. `tests/parallel-sweep.test.ts` proves that the list order, the
latest-possible order and random topological orders all hash identically.
That covers state, colours, and the insertion order of the charge and scar
Sets. The parallel reclassify hashes identically to the serial `beginStep`,
down to the activity planes and growth lists. Statistics stay within 10% of
the serial sweep. The serial path is untouched: the sim goldens are identical.

**Probes** (dev server running):

- `scripts/probe-sandbox-mt.mjs --threads N [--scene flood|wide|pool]` records
  interleaved serial vs parallel timings on the same shared world, with a
  phase split and per-participant busy/wait times. It also takes screenshots
  at equal times.
- `scripts/verify-sandbox-mt.mjs` checks every replayed path: explosion replay,
  charge conduction with the index matching the plane, particles,
  `world.clear()`, and a real Play round trip.
- `scripts/diag-sandbox-mt-frames.mjs` (Node) renders serial and chunked
  cell-type frames for visual parity.

### Measurements (Edge, Core Ultra 9 285H: 6P + 8E + 2LPE)

Sim time is ms per tick (one substep), serial → parallel, on the same page.

| workers | flood 640×340 | wide 1400×340 |
|---|---|---|
| serial | 9.0–10.0 | 17.5 |
| 2 | 3.64 (2.55x) | 8.77 (1.97x) |
| 3 | 3.23 (2.82x) | 6.78 (2.58x) |
| 4 | **3.00 (3.00x)** | 6.07 (2.87x) |
| 5 | 3.44 | 5.32 (3.29x) |
| 6 | 3.29 (2.70x) | 4.98 (3.55x) |
| 8 | 3.68 (2.54x) | **4.57 (3.90x)** |

- The serial sweep on a plain (non-shared) world measured 10.0 ms, so shared
  memory costs nothing.
- The flood is narrow (10 chunk columns), so the wavefront has little width to
  use, and threads past the P-cores start landing on E-cores. Bigger scenes keep
  scaling, and bigger scenes are the point.
- Phase split, flood at 4 workers: reclassify 0.7 ms (halo flush 0.23), sweep
  2.1 ms, merge 0.2 ms.
- Found along the way: the serial grid stores its per-chunk flags on every
  swap. Shared between cores, those few cache lines bounced constantly.
  Storing only on change cut per-thread sweep work from 2.17 to 1.70 ms.

**Known limits and next steps.**

- Explosions, particles and audio from the sweep land after it, not
  mid-sweep; they arrive in the same substep.
- The secret-alchemy toast is replayed on main.
- A very wide pool draws pressure donors from about 120 columns around the
  outlet, not 384.
- Next: flush the halos in parallel; make the participant count adaptive (the
  flood peaks at 4, wide scenes at 8+); try smaller sweep units. 64×64 is the
  activity chunk, and the horizontal reach needs the column to be at least
  2 × REACH wide.

## Part B: the sub-cell look (`postFx.subcell`, GPU compose)

This is look only; the sim never sees it. It's on by default in this branch,
off with `?subcell=0`, and togglable live with
`__game.ctx.state.postFx.subcell`. Each fine pixel (2×2 per cell) of a loose
material (powders and liquids) is drawn in one of three ways:

- **Silhouettes (Scale2x).** The pixel looks at the two neighbours on its own
  side of the cell and the two opposite. Where its own-side pair agree, differ
  from their opposites and differ from this cell, the pixel takes that
  neighbour. Piles and pool rims then step at the fine-pixel pitch. Rock keeps
  its authored blocks; the existing half-cell bevel still handles terrain art.
- **Lone grains and droplets.** A loose cell with open air on all four sides
  draws as ONE fine pixel, chosen by its colour so it holds still in flight.
  Spray and sifting sand then match sparks and embers, which were already
  fine-pixel sized; that was the "particles are smaller than cells" complaint.
- **Powder grain.** Each fine pixel of a powder cell gets ±7% brightness,
  hashed from the cell's own colour, so the pattern rides with the grain.

`scripts/shot-subcell.mjs` renders on/off comparisons at 3x zoom: settled piles
and a mid-air spray. The CPU `FrameComposer` has no sub-cell reference yet, so
`probe-compose-parity.mjs` turns it off. Separately, that probe's S0–S3/S6
assertions already fail on main (78ae45b, identical numbers), which is not
caused by this branch.
