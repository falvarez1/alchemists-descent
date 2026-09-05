---
name: "Alchemist's Descent"
description: "The Living Descent: a corroded alchemical refinery with live materials and readable creatures."
colors:
  works-copper: "#bd9460"
  entry-action: "#f2e3b6"
  entry-hover: "#fff2ce"
  title-brass: "#c8ad7c"
  focus-mint: "#bde2c7"
  water-surface: "#658e94"
  water-depth: "#315b67"
  health: "#c5836c"
  mana: "#91b7bf"
  levitation: "#c7b580"
  flask-active: "#e9d49c"
  works-ink: "#111c20"
  works-paper: "#e6dfca"
  viewport: "#0e191d"
  settings-surface: "#16242a"
  settings-control: "#23332f"
  settings-control-text: "#e0dcc5"
  pause-surface: "#101d23e8"
  pause-button: "#1b2a2b"
  pause-button-text: "#d4d8c3"
  pause-button-hover: "#35433a"
  pause-button-hover-text: "#f3e9c8"
  objective-text: "#c1d0bd"
  caption-text: "#dfd7bf"
typography:
  display:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "clamp(58px, 6.8vw, 96px)"
    fontWeight: 500
    lineHeight: 0.88
    letterSpacing: "-0.03em"
  headline:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "64px"
    fontWeight: 500
    lineHeight: 1
    letterSpacing: "0"
  title:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "calc(36px * var(--text-scale))"
    fontWeight: 500
    lineHeight: 1.05
  room-title:
    fontFamily: "'Cormorant Garamond', Georgia, serif"
    fontSize: "calc(23px * var(--text-scale))"
    fontWeight: 500
    lineHeight: 1.1
    letterSpacing: "0"
  body:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "calc(14px * var(--text-scale))"
    fontWeight: 400
    lineHeight: 1.5
  body-entry:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "calc(15px * var(--text-scale))"
    lineHeight: 1.65
  label:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "calc(12px * var(--text-scale))"
    fontWeight: 500
    lineHeight: 1.2
    letterSpacing: "0.02em"
  action-entry:
    fontFamily: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
    fontSize: "calc(21px * var(--text-scale))"
  action-resume:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "calc(20px * var(--text-scale))"
    fontWeight: 400
    lineHeight: 1.3
  action-secondary:
    fontFamily: "ui-sans-serif, system-ui, sans-serif"
    fontSize: "calc(14px * var(--text-scale))"
    fontWeight: 400
    lineHeight: 1.3
rounded:
  square: "0"
  flask-vessel: "4px 4px 6px 6px"
  flask-liquid: "3px 3px 5px 5px"
spacing:
  tight: "5px"
  control-gap: "8px"
  tool-gap: "10px"
  control-inset: "12px"
  option-gap: "16px"
  compact-panel: "20px"
  panel: "28px"
components:
  entry-primary:
    backgroundColor: "transparent"
    textColor: "{colors.entry-action}"
    typography: "{typography.action-entry}"
    rounded: "{rounded.square}"
    padding: "11px 35px 11px 0"
  entry-primary-hover:
    textColor: "{colors.entry-hover}"
  entry-secondary:
    backgroundColor: "transparent"
    textColor: "{colors.works-paper}"
    rounded: "{rounded.square}"
    padding: "11px 0"
  entry-secondary-hover:
    textColor: "{colors.entry-hover}"
  pause-primary:
    backgroundColor: "transparent"
    textColor: "{colors.entry-action}"
    typography: "{typography.action-resume}"
    rounded: "{rounded.square}"
    padding: "12px 36px"
  pause-secondary:
    backgroundColor: "{colors.pause-button}"
    textColor: "{colors.pause-button-text}"
    typography: "{typography.action-secondary}"
    rounded: "{rounded.square}"
    padding: "12px 18px"
  pause-secondary-hover:
    backgroundColor: "{colors.pause-button-hover}"
    textColor: "{colors.pause-button-hover-text}"
  settings-button:
    backgroundColor: "{colors.settings-control}"
    textColor: "{colors.settings-control-text}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "9px 12px"
  settings-select:
    backgroundColor: "{colors.settings-control}"
    textColor: "{colors.settings-control-text}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "9px 12px"
  entry-navigation:
    textColor: "{colors.works-paper}"
  settings-dialog:
    backgroundColor: "{colors.settings-surface}"
    textColor: "{colors.works-paper}"
    typography: "{typography.body}"
    rounded: "{rounded.square}"
    padding: "{spacing.panel}"
    width: "min(600px, calc(100vw - 72px))"
  flask-belt:
    width: "max-content"
  objective-caption:
    textColor: "{colors.objective-text}"
---

# Design System: Alchemist's Descent

## Overview

**Creative North Star: "The Living Descent"**

The Living Descent is a wet, corroded alchemical refinery. Slate, mineral deposits, timber and copper carry clustered pixel detail; warm refuge light and pale living bodies establish local points of attention. Water, terrain, creatures and working machinery remain independent, mutable parts of the game. Distant refinery imagery provides atmosphere and depth.

The interface uses thin, square controls, warm pale lettering and quiet corners around the scene. Cormorant Garamond gives entry and room titles their character; system text carries explanations and controls. This document extracts the implemented entry, expedition HUD, pause and comfort settings. The boot screen, workshops and inherited overlays retain additional styles outside this vocabulary.

Source authority is [Living Descent CSS](src/styles/living-descent.css), its inherited [base CSS](src/styles/main.css), [entry markup](index.html), and the listed components below. The [surface brief](.impeccable/surfaces/src-game-game-ts.md) owns this expedition's composition; the [quality bar](.impeccable/quality-bar.md) and [asset manifest](docs/living-descent-asset-manifest.md) record the material direction. The generated studies are nonliteral references. This source extraction does not establish motion, listening, unaided-player or cross-hardware acceptance; the bounded visual finish verdict closed its five reported repairs. Gameplay architecture remains in [docs/DESIGN.md](docs/DESIGN.md).

**Key Characteristics:**

- Clustered wet stone, worn copper and connected timber grain.
- Live material boundaries and articulated bodies above subdued distant scenery.
- Serif titles paired with plain operating text.
- Square, lightly bordered controls and sparse corner HUD groups.
- Contextual input cues, independent flask slots and captions that follow their objective.

## Colors

Warm brass and paper sit over blue-green slate; restrained mint and water tones support orientation. The frontmatter records exact source values. Descriptive keys for literal declarations are extraction names, not additional exported CSS variables.

### Primary

- **Works copper** (`works-copper`) supplies the Resume underline and the declared copper primitive.
- **Warm brass action** (`entry-action`) marks the leading entry action and Resume. **Warm hover** (`entry-hover`) is the entry-control hover color.
- **Title brass** (`title-brass`) colors the emphasized second line of the entry title.

### Secondary

- **Focus mint** (`focus-mint`) outlines keyboard-focused buttons, summaries and selects.
- **Water surface** and **water depth** are the two live water albedos in [TerrainArt.ts](src/render/TerrainArt.ts), before scene lighting. Only the immediately exposed surface receives the lighter value.
- **Health**, **mana** and **levitation** are the three labeled vital fills. **Flask active** marks the selected bottle's baseline; the liquid itself receives its actual material color at runtime.

### Neutral

- **Works ink**, **viewport** and **settings surface** establish the dark blue-green ground. **Works paper** is the shared pale text primitive.
- **Settings control** and its text color define native selects and ordinary settings buttons.
- **Pause surface** is translucent. The pause button colors provide its default and hover states.
- **Objective text** and **caption text** separate room instructions from the sound report below them.

**The Local Contrast Rule.** Live terrain lips, creature anatomy and actionable machinery retain readable local contrast above the distant refinery layers.

## Typography

**Display Font:** locally hosted Cormorant Garamond, with Georgia and serif fallbacks. The font face supports weights 300–700 and uses `font-display: swap`.

**Body Font:** system sans. Entry copy inherits the platform-aware body stack; the HUD and settings specify the shorter system stack in the frontmatter.

**Compact Key Font:** flask keys and quantities retain the inherited `ui-monospace, 'SF Mono', Menlo, Consolas, monospace` stack. Their labels use system sans.

The hierarchy is deliberately irregular rather than a declared modular scale. The display role belongs to the entry title, headline to “Take a breath,” title to the settings heading, room-title to the current location, body to settings controls, and label to vitals. Entry copy has a narrow measure (38ch); settings explanations allow a longer measure (65ch).

**The Title and Instruction Rule.** Cormorant carries the entry, room, pause and settings headings. Explanations and ordinary controls use their defined system-sans roles; compact flask keys and quantities retain their source monospace treatment.

Text-size preferences are Standard (1), Large (1.15) and Larger (1.3), applied through `--text-scale`. The source explicitly scales operating labels, settings, captions and flask widths. The entry display and pause headline keep their own size rules; this is not a global zoom operation. At the compact breakpoint, the entry display becomes 64px. Room titles become 18px, settings titles 30px and objectives/captions 10px, each multiplied by the preference.

## Layout

The logical game view is **640 × 360**, presented through a **1280 × 720** backing canvas. Play fits a centered 16:9 frame with width `min(100%, calc(100dvh * 16 / 9))`; the entry fills its holder. Canvas textures use nearest filtering and the canvas is displayed with pixelated/crisp-edge rendering. Viewport fitting can produce fractional CSS scaling. Source: [constants](src/config/constants.ts), [Renderer](src/render/Renderer.ts) and the stylesheets.

The entry uses a left-aligned column with width `min(520px, 74%)`, a clamped left inset and a vertically stacked navigation group. Copy and actions sit over the darker side of the refinery image. The footer occupies the lower edge. Authoring builds also expose a collapsed Workshops disclosure; the shipping entry removes it.

Vitals sit upper left (24px from the top, 28px from the left), with a 180px group width. Room title and objective sit upper right (24px/28px), limited to `min(360px, 44%)`. Tools sit lower left (28px/26px); Pause sits lower right (28px/25px). The active wand uses 32px square slots. Holstered rows, empty slots, enemy tally, treasure row, corner minimap and the old control legend are hidden in this play treatment.

The flask belt is a flex row with four independently positioned slots, an 8px gap and a width of `56px * --text-scale` per slot. Each material name sits beneath its bottle. Captions use normal flow beneath the objective with a 10px top margin. The valve cue follows the real handwheel through camera projection and is clamped within the HUD bounds.

The native settings dialog has width `min(600px, calc(100vw - 72px))`, maximum height `calc(100dvh - 90px)`, scrolling and the panel inset from the frontmatter. Options form a single column; binding buttons remain a two-column grid. Pause actions wrap within a 720px group.

At **max-width 760px**, the HUD moves to 12px edge insets, vitals narrow to 125px, wand slots become 24px and flask slots use `48px * --text-scale`. Settings use the compact panel inset. At **max-height 600px**, entry spacing tightens, its title becomes 56px and its footer joins normal flow. These are the two implemented layout breakpoints; touch controls and general mobile acceptance remain open in [PRODUCT.md](PRODUCT.md).

## Elevation & Depth

The game plane supplies depth through separate refinery layers, cell-bound surface detail, boundary lighting, articulated silhouettes and actual material motion. Default distant-refinery parallax is 0.1 at full opacity; copper machinery is 0.15 at 0.52 opacity, with both raster scales set to 0.5 in [backdrop settings](src/config/backdrop.ts). Their production pixel dimensions are asset facts, independent of the current logical viewport.

Entry artwork receives a left-to-right slate veil behind text. Play HUD tracks, slots, prompts and the canvas frame remove their inherited box shadows. The pause veil retains an inherited 2px backdrop blur; the native settings dialog darkens its backdrop. Small text shadows support field notes and sound captions against the scene. The sidecar carries these source declarations.

**The Live Boundary Rule.** Terrain albedo samples the real cell grid and preserves excavation and saved color overrides. Decorative refinery imagery supplies no collision or interaction; valve, refuge and pipe artwork follows real runtime anchors.

The terrain atlas is four independent 128px material quadrants in a 256px image. It repeats with world coordinates and uses nearest sampling. WebGL samples the same bitmap directly; the CPU reference sampler and fallback preserve the live-cell behavior. The material repeat remains periodic.

## Shapes

Controls, dialog surfaces, HUD tracks and spell slots have square corners. Thin solid borders or a single lower rule define their edges. Entry actions are open text controls; Resume has a copper underline. The bottle illustration is the intentional curved exception: its vessel and liquid use the asymmetric corner values in the frontmatter.

World shapes follow authoritative geometry. Masonry has broken faces, smaller wear clusters and contact lips. The Rillback is a continuous segmented ribbon with dorsal scutes and a pale underside. The Weaver separates abdomen, thorax, head and planted jointed limbs. [EnemySprites.ts](src/render/sprites/EnemySprites.ts) preserves shaded body structure during the hit response and reads simulation-owned poses.

## Components

### Entry actions and navigation

[ExpeditionEntry.ts](src/ui/ExpeditionEntry.ts) presents Begin or Continue as the first visible, larger underlined action, followed by other expedition actions and Controls & comfort. A saved expedition changes the secondary launch text to “Start a new expedition.” The primary action receives focus when the entry opens. Entry buttons use the warm hover color; launching disables them with opacity 0.6, a waiting cursor and a status message.

### Pause controls

[PauseOverlay.ts](src/ui/PauseOverlay.ts) gives Resume its own larger underlined control above the outlined action group and focuses it when opened. The action-group buttons change surface and text colors on hover. Resume has no separate source hover treatment. The input hint names Escape or Start according to the available input. Controls & comfort opens the same native settings dialog.

### Settings dialog, fields and bindings

[PlayerSettings.ts](src/ui/PlayerSettings.ts) uses a native labeled dialog, real buttons, a text-size select and native checkboxes. It pauses the game while open and restores focus to the prior visible control when closed. The ordinary controls share square outlines and the settings-control colors. Focus uses the shared mint outline (2px, offset 4px); the source declares no extra hover or error-color system for settings fields.

Binding buttons use bottom rules with the action on the left and key on the right. Listening changes the background and key prompt; feedback is a status paragraph. Text size, reduced flashes, camera shake, high-readability lighting and creature captions are persistent comfort choices when local storage is available.

### Vitals, wand and flask belt

[Hud.ts](src/ui/Hud.ts) presents three labeled, thin vital tracks. Fill widths update directly with no vital-fill transition. Wand slots show the active equipment and cast state. Every flask has its own key, quantity, material name and outlined bottle; its fill color comes from the contained material. The inherited liquid-fill transition is `height 0.15s steps(5, end)`.

### Objectives, captions and interaction cues

Room titles lead concise objectives in the upper-right group. Creature captions appear below the complete objective, including when it wraps, and use a polite live region. A sound report includes direction and remains for 1500ms. The anchored valve cue uses the current interact key or controller X with “Turn valve.” Other interaction cues use the established centered prompt placement.

### Material, creature and comfort states

Terrain, water, props and bodies respond to their own state. The hit tint keeps the incoming lit body colors and adds a bounded warm lift; reduced-flash mode skips that tint. Reduced flashes also lower the damage-vignette opacity and disable selected HUD animations. The operating-system reduced-motion query reduces CSS animation and transition durations to 0.01ms. Camera shake and high-readability lighting are independent settings. These implemented controls do not by themselves establish accessibility or real-controller acceptance.

## Do's and Don'ts

### Do:

- **Do** keep terrain texture and contact highlights attached to actual cells, including excavated edges.
- **Do** preserve the serif-title and system-text roles on the documented player surfaces.
- **Do** use semantic buttons, native settings controls and the visible mint keyboard-focus treatment.
- **Do** keep four independently sized flask slots and place captions after the complete objective in normal flow.
- **Do** retain creature anatomy and local contrast during habitat lighting and hit responses.

### Don't:

- **Don't** bake controls, labels, collision or interactive creatures into refinery imagery.
- **Don't** smooth the cell-material atlas or sample across its material-quadrant boundaries.
- **Don't** place the valve cue independently of the handwheel's runtime position.
- **Don't** replace the shaded creature hit response with a uniform body-filling white flash.
- **Don't** treat generated studies, still-frame finish review or simulated input checks as human or hardware acceptance.
