# The title menu

**Status: implemented.** The title screen is laid out like a game's menu, not a page: a short main list, and every
door opens the choices that belong to it. Nothing is shown until you drill into it.

## The pages

```
Main (the big wordmark, six rows at most)
├─ Continue                      (only with a descent in hand: "Floor 2 of 4 · Sparkwright · 12:41")
├─ New descent ─► Prepare your descent   (the loadout page; opens on Descend)
│                 ├─ Case        ◂ Sparkwright ▸   Enter: the case list (locked cases refuse and say how to earn them)
│                 ├─ Difficulty  ◂ II · Adept ▸    Enter: the tiers
│                 ├─ Complications  None           Enter: twelve toggles, three at a time (a swap for the two that cancel)
│                 ├─ Seed        Random            Enter: a page with a field ("Use this seed", "Random descent", copy)
│                 ├─ Descend     (the recap: "Sparkwright · Mara Quell · Adept · seed 905805099")
│                 └─ Back
├─ Today's descent               (launches the daily; its date or best is the dimmed line, the full sentence the hint)
├─ Arena (authoring builds)      the Fighter Roster over the title; choosing a fighter starts the Proving Yard as them (docs/FIGHTERS.md)
├─ Workshops (authoring builds)  ─► Material sandbox · Level builder · Advanced run setup
│  The Workshop (player builds, once a first run has ended)
├─ Extras ─► Watch the trailer · The opening (once seen)
└─ Options                       (the Controls & comfort dialog)
```

Drilled in, the title steps back to a small wordmark and the page takes the room. A **detail card** beside the page
explains the focused row (the case's contents, the tier, a complication's regulation and weight,
how a locked entry is earned); on the main page one hint line under the list does the same job.
The footer's key legend follows the page and the row (↑↓ Select, ←→ Change on a choice row, Enter Open/Confirm,
Esc Back; D-pad / A / B once a pad is connected).

## How it is built

| File | What it owns |
|---|---|
| `src/ui/title/titleMenuModel.ts` | Pure: the item / page / detail types, cycling a choice (`cycleOpen`: skips what is locked, wraps), `moveFocusIndex`, the card specs, the Continue and daily lines, the key legend. Tested in `tests/title-menu-model.test.ts`. |
| `src/ui/title/TitleMenu.ts` | The engine: a page stack, the list, the card, the hint, the legend; keyboard (Up / Down / Home / End wrap, Left / Right on a choice row, Enter, Escape or Backspace for back), pointer, focus memory per page. Knows nothing about the game. |
| `src/ui/title/SeedPage.ts` | The seed field: parse, preview, copy. (Replaced the old "Choose a seed" fold.) |
| `src/ui/ExpeditionEntry.ts` | The pages themselves: which rows exist, what they do, the state behind them (kit, fighter, difficulty, seed), `launch` / `start`. |
| `src/styles/title-menu.css` | All of the look; tokens from `menus.css`. |
| `src/input/InputManager.ts` | The pad: the d-pad / A / B dispatch the same keys the menu answers, so there is one code path. |

Rules worth keeping:

- **The focused row IS the selection.** It is styled on `:focus`, not `:focus-visible`, because the keyboard, the pad
  and the mouse all move it. The stock focus ring is off for these rows; the pointer, the lit slab and the brighter type
  are the indicator.
- **A pointer that has not moved does not select.** When a page changes under a resting mouse the browser replays a move
  at the same spot; `TitleMenu.trackPointer` ignores it, so Descend keeps the focus a page opens on.
- **A list opens on the current choice** (`MenuPage.focus` can be a function); **a page you came back to keeps its place**.
- Items are buttons with `data-entry`; the probes click those ids, and `[data-kit]`, `[data-difficulty]`, `[data-seed]`
  mark the entries of the lists. An id may move to another page; it keeps its name.
- Choices persist exactly as before (`ctx.run.chooseKit / chooseFighter / chooseDifficulty`); a chosen seed lasts for
  one descent (cleared on Descend).
- The icons' canvases need an id-scoped size (`#expedition-entry .tm-icon canvas`): `#canvas-holder canvas` forces
  100% with `!important`.

## Probes (dev server running; real keys, real mouse, a fake pad the game polls)

`verify-title-menu.mjs` (the menu at three window sizes: only the doors on the main page, everything above the fold,
keyboard, rows, lists, locked refusal, seed page, pointer, pad, Descend starts exactly what the rows say),
`verify-fighter-title.mjs` (the Fighter row and the roster over the title), `verify-options.mjs --only seed`,
`verify-difficulty-ladder.mjs`, `verify-run-lifecycle.mjs`. `shot-title.mjs` walks every page for the eye.
