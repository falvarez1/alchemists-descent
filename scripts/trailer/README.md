# Trailer capture harness

Deterministic, frame-perfect 60 fps gameplay capture for the Breathing Works
trailer. Every shot is a script; any shot re-records identically.

```bash
npx vite --port 5330 --strictPort                 # dev server (window.__game is DEV-only)
node scripts/trailer/capture.mjs --list           # the shot registry
node scripts/trailer/capture.mjs oil-fire kick    # record shots -> footage/<id>.mp4 + <id>.json
node scripts/trailer/capture.mjs --all            # everything (--priority P0 to filter)
node scripts/trailer/capture.mjs --sheet          # rebuild footage/shots.json + contact-sheet.png
node scripts/trailer/capture.mjs oil-fire --stills 30 --stills-dir <dir>   # staging preview, no video
```

Options: `--url` (default `http://localhost:5330/`), `--out` (default
`../trailer/footage`), `--no-sheet` (skip manifest + contact sheet), `--headed`.

## How it works

- **Virtual time** (`lib/virtualTime.mjs`, an init script): `performance.now`,
  `Date.now`, `requestAnimationFrame`, `setTimeout`/`setInterval` and every
  document animation (CSS + `Element#animate`: callouts, title cards) run on
  one virtual clock. During setup and recording the clock only moves when the
  harness advances it by `1000/60 × scale` ms, so `Game.step`'s fixed-timestep
  accumulator runs exactly one 60 Hz tick per captured frame no matter how
  slow the machine renders. `Math.random` is seeded per shot.
- **Determinism**: `frameCount` (which seeds every per-tick stream) is pinned
  before the run starts and once the level is ready; the audio engine is off
  (its async sample loads would otherwise draw from the shared random stream).
  Camera, sim, creatures and events replay exactly; a few render-side dust
  specks may differ by a pixel.
- **Frames**: CDP `Page.captureScreenshot` (PNG, the composited page, so
  opted-in DOM callouts are included) piped to ffmpeg: 1920×1080, 60 fps,
  libx264 `-crf 12 -preset slow -pix_fmt yuv420p`, BT.709 tags, no audio.
- **Integrity** (logged + stored in the sidecar): ticks per frame, tick gaps,
  encoded frame count and rate (ffprobe).
- **Marks** (`lib/marks.mjs`): every EventBus emit, explosion and one-shot SFX
  call is logged with its captured frame; on-screen ones become `marks` for
  cutting and sound design. Shots add manual marks.
- **Clean frames** (`lib/hud.mjs`): all HUD/dev chrome is hidden; shots opt in
  to `callouts`, `letterbox`, `banner`, `captions`, `tea`.

## Shot files (`shots/<id>.mjs`)

`export default { ... }` (or an array). `_name.mjs` files are scratch shots,
runnable by id but excluded from `--all`.

| field | meaning |
| --- | --- |
| `id`, `priority` (`P0`..`P2`), `description` | registry + manifest |
| `level`, `seed`, `loadout` | `run test --level L --world campaign-level --seed S --loadout X` |
| `durationS` | clip length at 1× (include ≥1 s head and tail handle) |
| `warmupTicks` | ticks run after setup, before frame 0 (default 60) |
| `show` | DOM opt-ins: `callouts`, `letterbox`, `banner`, `captions`, `tea` |
| `setup(ctx, T, P)` | page-side, once, may be async; runs after `god` |
| `tick(ctx, T, P, t)` | page-side, at the START of every game tick; `t` = 0 on the first captured tick (negative in warmup) |
| `frame(ctx, T, P, f, t)` | page-side, before each presented frame |
| `keys` | real key events `[{ t, press \| down \| up: 'KeyE' }]`, applied before tick `t` |
| `marks` | manual marks `[{ t: seconds \| tick, label, kind }]` |
| `bestWindow`, `hero` | editor window `{ startS, endS }`; contact-sheet hero time (s) |
| `params` | JSON handed to the page functions as `P` |
| `god`, `mortal` | `god: false` skips god mode; `mortal: true` keeps player damage |
| `variants` | `[{ id, slowmo: { scale, fromTick, toTick }, ... }]` |

Page functions are serialized (`Function#toString`): they cannot close over
Node values; pass data through `params`.

### `T` (window.__trailer)

- Camera: `T.cam(cx, cy, zoom, {snap})` (the game's smooth follow toward a
  centre), `T.follow(zoom)` (player camera), `T.place(cx, cy, zoom)` (exact,
  whole-cell, edge-padded; call every tick), `T.path([{t, x, y, zoom}], {ease})`
  (keyframed move applied every tick).
- Input: `T.aim(x, y)` (world coords, re-applied every tick; never use
  `page.mouse`), `T.aimAngle(a, dist)`, `T.fire(ticks)`, `T.hold({right: true}, ticks)`,
  `T.release()`.
- World: `T.tp(x, y)`, `T.paint(x0, y0, x1, y1, cell, where?)` (async, the
  game's own colors), `T.set(x, y, cell)`, `T.type(x, y)`, `T.spawn(kind, x, y, opts)`,
  `T.clearEnemies(x, y, r, keep?)`, `T.hidePlayer()`, `T.equip(cardsI, cardsII)`, `T.rt()`.
- Marks: `T.mark(label, kind)`, `T.note(text)` (printed after capture).

## Cinematography notes (hard-won)

- Zoom 1 = 3 screen px per cell, zoom 2 = 6 px (both even pixels).
- Backdrop planes sample at integer camera positions: slow sub-cell drifts make
  far planes judder. Pan in whole cells (`T.place`/`T.path` do) at 1 cell/tick.
- The sim runs only around the player (±400 x, ±260 y): keep him near the
  framed action (hidden with `T.hidePlayer()` for vistas).
- `god` gives `invuln = 90` (the sprite blinks): the harness zeroes it and
  stubs `playerCtl.damage` unless `mortal: true`.
- Native residents near the stage can die off-screen and pop callouts: clear
  them. Explosion marks are filtered to the camera view.
- Slow motion: only the camera, player, living creatures and rigid bodies
  interpolate between ticks; cells, fire, particles and corpses step per tick,
  so slowed explosions look steppy. Use slow-mo only where entity motion
  carries the shot.
