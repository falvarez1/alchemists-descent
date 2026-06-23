# MOBILE.md — Mobile-friendliness audit & plan

Feasibility audit for running **Alchemist's Descent** on touch devices, plus a phased plan.
Generated from a codebase audit (2026-06-22). File:line references were accurate at audit time —
verify before acting on any single one.

> **TL;DR** — Feasible, yes. "Mobile-friendly" splits into three unequal problems: packaging is
> easy, touch controls are a real design project, and **performance on real phones is the genuine
> risk**. Recommended target: **landscape, tablet + high-end phone, shipped as an installable PWA.**
> Avoid portrait phones (would force a camera-math refactor) and keep the Builder desktop-only.

---

## Verdict by difficulty

| Challenge | Difficulty | Why |
|---|---|---|
| **Controls / touch input** | Large | Game is mouse-aim-first (twin-stick loop); ~15 verbs; zero touch code in the game loop today. But `ctx.input` is a clean seam to exploit. |
| **Performance on phones** | Large (partly pre-solved) | Single-threaded CPU sim + per-pixel CPU compose; phones are ~3–4× slower single-core. A GPU compose path is already written but gated off. |
| **Viewport / layout / PWA packaging** | Small–Medium | Fixed landscape aspect + DPR pinned to 1; no PWA infra at all. Adding it is routine. Lock to landscape to dodge the portrait refactor. |

Cross-cutting reality: the game assumes mouse + keyboard everywhere. There is **no device/touch
detection** (`navigator.userAgent`/touch-capability checks absent). The Builder uses `PointerEvent`
in places; the **game loop uses `MouseEvent`/`KeyboardEvent` only**.

---

## 1. Controls — the hard design problem

The core loop is effectively **twin-stick**: move (`A`/`D`) + aim (live mouse position) + fire
(held LMB) simultaneously, layered with jump, wall-grab, kick, vine-swing, crouch/crawl/dive,
hold-based flask siphon/pour/drink, wand swap, and lever interaction.

**Why aiming is the crux**

- `player.aimAngle = atan2(mouse.y − shoulderY, mouse.x − playerX)` recomputed every frame
  (`src/entities/Player.ts:1952-1956`).
- Aim direction is read from `ctx.input.mouse` (`src/input/InputManager.ts:193-212`,
  `getMouseGridCoords()`).
- Touch has **no hover cursor** → you must choose an aim model:
  - **Right-side virtual aim/fire stick** (recommended) — twin-stick-roguelike feel (Dead Cells
    mobile). Set a synthetic `mouse.x/y` along the stick vector so the *entire existing aim/fire
    path is reused unchanged*.
  - **Auto-aim / facing-direction firing** — simpler, but flattens feel. Note wand **recoil and
    rocket-jump are wired to aim direction** (`WandSystem.ts:216-276`), so this changes game feel.

**Why this is more tractable than it looks: the `ctx.input` seam**

Input is **not** abstracted behind a virtual-controls layer — `InputManager` writes DOM state
straight into `ctx.input.keys` and `ctx.input.mouse`, which `Player.ts`/`Game.ts` consume
(`src/core/types.ts:1001-1032`). A touch layer that writes the **same shape** needs almost no
downstream changes. That's the whole strategy.

**Full verb map (play mode)** — from `index.html:186-191` HUD hints + `InputManager.ts:416-518`:

| Action | Current binding | Touch plan |
|---|---|---|
| Move L/R | A/D or arrows | Left virtual stick |
| Jump / levitate (hold) | Space / W / Up | Face button (hold = levitate) |
| Crouch / crawl / dive-slam | S (ground/move/air) | Down on left stick / dedicated button |
| Wall grab | Shift / C | Face button |
| Aim | Mouse position | Right virtual stick |
| Fire (hold) | LMB | Right stick press / fire button |
| Throw flask | RMB (contextmenu) | Button or long-press (no RMB on touch) |
| Wand swap | Digit1/2 or wheel | On-screen swap button / two-finger swipe |
| Flask slot select | Digit3–6 | Radial / hotbar buttons |
| Siphon / pour / drink (hold) | E / Q / X | Tap-to-toggle modes + UI indicator |
| Kick / throw crate | F | Button (kick in facing dir; drop recoil-aim coupling) |
| Grab vine/body (hold→release throw) | G | Contextual button |
| Interact / lever | E | Contextual tap (lever roots player → low conflict) |
| Pause / map / help / grimoire / console | ESC / M / H / J / backtick | UI buttons |
| Sandbox/play toggle | Tab | Desktop-only |

**Blockers (severity)**

- *blocker* — No touch/pointer handlers in the game loop (`InputManager.ts` whole file).
- *blocker* — Aiming requires hover cursor (`Player.ts:1952`, `InputManager.ts:193`).
- *blocker* — No on-screen virtual controls UI (`index.html`, `src/ui/Hud.ts`).
- *major* — RMB flask throw unavailable on touch (`InputManager.ts:229-250`).
- *major* — Hold-based flask verbs need rework to tap-toggle (`InputManager.ts:475-489`).
- *minor* — Wheel wand-swap (`InputManager.ts:309-314`); hover popovers (`Minimap.ts:834-835`).

**Out of scope: the Builder.** It's an explicit desktop authoring tool (`docs/BUILDER.md`).
Brewing (cauldron grid histogram) is also mouse-friendly and awkward on touch. Mobile = **play mode
only**.

**Key files:** `src/input/InputManager.ts`, `src/entities/Player.ts`, `src/core/types.ts`
(InputState/Keys), `src/ui/Hud.ts`, `index.html`.

---

## 2. Performance — the genuine risk (partly pre-solved)

Single-threaded falling-sand sim. Desktop (Intel Arc) chaos benchmark ≈ **5–6 ms/frame**, but the
load-bearing costs are **CPU, main-thread, single-core** — exactly where phones are ~3–4× slower.

**Cost model** (`src/config/constants.ts`, `src/sim/`, `src/render/`):

- Grid: **1600×1064 = 1.7M cells**, ~**17 MB** typed arrays (types/colors/life/moved/charge),
  allocated even though only the camera window simulates (`World.ts:44-54`).
- Sim window: 575×391 view + 44-cell margin → **603×435 cells** swept bottom-up each substep,
  **≤6 substeps/frame** (`Simulation.ts:32-46`). ≈ 0.89 ms.
- Entities ≈ 1.2 ms; particles pool to **12,000** (`constants.ts:34`).
- **Per-pixel CPU terrain composition**: 575×391 × 4–8 ops/frame
  (`FrameComposer.composeTerrainCpu`, ~`FrameComposer.ts:317-551`) ≈ 1.4 ms.
- Lighting rebuild **every even frame**: 4 directional sweeps over a half-res field
  (`FrameComposer.ts:235`, `Lighting.ts:211-500`).
- Render: WebGL2 default, ACES tone map + UnrealBloom + PostFx, 1 fullscreen quad
  (`Renderer.ts`). DataTexture re-uploaded every frame, no dirty-rect culling.

**Levers (cheapest → biggest):**

1. **Enable the existing GPU compose path** — `WebGpuLiveCompose.ts` / `ComposeShader.ts` already
   exist but are gated off. Biggest single win (~1.4 ms CPU → ~0.3 ms). Needs parity validation.
2. **Quality auto-scaling tier** (no save-format impact): render at 0.5× DPR, substep cap 6→3,
   bloom/aberration/grain off, lighting every 4th frame (30 Hz), particle cap ~6k. Drive from a
   3-frame rolling average that downgrades when frame time exceeds budget.
3. **Dirty-rect texture upload** for static scenes (~30–50% bandwidth on calm scenes).
4. **Lighting field `Float32Array`→`Uint8Array`** (halves ~900 KB, faster fill).
5. *Large, probably unnecessary if targeting mid/high-end:* Web Worker sim, world chunking
   (256×256 sparse chunks → ~2 MB) — respect the moved-epoch reset every 256 ticks.

**Gotchas** (CLAUDE.md hard invariants): frame order is load-bearing (spells aim with previous
frame's snapshot; lighting rebuilds on even frames; lighting feeds sprite render). Tuning magic
numbers can change generation hashes (`tests/gen-golden.test.ts`) and requires bumping
`GEN_VERSION`. Quality/DPR/substep changes are safe; cell-enum/material-sim changes are not.

**Tooling:** `scripts/perf-scene.mjs` (chaos scenario, Welch t-test vs saved baseline) — re-baseline
after each change. Force backend via `?renderBackend=webgl` for testing.

**Realistic call:** mid/high-end devices in landscape should be fine after levers 1–2; low-end
phones may settle at 30–40 fps and that's acceptable. Don't promise 60 fps on cheap hardware.

---

## 3. Viewport / layout / PWA packaging — the easy part

**Rendering/viewport** (`src/render/Renderer.ts`, `src/render/Camera.ts`, `src/styles/main.css`,
`src/config/constants.ts`):

- DPR **pinned to 1** (`Renderer.ts:85-86`); internal buffer fixed **1150×782** (2 px/cell).
  High-DPR screens render 1× then upscale (soft).
- **Fixed landscape aspect** `aspect-ratio:1050/714` (`main.css:168`); **no `ResizeObserver`/resize
  handler**; canvas scales via CSS only.
- **No orientation handling.** Camera math (aim-lookahead, crouch-peek 48 px, dig-beam) bakes the
  landscape `VIEW_W/VIEW_H` ratio (`Camera.ts:53-56`, `Game.ts:551-563`). → **Lock to landscape;
  do not attempt portrait.**
- Mouse→world coord mapping assumes landscape client rect (`InputManager.ts:193-212`).

**UI / HUD** (`index.html`, `src/styles/main.css`, `src/ui/`):

- HUD absolutely positioned **without `env(safe-area-inset-*)`** → overlaps notches/rounded corners
  (`main.css:213-299`, `index.html:162-183`). 49 px header, 12 px vitals, 200×133 minimap.
- `max-width:480px`/`720px` breakpoints exist but only hide **sandbox** panels; canvas layout
  unaffected.
- Hover-only affordances (minimap POI popover, `cursor:help`) need tap equivalents on touch.
- 3-column workbench layout (toolbar / canvas / inspector) is fixed and won't work on small
  screens — but it's authoring UI, out of scope.

**Build / packaging / PWA** (`vite.config.ts`, `index.html`, `package.json`,
`.github/workflows/deploy.yml`):

- Vite build is solid: dynamic base path (`GH_PAGES`), Three.js + Rapier2D vendor chunks, strict
  TS + eslint + vitest in CI.
- **Zero PWA infra**: no `manifest.json`, no service worker, no app icons, no `theme-color`, no
  `apple-mobile-web-app-capable`. Viewport meta exists (`index.html:5`) but lacks
  `viewport-fit=cover`. Only an inline SVG favicon (`index.html:7`).
- Persistence is **localStorage** (9+ files: levels, grimoire, mode, tuning, telemetry; RLE for
  level cells). Works on mobile; iOS Safari quota is tighter — consider IndexedDB/compression for
  grimoire blobs.
- **Assets are heavy:** ~32 MB dist with sourcemaps; **12.5 MB backdrop PNGs**, ~1.2 MB
  vendor-three, ~1.7 MB vendor-rapier, ~1 MB app, 716 KB Builder. Compress/WebP + lazy-load
  backdrops for slow connections.
- Deploy is GitHub Pages only; a service worker enables offline-after-first-load.
- `keyboard.lock()` used in fullscreen play (`InputManager.ts:544,586`) — may not work on iOS
  Safari.

**Native wrapper (optional, later):** **Capacitor** recommended (reuses the web build directly;
better web integration than Cordova; gives App Store / Play Store + haptics). A PWA covers most
cases without it.

---

## Phased plan

**Phase 0 — Installable shell (days).**
`manifest.json` + 192/512/180 icons + `theme-color` (#07070a) + `viewport-fit=cover`; service
worker for offline; `screen.orientation.lock('landscape')`; safe-area-inset HUD padding;
portrait-rotate-nag overlay.

**Phase 1 — Touch input adapter (1–2 weeks).**
A `TouchControls` module rendering virtual controls that feed the **existing**
`ctx.input.keys`/`ctx.input.mouse`: left stick = move, right stick = aim+fire (synthetic
`mouse.x/y` along the aim vector → reuses the whole existing aim/fire path), face buttons
(jump/grab/kick/swap), radial for flask verbs. Detect pointer type; toggle layer + disable `:hover`
CSS on touch.

**Phase 2 — Performance pass (1–2+ weeks).**
Enable GPU compose; add a `low` quality tier (DPR 0.5, substeps 3, bloom off, 30 Hz lighting,
particles 6k) with 3-frame rolling auto-downgrade. Re-baseline with `perf-scene.mjs`.

**Phase 3 — Mobile UX polish (ongoing).**
44px+ tap targets, tap-to-toggle for hover popovers, asset compression/lazy-load, real-device
testing (iPad + mid-range Android).

**Optional later — Capacitor wrapper** for store distribution + haptics.

### Recommended first step

**Do Phase 2's GPU-compose spike first, throttled (e.g. 4× CPU slowdown in DevTools), to de-risk
the perf ceiling before investing in controls.** It's the cheapest way to learn whether mobile
performance is even acceptable; controls work is wasted if the answer is no.

---

## Key files (consolidated)

- **Input:** `src/input/InputManager.ts`, `src/core/types.ts` (InputState/Keys), `src/entities/Player.ts` (aim), `index.html` + `src/ui/Hud.ts` (virtual controls)
- **Render/viewport:** `src/render/Renderer.ts`, `src/render/Camera.ts`, `src/render/FrameComposer.ts`, `src/render/Lighting.ts`, `src/styles/main.css`, `src/config/constants.ts`
- **Perf:** `src/sim/Simulation.ts`, `src/sim/World.ts`, `src/config/params.ts`, `src/render/WebGpuLiveCompose.ts` + `ComposeShader.ts`, `scripts/perf-scene.mjs`
- **Packaging:** `vite.config.ts`, `index.html`, `public/` (add manifest + icons + SW), `.github/workflows/deploy.yml`
