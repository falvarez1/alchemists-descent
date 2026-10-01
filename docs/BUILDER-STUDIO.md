# Builder Studio — shell, design system, and the Sandbox ↔ Builder ↔ game flow

- Status: **shipped** on `bw/builder-studio` (2026-09-30). Supersedes the "Workspace Layout" and
  "Mode And Session Model" sections of `docs/BUILDER-LIVE-UI-SPEC.md` where they differ.
- Scope: how the editor chrome is laid out and themed, what the Builder owns when you move between
  the Sandbox, the Builder and a running game, and what was deliberately cut.

## The three workspaces, one mental model

There is **one world on screen**. Three things can look at it:

| Workspace | Is for | Terrain |
| --- | --- | --- |
| **Sandbox** | Live-physics scratchpad: paint, cast, pour, break things | The live grid. Nothing is saved unless you export it. |
| **Builder** | Authoring a level (terrain, objects, links, lights, prefabs) | The live grid **is** the document's terrain while the Builder is open. |
| **Play** / **Play** (in the Builder) | Testing | A disposable runtime compiled from the document; scars never flow back. |

Rules the code enforces (they used to be implicit, which is where data got lost):

1. **A document always has the terrain you see.** A document that holds no terrain captures the live
   grid on Save, Export, Validate and Play. Saving a Sandbox scene can no longer write `world: null`.
2. **Opening the Builder over a changed Sandbox asks.** If the document already holds terrain and the
   live grid no longer matches it, the Builder asks *Use the Sandbox scene* / *Load the document's
   terrain* / *Stay in Sandbox* (Escape = stay). It never picks silently: a Play would replace what
   is on screen with the stale copy.
3. **A scene on screen is authoring work.** NEW / LOAD / IMPORT confirm before wiping it, even when the
   document has no objects yet.
4. **One header.** While the Builder is open the game's studio header is hidden; the Builder's own
   title bar carries the way back (**Sandbox**) and the way forward (**Play**). The standalone editor
   route (`/builder.html`, `body.editor-window`) has no Sandbox to return to, so it has no exit.

## Layout

```
┌ title bar ─ ◆ Builder  File Edit View Level Help │ name · biome │ ▶ Play  ▶|  ✓ Validate │ ● Game link · ⊞ · Sandbox ┐
├──────────────┬──────────────────────────────────────────────────────────┬─────────────┤
│ Palette      │ viewport toolbar: tools │ brush · material │ snap mirror  │ Inspector / │
│  Terrain     │ overlay layers settle │ − 100% + ◎                        │ Outliner /  │
│  Objects     ├──────────────────────────────────────────────────────────┤ Issues      │
│  Library     │                     the map viewport                      │ (tabs)      │
├──────────────┴──────────────────────────────────────────────────────────┴─────────────┤
└ status bar ─ message or tool hint │ armed material · brush · zoom │ cursor │ ✓ issues ┘
```

- **Title bar** — one row. File / Edit / View / Level / Help; the document cluster (name reads like a
  tab, saved-documents and biome selects); **Play** (green, from the spawn), **Play from cursor**
  (`T`), **Validate** (a live chip: idle → `✓ Valid` / `⚠ n` / `⊘ n`, dimmed once an edit makes the
  result stale); **Game link**; panel-layout reset; **Sandbox**.
- **Viewport toolbar** — the tools, as eight groups, not seventeen buttons (below); brush radius and
  the armed-material chip; snap / mirror / overlay / layers; Settle (hold to run physics on the
  terrain, release to keep or revert); zoom.
- **Palette** (left dock) — three tabs: **Terrain** (armed-material card + swatches), **Objects**
  (pixel-portrait cards in *Level*, *Puzzles*, folded *Advanced machines*, *Annotate*, with a filter
  box and the lighting toggles), **Library** (prefabs, sprites, the asset browser). The last tab is
  remembered.
- **Docks** — unchanged mechanics (drag panels between docks, tab groups, splitters, persisted
  layout). Inspector is a property grid: label left, control right, one 26px rhythm.
- **Status bar** — the last message (shown as a sentence), else a one-line hint for the armed tool;
  armed material · brush · zoom; cursor cell; validation result (click to open Issues).

### Tool groups

A group's head shows the variant in use and lights when any variant is armed. **Click** arms it; click
the *armed* head again, **right-click**, **hold**, or press **↓** to open the variants. Every variant
keeps its `data-tool` id, shortcut and tooltip.

| Group | Variants |
| --- | --- |
| Select (`V`) | — |
| Brush | Brush (`B`), Line (`L`) |
| Shape | Rectangle, Filled rectangle, Ellipse, Filled ellipse |
| Fill | Flood fill (`G`), Replace material |
| Smooth | Smooth, Roughen |
| Region | Rectangle (`R`), Polygon, Lasso, Magic (whole cavern) |
| Link (`K`), Light | — |

## Game Link (linking a Builder window to a running game)

Linking used to be a side effect of two windows sharing the dev relay's room, with a pill that read
`LINK ·` for five different situations. The **Game link** button's label *is* the state, and the popover
names the one thing to click.

| State | Means | Primary action |
| --- | --- | --- |
| Not linked | Off here (`?link=off`, browser automation, or a player build without `?link=<room>`) | Start linking (when it can) |
| Connecting… | Reaching the relay | — |
| No connection | Relay down / origin refused (it retries) | — |
| Read-only | Hosted room, no write token in this build | — |
| Waiting for game… | In the room, nobody else yet | **Open game window** |
| Linking… | A window joined; no world announced yet | — |
| **Different level** | A peer is on another world; every edit is being refused | **Use the game's level** (pull, with a confirm if you have work) |
| Linked · Game | Same world; terrain, objects, lights, tuning and console lines are in step | — |

The popover also lists the windows in the room (with a per-window *Use*), the **room code** with *Copy
game link* / *Change…* (join by code or pasted link, or start a private room), and whether the relay is
this dev server or a hosted one and whether the window may write.

Design notes that are easy to lose:

- `src/app/authorLinkView.ts` is the whole judgement, as a pure function (`deriveLinkView`), so the
  button, the popover and the tests cannot disagree. `src/app/LinkControl.ts` is only DOM.
- **Open game window** uses `window.open(url, '_blank', 'noopener')`: without `noopener` the new tab
  inherits this tab's `sessionStorage` (the dev "restore my last mode" key) and boots into the Builder.
- Only a **room name** is ever read from pasted text. The relay origin and write token stay
  build-time environment variables, never the URL (`CLAUDE.md`, AuthorLink).
- Pull is still destructive and user-initiated, never automatic.

## Design system

`src/styles/studio.css` holds the tokens; `builder.css` (the old Builder rules, re-expressed in tokens)
and `studio-chrome.css` (the shell above) consume them. **No colour literal belongs in either.**

- **Surfaces** step lighter as they come forward: `--st-well` < `--st-surface-1` (panels) <
  `--st-surface-2` (headers, toolbars) < `--st-surface-3` (controls) < `-4` (hover) < `-5` (pressed).
- **One accent** (`--st-accent*`, indigo) for selection, the armed tool, focus rings, primary buttons.
  Status colours (`ok`, `warn`, `danger`, `purple`) never double as decoration.
- **Type**: Inter (vendored, OFL, 48 KB latin subset) for chrome; the mono stack only for ids, cell
  coordinates and code. 11–12px UI text, sentence case, tabular numerals.
- **Geometry**: 4px grid, 24/28px controls, 40px title bar, 24px status bar.
- **Icons**: `src/ui/editor/icons.ts` — 16px line icons on `currentColor`. Object cards reuse the
  28px pixel portraits the hover popovers already drew.
- Messages are still written in capitals throughout `Builder.ts`; the status bar renders them as
  sentences with CSS (`lowercase` + `::first-letter`). The text content is unchanged because the
  probes read it.

## What was cut, and why

A level designer needs terrain, objects and mechanisms, linking, lights, prefabs, playtest, validate,
inspector/outliner. Anything else was either a second copy of something the game already has, or a
prototype for a direction the game no longer takes.

- **Logic Preview** (AUTHOR / LOGIC PREVIEW / RESTART / DISCARD) and `PreviewRuntime.ts` — a second
  mechanism engine with no player that could drift from `game/Mechanisms.ts`. *Play from cursor* (`T`)
  is the real thing.
- **Runtime dock** — empty in Author view; the game has its own runtime inspector.
- **Global Controls, Post Processing** — duplicated the Sandbox's own controls and the GPU toggle.
- **World Map, Pixel Scene Editor** — tooling for the chunked-world prototype (archived at
  `archive/chunked-world`); the shipped game is four fixed floors.
- **Palette sections** VIEW, PARAMETERS, LAYERS, WORLD GEN — launchers for panels that already had a
  menu item (layers moved to a toolbar popover; generate moved to *Level ▸ Generate terrain…*).
- Material Parameters no longer pops open every time a swatch is armed (still *Level ▸ Material tuning…*).

The **Reference gallery** moved to *Help*; it is an art browser, not a level tool.

## Small things that carry the feel (second polish round)

- **Context bar** (`#builder-contextbar`): selecting a region (or lifting one with `X`) shows its verbs at the foot of the
  map: Lift & move / Save as prefab / Export PNG / Clear, then Rotate / Flip / Cancel / Place while a block is floating.
  It runs the same commands as the keys and the Level menu; it sits at the bottom because the top edge is where tool
  flyouts open (a bar there swallowed their clicks).
- **Material filter** at the head of the Terrain tab: type to narrow the swatches, Enter arms the first match.
- **Validation cards** use a severity icon plus a coloured left edge instead of a `[ERROR]` text prefix; the outliner,
  Library tab, help dialog and playtest banner were moved onto the same tokens (sentence case, neutral resting surfaces).
- The run's title card and narrator caption are hidden while the Builder is open; they belong to the game.

## Extending it

- **Element ids are contract.** `Builder.ts` binds by id (`this.el('b-save')` throws on a miss) and
  ~20 probes click the same ids. A control may move; it keeps its id. `tests/builder-shell-markup.test.ts`
  fails on a missing or duplicated id and on a hidden stub whose handler is gone.
- **New tool**: add it to `TOOL_GROUPS` (`shellMarkup.ts`), give it `TOOL_INFO` copy and a command in
  `registerCommands`. **New placeable**: add it to one of the `*_OBJECTS` lists; the card picks up its
  `OBJECT_INFO` portrait automatically. The test enforces both lists are exhaustive.
- **Probes** arm grouped tools with `clickBuilderTool(page, 'rectFill')` and tabs with
  `openBuilderPaletteTab(page, 'objects')` (`scripts/run-helpers.mjs`).
