# Foundry UI kit

The game's interface is built from illustrated pieces that look as if they were made inside its foundry, not from
clean, vector-like panels. The materials are blackened iron, aged copper, reinforced corners, restrained mechanical
ornament and warm furnace-lit highlights. Major headings use cast-metal lettering; small labels stay plain and readable.

The kit is general on purpose. It serves the Duel screens now. It will also serve every interface of the planned
standalone fighter game: title, options, controls, dialogs, tooltips, toasts, loading and credits. Piece names are
therefore generic (`panel-large`, `button-primary`, `list-row`), never screen-specific.

The targets are the approved screens in `alchemists-descent-worktrees/UI/V1/` (the `ChatGPT Image Oct 4, 2026 ...`
files): results, HUD, pause, lobby and connect. The `Screenshot*.png` files in that folder show the old UI being
replaced.

- **Pieces:** `public/assets/arena/ui/*.png` (67 pieces, 79 PNGs with their states, about 380 KB), indexed by
  `public/assets/arena/ui/kit.json`.
- **Sources:** `docs/arena/platform-fighter/ui-sources/*.webp`, the ten generated sheets (lossy WebP, q92).
- **Build:** `node scripts/arena-sprites/build-ui-kit.mjs` cuts every piece from the sources and writes the PNGs and
  kit.json. It is deterministic, so rerunning it never needs a new generation. It deletes any PNG in the folder that no
  piece references, so the folder always matches kit.json exactly.
- **Preview:** `node scripts/arena-sprites/preview-ui-kit.mjs [http://127.0.0.1:<port>/]` writes
  `verify-out/ui-kit/preview.html`, which uses the real CSS recipes below. It has a sample options panel, a dialog, a
  pause list, the HUD cards with portraits, every frame stretched, every state, ornaments, word art and textures. Given
  a dev-server URL, it also screenshots each section to `verify-out/ui-kit/preview-*.png`.
- **Picking rectangles on a new sheet:** `node scripts/arena-sprites/cut-ui.mjs list <sheet> --preview out.png` numbers
  every piece. `cut-ui.mjs cut <sheet> --rect ... --factor F` tries one piece exactly as the kit would cut it.
- **Library:** `scripts/arena-sprites/ui-kit-lib.mjs` holds the image operations: key, cut, regularise, 9-slice,
  seamless tile, flatten, lift, transpose, mirror and hole bounds.

## The one display rule

**1 art pixel = 2 CSS px** (`kit.scale`, and `scale` on each piece), always with `image-rendering: pixelated`. The
panels, buttons and beads then share the chunky pixel of the fighters' sprites.

Every size, slice, band and offset in kit.json is in **art pixels**; multiply by 2 for CSS. Each piece's `css` field
gives its natural CSS size. Never scale a piece by a non-integer amount. PNG, not WebP: pixel art compresses better
losslessly, and lossy compression smears the pixels.

## kit.json

`pieces.<name>` has these fields:

- `file`
- `size`: `[w, h]` in art px
- `kind`: one of `frame`, `plate`, `image`, `tile`, `texture`, `word`
- `slice`: `[top, right, bottom, left]` 9-slice insets
- `band`: frames only; how far the visible border reaches in from the outside on each side. The fill tile must reach
  this far, so it shows inside the frame without poking out of its corners.
- `fill`: whether the 9-slice centre is drawn
- `repeat`: the `border-image-repeat` to use
- `period`: `[x, y]`, the length of one seamless edge repeat
- `fixed`: plates only; which side keeps its natural size. A plate keeps its height (`size[1] x scale`), a vertical
  plate keeps its width, and `null` means it stretches both ways.
- `states`: state name to file. The names are `normal`, `hot` (hover or focus) and `pressed`, plus `active` for a tab,
  `off` / `on` for a toggle or checkbox, and `lit` / `unlit` / `glow` for the lantern.
- `window`: HUD cards only; the portrait hole, measured from the end it sits at (`left` or `right`) plus `top`, `width`
  and `height`
- `use`
- `scale`
- `css`

| Kind | Pieces |
|---|---|
| frame (hollow 9-slice, transparent centre, fill behind) | `panel-large` (menus, lobby, pause, results, connect, options), `panel-small` (dialogs, confirmations, sub-panels), `card` and `card-teal` (seats, info boxes; teal is the second player), `slot` (text fields, value boxes, status and rules bars), `picture-frame` (stage, level or save tiles; its bottom 34 px are the caption plate) |
| plate (filled 9-slice) | `button-primary` and `button-secondary` (each normal / hot / pressed), `list-row` (normal / hot: the menu cursor), `tab` (normal / active), `title-plate`, `ribbon`, `nameplate`, `nameplate-hanging`, `tooltip` (stretches both ways), `keycap`, `band`, `hud-card` and `hud-card-teal`, `meter` and `meter-wide`, `slider-track`, `slider-fill`, `scroll-track` (vertical) |
| image | `slider-handle`, `scroll-thumb` (normal / hot); `toggle`, `checkbox` (off / on); `meter-cell`, `meter-cell-teal`, `meter-wide-cell`, `meter-wide-cell-teal`; `keycap-square`; `arrow-left` / `arrow-right` (normal / hot: the value cycler); `gear-small`; `gear-crest`; `medallion`; `seal`, `seal-teal`; `bead`, `bead-spent`, `bead-teal`, `bead-teal-spent`; `hanging-sign`; `banner-plate`; `chain-mount`; `lantern` (lit / unlit / glow); `divider` (whole) and its parts `divider-cap-left`, `divider-diamond`, `divider-cap-right` |
| tile | `divider-line` (repeat-x), `chain` (repeat-y), `fill-iron` (panel interiors), `fill-worn` (lighter, for slots) |
| texture | `text-copper`, `text-iron` (for `background-clip: text`) |
| word | `word-fight`, `word-game`, `word-time`, `word-vs`, `word-3`, `word-2`, `word-1` |

Copper is the base piece, and `-teal` is the second-player accent. The faces of the hanging sign, banner plate,
medallion, keycaps and every plate are blank on purpose: the game writes on them. The lantern's `glow` state is the lit
flame alone. Lay it over the unlit lantern and animate its opacity for a flicker.

## CSS recipes

In these recipes, `S` = 2 and `U` = `/assets/arena/ui/`.

**Hollow frame.** The fill goes behind and the frame goes over, so the element's children are never affected. The
values are panel-large's:

```css
.panel { position: relative; isolation: isolate; box-sizing: border-box; padding: 60px 64px 60px 64px; /* slice x S */ }
.panel::before { content: ''; position: absolute; z-index: -1; inset: 28px 30px 28px 28px; /* band x S */
  background: url(U/fill-iron.png) 0 0 / 384px auto repeat; image-rendering: pixelated; }
.panel::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-style: solid;
  border-width: 60px 64px 60px 64px;
  border-image: url(U/panel-large.png) 30 32 30 32 / 60px 64px 60px 64px round; image-rendering: pixelated; }
```

The small panel, cards and slots work the same way; slots use `fill-worn.png` at 384px. A frame cannot be smaller than
its slices: panel-large's minimum is 64 x 60 art px (128 x 120 CSS).

**Plate or button.** The fixed side comes from `fixed`, and each state other than `normal` swaps `border-image-source`:

```css
.btn { box-sizing: border-box; height: 68px; /* size[1] x S */ display: inline-flex; align-items: center; justify-content: center;
  border-style: solid; border-width: 16px 40px;
  border-image: url(U/button-primary.png) 8 20 8 20 fill / 16px 40px round stretch; image-rendering: pixelated; }
.btn:hover, .btn:focus-visible { border-image-source: url(U/button-primary-hot.png); }
.btn:active { border-image-source: url(U/button-primary-pressed.png); }
```

The other plates follow the same pattern:
- The list row is 52px tall (`6 22 6 22`); its `hot` state is the menu cursor.
- The tab's `active` state is the open tab.
- The title plate sits across a panel's top edge, absolutely positioned and centred, overlapping the frame by about
  half its height.
- The tooltip has no fixed side: `repeat: round` both ways, so it grows with its text.
- `scroll-track` is vertical: a fixed width of 24px, `border-image-repeat: stretch round`, and any height.
- The band's period is long (115 art px), so it reads best at least about 150 art px wide.
- The HUD cards read best at least about 150 art px wide.

**Slider.** A plain wrapper with three layers:

```css
.slider { position: relative; height: 34px; }                    /* slider-track height x S */
.slider .track { /* plate: slider-track, 6 9 6 9, width 100% */ }
.slider .fill  { position: absolute; left: 16px; top: 8px; height: 14px; width: calc(var(--v) * (100% - 32px)); }
                 /* plate: slider-fill, 2 4 2 4; the groove's inside is 8 art px in from each end, 4 down, 7 tall */
.slider .handle { position: absolute; top: -6px; left: calc(16px + var(--v) * (100% - 32px) - 22px); }
                 /* slider-handle img, 22 x 23 art; swap to the hot state while dragging or focused */
```

Hide the fill at value 0: it has a minimum width of its two end slices, 8 art px.

**Toggle and checkbox.** Swap the image between the `off` and `on` states. Each state image is drawn at the same size.

**Scroll bar.** Use a `scroll-track` plate at the list's height, with a `scroll-thumb` image (13 x 34 art, fixed size)
absolutely positioned on it at the scroll position, inset 7 art px at each end. Swap the thumb to its `hot` state while
it is dragged.

**Meter.** A `meter` plate whose width is 12 + 13n art px for n cells, so `round` never resamples it. Cell k's inside
is at left 7 + 13k and top 3, and is 11 x 9. Put a `meter-cell` (gold) or `meter-cell-teal` image there for each
filled or refilling cell; an empty cell shows the dark housing.

`meter-wide` is the same housing with long cells, like the gold bars of the HUD target. Its width is 12 + 26n art px, and
cell k's inside is at left 7 + 26k and top 3, and is 24 x 9. Fill it with `meter-wide-cell` (gold) or `meter-wide-cell-teal`.
Both meters' geometry is also in their kit.json `use` text.

**HUD card.** A `hud-card` plate, 168px tall: the portrait window sits in the 82-art-px end slice, and the body
stretches. Put the portrait in a sibling element behind the card (`z-index: -1` inside an `isolation: isolate`
wrapper). Size and position it to `window`, with `background-size: cover`. For example, `left: 30px; top: 30px;
width: 108px; height: 110px` for the copper card; the teal card measures its window from the right. The card's content
box, between the slices, holds the name, beads, percent and meter.

**Hanging nameplate.** Its top slice is 65 art px and holds the two chains, so the text sits in the bottom 20 art px
(the plate's face). Flank it with `lantern` images for the footer sign of the lobby target.

**Divider.** A flex row of five parts: `divider-cap-left`, then a `flex: 1` div with
`background: url(U/divider-line.png) 0 0 / 20px 22px repeat-x`, then `divider-diamond`, then the same line div, then
`divider-cap-right`. The images are 22px tall. For a fixed width, use `divider.png` whole. For an OR between two
choices, put `gear-small` with the word on it in place of the diamond.

**Chain.** `width: 20px; background: url(U/chain.png) 0 0 / 20px 34px repeat-y;`. Hang it from `chain-mount`, whose ring
is at the bottom.

**Lettering.** Big headings use cast metal:

```css
.cast { background: url(U/text-copper.png) repeat-x 0 0 / auto 100%;
  -webkit-background-clip: text; background-clip: text; color: transparent; }
```

Use `text-iron` for secondary headings. The texture carries a top-to-bottom gradient (hot at the top, dark at the
foot), so `auto 100%` fits one gradient to the line box. Small labels and body text should stay plain warm cream
(about `#e8d9c0`): below about 14px the grain turns to mush.

## Pipeline

1. **Generate.** gpt-image-2 (ElevenLabs flow `dm0rRnzJZIFo7p38WDLO`) made ten 2K sheets at high quality. Each sheet
   has every piece isolated on flat `#FF00FF` magenta, apart from the textures sheet, which is a 2 x 2 grid of
   edge-to-edge swatches.
   - **References** are the approved target screens. Lobby `0fOkpcA4ZvRsW7F1ns9k`, results `Pi9vnoi2yw5BKHQPvhwb`,
     pause `FGlICm3jtixaiDJYHRCO`, connect `xpgJxgixB4i03KwFIlK7` and HUD `pmQFQDbqr7u3Q1JAyqYK` are
     `UI/V1/ChatGPT Image Oct 4, 2026 ...`. The arena backdrop, `public/assets/arena/foundry-backdrop.png`, is
     `hDbkWpZwlMeQkhzhzu3D`.
   - The later sheets (controls, menus, hud) also take the kit's own frames and buttons sheets as references, so new
     pieces match the existing material and pixel size.
   - **Prompt rules:**
     - Ask for each art pixel to be about 4 image pixels.
     - Ask for blank faces: text is added by the game.
     - Keep every glow inside its piece's outline, because a halo on the magenta cannot be keyed.
     - Runs that will repeat must be "plain and uniform along their whole length".
2. **Key.** Each pixel gets a magenta-ness: high and balanced red and blue, with low green. An anti-aliased fringe is
   decontaminated (the key colour is un-mixed), not just cut.
3. **Cut.** Each piece's loose rectangle is tightened to its drawn pixels, then area-downsampled to art pixels.
   - The downsample is a box filter with fractional footprints, weighted by coverage so the key never tints an edge.
   - The factor (source px per art px) or exact size is chosen per piece, so the piece is the right size at the one
     display scale.
   - Pieces that must fit together are cut to each other's measured insides. The slider fill is cut to the groove's
     7 art px. The meter's cell fills are cut to a cell's 11 x 9. A toggle's two states share one size.
   - The wide-cell meter is derived without a generation. Each cell's inside is widened from 11 to 24 art px by
     ping-ponging its flat middle columns; turning on its shaded edge columns would draw a line. The long cell fills are
     widened in the source sheet, at the square cell's source pixels per art pixel, and then cut like any piece. At
     source resolution the mirroring is finer than an art pixel, so it does not read as a pattern.
   - Alpha is made crisp (coverage >= 0.5), and colours are snapped to the piece's own k-means palette (40 colours).
4. **Regularise the 9-slices** (`regularise`).
   - The corners are kept exactly as drawn.
   - Each straight edge becomes one repeating stretch of itself. The period and start are searched together, and the
     cost of a candidate is the sum of four terms:
     - how periodic the whole edge is at that lag (the rivet rhythm picks the period);
     - how well every column of the stretch matches the column one period on in the source;
     - how source-like the seam is;
     - how smoothly the stretch meets both corners.
   - Top and bottom share a period, as do left and right. Hollow frames keep a transparent centre; plates keep their
     filled centre. The centre slice is exactly one period, so CSS `round` tiles whole periods.
   - Vertical plates are regularised transposed. A piece's states are forced to its first state's period, so swapping
     states never shifts the pattern.
   - Judging only the seam was not enough: on the panel, it picked a stretch near a corner that held two unevenly
     spaced rivets, so a long edge showed rivets in pairs.
   - A short period on a textured plate makes the noise visibly repeat. The HUD cards and the tooltip therefore search
     long periods (60-120 and 24-76 art px).
5. **Tiles.**
   - The fills are cropped opaque, then made seamless by cross-fading a wrap margin (`seamlessTile`), then flattened.
     Flattening divides out the sheet's broad lighting with a wrapping box blur; otherwise the gradient striped the
     panel once tiled. Both fills are 192 art px wide, so a panel interior shows little repetition. fill-iron is 101
     tall: one rivet row per tile.
   - The text textures repeat only across, and are lifted (gamma and gain: copper 0.75 x 1.15, iron 0.6 x 1.4). As
     generated, they were shaded for a plate and too dark to read as lettering on dark iron.
   - The divider line and the chain are the most periodic strip of their piece.
6. **Measure.** The HUD cards' portrait windows are measured from the art (the transparent pixels the card encloses)
   and written into kit.json as `window`.
7. **Check.**
   - Each frame and plate was stretched to three sizes, and each state to three widths, with `nineSlice` (zoomed
     contact sheets).
   - The preview page shows everything through the real CSS, over the game's backdrop:
     `verify-out/ui-kit/preview-controls.png`, `-menus`, `-hud`, `-frames`, `-buttons`, `-divider`, `-ornaments`,
     `-words`, `-type`, `-fills`.

## Spend

Each sheet is gpt-image-2 high, 2K, one generation, with no re-generations. Every later fix (rivet period, tile width,
lighting, text lift, periods, fits) was a rebuild from the same sources.

| Round | Sheets | Credits | Cost |
|---|---|---|---|
| Round 4 (frames, pieces, buttons, ornaments, signs, words, textures) | 7 | 17,320 | $3.80 |
| Round 5 (controls, menus, hud) | 3 | 7,878 | $1.73 |
| **Total** | **10** | **25,198** | **$5.53** |

## Prompts

### frames.webp (F1)

Node `2nF5i85GlYaFNiCbjcHl`, generation `jU7rIsGewaOEAnNJAs0c`: gpt-image-2, high, 2K 16:9 (2048x1152), 2239 credits ($0.49). References: lobby, results, pause, connect, backdrop.

```text
Game asset: a UI KIT SHEET of illustrated pixel-art interface FRAMES for a dark industrial fantasy fighting game set in a foundry. The pieces will be cut out and used as 9-slice frames, so they must be drawn as empty hollow borders.

LOOK: exactly the interface material of the first four references (approved target screens of this game: the lobby, results, pause and connect panels) and the foundry environment of the fifth reference. Hand-made, heavy, manufactured inside the foundry, never a clean vector or website look: blackened, pitted, hammered iron plate; aged copper trim strips with rust and green verdigris; round copper rivets; reinforced iron corner brackets with bolts; restrained mechanical ornament; warm orange furnace light catching the top edges and inner bevels; soot, grime and wear in the recesses. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines, three-to-five tone shading.

PIECES (each one isolated, with wide gaps of flat magenta between pieces):
1. LARGE PANEL FRAME, filling the left two thirds of the image: a wide rectangular hollow frame (about 1.6 wide to 1 tall), a heavy border about 1/12 of its height thick: an outer blackened iron band, an aged copper trim strip with evenly spaced rivets, and an inner bevel lit warm along its top. Big reinforced iron corner brackets with bolts at all four corners. The straight runs between the corners are plain and uniform along their whole length (the same rivet spacing all the way), with no ornament in the middle of any side.
2. CARD FRAME (copper), top of the right column: a smaller hollow frame (about 2.4 wide to 1 tall) with a thinner border (iron with copper trim), small copper corner caps with a rivet, uniform straight sides.
3. CARD FRAME (teal), middle of the right column: exactly the same as piece 2, but its trim and corner caps are oxidised teal-green metal (verdigris teal, the colour of player two in the references) instead of copper.
4. INSET SLOT FRAME, bottom of the right column: a long recessed slot frame (about 4.5 wide to 1 tall), a thin sunken iron bevel (dark at the top inner edge, lit at the bottom inner edge, as if pressed into the plate), tiny rivets in the corners, uniform straight sides.

RULES: the inside of every frame is EMPTY: flat pure magenta (#FF00FF) shows through the hole. The whole background is solid flat pure magenta (#FF00FF). No text, no letters, no numbers, no icons, no gears on the sides, no chains, no lanterns, no drop shadows on the magenta, no glow halos outside the frames.
```

### pieces.webp (F2)

Node `P5gcCP2MdRPY9tymYsFT`, generation `qVEjavxL2mttXEgex1O8`: gpt-image-2, high, 2K 3:2 (2048x1360), 2546 credits ($0.56). References: lobby, results, pause, connect, backdrop.

```text
Game asset: a UI KIT SHEET of illustrated pixel-art interface pieces for a dark industrial fantasy fighting game set in a foundry. The pieces will be cut out and used directly in the interface.

LOOK: exactly the interface material of the first four references (approved target screens of this game: the lobby, results, pause and connect panels) and the foundry environment of the fifth reference. Hand-made, heavy, manufactured inside the foundry, never a clean vector or website look: blackened, pitted, hammered iron; aged copper trim with rust and verdigris; copper rivets; reinforced corners with bolts; warm orange furnace light catching top edges and inner bevels; grime and wear. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines, three-to-five tone shading.

PIECES (each one isolated, with wide gaps of flat magenta between pieces):
1. STAGE TILE FRAME, left side: a tall hollow picture frame (about 3 wide to 4 tall, like the stage tiles of the lobby reference), iron with copper trim and small corner brackets, uniform straight sides, and attached below it a blank LABEL PLATE: a horizontal riveted iron name plate the same width as the frame, joined to its bottom edge. The picture area inside the frame is EMPTY flat magenta.
2. CUT-IN BAND, across the top right: a long horizontal band (about 7 wide to 1 tall): copper-trimmed iron rails along its top and bottom edges, a dark iron plate between them, riveted end caps at the left and right ends; plain and uniform along its length between the end caps.
3. DIVIDER, under the band: a thin horizontal copper rule (about 14 wide to 1 tall) with a small copper diamond in its exact centre and small decorative copper end caps, like the dividers under the headings of the references.
4. KEYCAPS, middle right: a small square iron keyboard key with a raised blank face and copper edge, and a wider key (about 2.5 wide to 1 tall) in the same style, both with blank faces.
5. CYCLER ARROWS, bottom right: four chunky bevelled copper arrowheads in a row: left-pointing dull copper, right-pointing dull copper, left-pointing glowing hot bright copper (lit from within, as if heated), right-pointing glowing hot bright copper. All four the same size.
6. OR GEAR, bottom centre: a small iron gear medallion with a copper rim and a blank dark centre, like the gear between HOST and JOIN in the connect reference.

RULES: the whole background is solid flat pure magenta (#FF00FF). No text, no letters, no numbers, no icons, no glyphs on the keys, no chains, no lanterns, no drop shadows on the magenta, no glow halos outside the pieces.
```

### buttons.webp (B)

Node `MPHoVq5CHDXXyuRefsXj`, generation `EVtjHlwej2xwfA3thqRQ`: gpt-image-2, high, 2K 3:2 (2048x1360), 2546 credits ($0.56). References: lobby, results, pause, connect, backdrop.

```text
Game asset: a UI KIT SHEET of illustrated pixel-art BUTTON PLATES for a dark industrial fantasy fighting game set in a foundry. The plates will be cut out and used as stretchable buttons, so their long sides must be plain and uniform.

LOOK: exactly the buttons of the references (approved target screens of this game): the hot copper READY, REMATCH and HOST A MATCH plates and the dark iron CHANGE FIGHTERS, JOIN MATCH and pause-menu plates. Hand-made, heavy, manufactured inside the foundry, never a clean vector or website look. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines, three-to-five tone shading, warm furnace light on the top edges, grime and wear.

PIECES: six button plates in a grid of 3 columns by 2 rows, every plate EXACTLY the same size and shape (a wide rectangle about 4.5 wide to 1 tall with slightly clipped corners), each isolated with wide gaps of flat magenta between them, every face BLANK (no text):
ROW 1, the COPPER PRIMARY plate: (1) NORMAL: a hot rusted copper face inside a dark iron frame with small copper corner rivets and a small copper diamond stud near each short end; (2) HOT (hover): the identical plate, its copper face glowing brighter as if heated from within, the rim lit bright orange; (3) PRESSED: the identical plate pushed in: the face darker and a little lower, a dark inner shadow under its top edge.
ROW 2, the IRON SECONDARY plate: (1) NORMAL: a blackened iron face inside a thin aged-copper frame with corner rivets and a small dull diamond stud near each short end; (2) HOT: the identical plate with its copper frame lit bright warm orange and the iron face slightly lifted by the light; (3) PRESSED: the identical plate pushed in, darker, a dark inner shadow under its top edge.

RULES: the whole background is solid flat pure magenta (#FF00FF). No text, no letters, no numbers, no icons, no drop shadows on the magenta, no glow halos outside the plates (keep any glow inside the plate outline).
```

### ornaments.webp (O1)

Node `pYV8YT1OHqLYWhZ2lYNH`, generation `NWfGmyxmSeoUnrlVPnCX`: gpt-image-2, high, 2K 3:2 (2048x1360), 2786 credits ($0.61). References: lobby, results, pause, connect, HUD, backdrop.

```text
Game asset: a UI KIT SHEET of illustrated pixel-art ORNAMENTS for a dark industrial fantasy fighting game set in a foundry. The pieces will be cut out and placed on top of the interface.

LOOK: exactly the ornaments of the references (approved target screens of this game, and the foundry environment in the last reference). Hand-made, heavy, manufactured inside the foundry: blackened pitted iron, aged copper with rust and verdigris, copper rivets and bolts, warm orange furnace light on the top edges, grime and wear. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines, three-to-five tone shading.

PIECES (each one isolated, with wide gaps of flat magenta between pieces):
1. GEAR CREST, top left: the ornament that sits on the top edge of the big panels in the references: a half gear (the top half of a big iron gear with copper teeth and a riveted hub) rising from a short riveted iron mounting plate.
2. CHAIN, top centre: a long straight vertical hanging chain of about eight heavy dark iron links (identical links, evenly spaced, the top and bottom links cut cleanly so it can repeat), and beside it its MOUNT: an iron wall bracket with a ring that the chain hangs from.
3. LANTERN, top right: a hanging iron cage lantern with a bright amber flame behind its glass, like the lanterns flanking the panels in the references; and beside it the same lantern UNLIT (dark smoky glass, no flame), identical in shape and size.
4. VS MEDALLION, centre: a big round gear medallion: a thick iron gear ring with copper teeth and rivets around a recessed dark iron disc whose face is BLANK.
5. READINESS SEALS, centre right: two small round seal medallions the same size: one copper with an embossed check mark, one oxidised teal-green with an embossed check mark.
6. STOCK BEADS, bottom right: eight small round beads in two rows, all the same size: top row copper: two glowing lit copper-orange glass orbs set in iron sockets, then two spent ones (dark dull sockets, the orb dark); bottom row teal: two glowing lit teal glass orbs in iron sockets, then two spent ones.

RULES: the whole background is solid flat pure magenta (#FF00FF). No text, no letters, no numbers except the check marks, no drop shadows on the magenta, no glow halos outside the pieces (keep every glow inside the piece's outline).
```

### signs.webp (O2)

Node `AXQ1Qm9VFjNtdN4n7Zpu`, generation `4FQkor7bczQQYKHJEvqU`: gpt-image-2, high, 2K 3:2 (2048x1360), 2065 credits ($0.45). References: HUD, lobby, backdrop.

```text
Game asset: a UI KIT SHEET of two illustrated pixel-art SIGN PLATES for a dark industrial fantasy fighting game set in a foundry. The pieces will be cut out and placed in the interface; text is added later by the game.

LOOK: exactly the signs of the first reference (the approved match screen of this game: the hanging timer sign at the top and the big plate behind FIGHT!), in the foundry material of the references. Hand-made, heavy, manufactured inside the foundry: blackened pitted iron, aged copper with rust and verdigris, copper rivets and bolts, warm orange furnace light on the top edges, grime and wear. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines, three-to-five tone shading.

PIECES (each one isolated, with wide gaps of flat magenta between them):
1. HANGING TIMER SIGN, top half of the image, centred: a riveted iron sign plate (about 2.6 wide to 1 tall) with a copper frame and a small half gear on its top edge, two short chains rising from its top corners, and a small hanging lit lantern mounted on an iron arm at its left side and at its right side. The sign's face is a BLANK dark recessed panel.
2. BANNER SIGN PLATE, bottom half of the image, centred: the big plate behind the word FIGHT! in the reference: a wide riveted iron plate (about 3.4 wide to 1 tall) with a thick copper frame, a big half gear rising from the middle of its top edge and a smaller half gear hanging from the middle of its bottom edge, and long pointed iron spikes jutting out horizontally from its left and right ends. Its face is a BLANK dark recessed panel.

RULES: the whole background is solid flat pure magenta (#FF00FF). No text, no letters, no numbers, no drop shadows on the magenta, no glow halos outside the pieces (keep the lantern glow inside the lanterns).
```

### words.webp (W)

Node `vVK1VDx4fwxYxUQgLR0Q`, generation `2dnKxecznqQlvJua709y`: gpt-image-2, high, 2K 3:2 (2048x1360), 1825 credits ($0.40). References: HUD, lobby.

```text
Game asset: a sheet of WORD ART for a fast, adrenaline-pumping arcade fighting game set in a dark foundry: seven separate titles, each to be cut out and shown on screen alone.

LOOK: exactly the lettering of the word FIGHT! in the first reference (the approved match screen) and the VS of the second: thick, heavy slab-serif capital letters CAST IN METAL like foundry signage: rusted, pitted copper with a dark iron outline and bevel, bright hot copper on the top faces, darker rust and soot at the bottom, glowing hot orange heat in the cracks and pits as if fresh from the furnace. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines.

THE SEVEN TITLES, each isolated with wide gaps of flat magenta between them, all in the same lettering at the same letter height:
ROW 1: FIGHT!   GAME!
ROW 2: TIME!   VS
ROW 3: 3   2   1   (three big single digits, each the same height as the letters above)

RULES: only the letters themselves (with their metal outline and bevel), no plate, no sign, no gear, no frame behind them. The whole background is solid flat pure magenta (#FF00FF). No other text, no drop shadows on the magenta, no glow halos, no smoke, no sparks outside the letters (keep all heat glow inside the letter shapes).
```

### textures.webp (T)

Node `4NQPACFzV1flqp6hO0JT`, generation `cC2GKatVt0Ya0aesO72T`: gpt-image-2, high, 2K 1:1 (2048x2048), 3313 credits ($0.73). References: results, pause, backdrop.

```text
Game asset: four flat, front-on MATERIAL TEXTURE SWATCHES for the interface of a dark industrial fantasy fighting game set in a foundry, arranged in a 2 by 2 grid of equal squares that fill the whole image edge to edge (no gaps, no borders, no frames). Each swatch will be cut out and made into a seamless repeating tile.

LOOK: the materials of the references (approved target screens of this game and its foundry environment). Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), three-to-five tone shading, even lighting across each swatch (no vignette, no light falloff toward the edges, no single big feature).
TOP LEFT: DARK IRON PLATE for panel interiors: blackened hammered iron, very dark (near #15191f), with fine scuffs and scratches, faint patches of rust bloom, and two faint rows of small flush rivets; evenly spread detail, low contrast so text stays readable on it.
TOP RIGHT: LIGHTER WORN IRON for recessed slots and value boxes: grey-blue worn iron, a little lighter than the dark plate, rubbed and polished in places, small dents and scratches, evenly spread.
BOTTOM LEFT: CAST COPPER for letter fills: hot cast copper with rust and grit and pitting, bright orange-gold at the TOP of the square fading to dark rusty brown at the BOTTOM (a vertical gradient), evenly textured from left to right.
BOTTOM RIGHT: CAST IRON for letter fills: grey cast iron with grit and pitting, lighter at the TOP fading to near black at the BOTTOM (a vertical gradient), evenly textured from left to right.

RULES: no text, no letters, no objects, no rivet borders around the squares, no frames, no gaps between the squares.
```

### controls.webp (G1)

Node `6C6grTAtoHVDpFppMlZS`, generation `bzOWDRCkwlzRDiSDwy4Z`: gpt-image-2, high, 2K 3:2 (2048x1360), 2786 credits ($0.61). References: lobby, pause, connect, results, then the kit's frames and buttons sheets.

```text
Game asset: a UI KIT SHEET of illustrated pixel-art interface CONTROLS (for options and settings screens) for a dark industrial fantasy game set in a foundry. The pieces will be cut out; long pieces are stretched, so their long runs must be plain and uniform.

LOOK: the same material, pixel size and colours as the last two references (pieces of this interface kit already made: frames and buttons on magenta), and the approved target screens of this game (the other references). Hand-made, heavy, manufactured inside the foundry, never a clean vector or website look: blackened pitted iron, aged copper with rust and verdigris, copper rivets, warm orange furnace light on the top edges, grime and wear. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines, three-to-five tone shading.

PIECES (each one isolated, with wide gaps of flat magenta between pieces):
1. SLIDER TRACK, top row, long: a long horizontal recessed groove (about 14 wide to 1 tall) sunk into an iron bar, with small riveted end caps. The inside of the groove is EMPTY dark iron, shadowed along its top inner edge. Uniform along its whole length.
2. SLIDER FILL, under the track: a long horizontal bar of glowing hot molten copper, as long as the track and exactly as tall as the inside of its groove, with rounded ends and a bright top edge, uniform along its length. No groove around it.
3. SLIDER HANDLES, right of the fill: two chunky copper knob handles the same size (a squat riveted copper block with a grip line down its middle, taller than the track): NORMAL (dull copper) and HOT (glowing bright hot copper, lit from within).
4. TOGGLE SWITCHES, middle row left: two identical lever switch plates (about 2 wide to 1 tall: a recessed iron slot with a copper knob in it): OFF (the knob at the LEFT end, the slot dark and cold) and ON (the knob at the RIGHT end, the slot glowing warm orange around it).
5. CHECKBOXES, middle row right: two identical small square recessed iron boxes with a thin copper rim: UNCHECKED (empty dark inside) and CHECKED (a bold embossed copper check mark inside, glowing warm).
6. SCROLL BAR, bottom row: a tall vertical recessed iron track (about 1 wide to 8 tall) with small riveted end caps, its groove EMPTY dark iron, uniform along its length; beside it two identical vertical THUMBS (a riveted copper bar about 1 wide to 3 tall with three grip lines across its middle): NORMAL (dull copper) and HOT (glowing bright hot copper).

RULES: the whole background is solid flat pure magenta (#FF00FF). No text, no letters, no numbers, no icons, no drop shadows on the magenta, no glow halos outside the pieces (keep every glow inside the piece's outline).
```

### menus.webp (G2)

Node `06OimTI1lGPvmtkxkPOt`, generation `eykceqwAR0LMor2t7Jnr`: gpt-image-2, high, 2K 3:2 (2048x1360), 2546 credits ($0.56). References: pause, lobby, connect, then the kit's frames and buttons sheets.

```text
Game asset: a UI KIT SHEET of illustrated pixel-art MENU pieces (dialogs, tabs, menu lists, tooltips) for a dark industrial fantasy game set in a foundry. The pieces will be cut out and stretched as 9-slices, so every straight run between the ends or corners must be plain and uniform.

LOOK: the same material, pixel size and colours as the last two references (pieces of this interface kit already made: frames and buttons on magenta), and the approved target screens of this game (the other references; the first is the pause menu). Hand-made, heavy, manufactured inside the foundry, never a clean vector or website look: blackened pitted iron, aged copper with rust and verdigris, copper rivets, warm orange furnace light on the top edges, grime and wear. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines, three-to-five tone shading.

PIECES (each one isolated, with wide gaps of flat magenta between pieces):
1. DIALOG FRAME, left half of the image: a hollow rectangular frame (about 1.5 wide to 1 tall), lighter than a big panel: a medium border of blackened iron with an aged copper inner trim, small riveted copper corner plates, uniform straight sides (the same rivet spacing all along, no ornament in the middle of any side). The inside of the frame is EMPTY: flat magenta shows through the hole.
2. TITLE PLATE, top right: a heading plate that sits across the top edge of a dialog (about 5 wide to 1 tall): a dark iron plate with a copper frame, both ends clipped and bolted with a rivet, blank face, uniform between the ends.
3. TABS, right, under the title plate: two identical tab plates side by side (about 3.5 wide to 1 tall, the two top corners clipped, the bottom edge flat as if joined to a panel below): INACTIVE (dark blackened iron face, dull aged copper trim) and ACTIVE (the face warm lit copper and the trim bright, glowing as if heated).
4. LIST ROWS, right, under the tabs: two identical slim menu row plates one above the other (about 9 wide to 1 tall, like the menu rows of the pause reference), each with a tiny copper diamond stud near each short end: NORMAL (dark iron face, thin dull copper edge) and HOT (the focused row: a glowing lit copper bar with a bright orange rim, like RESUME MATCH in the pause reference).
5. TOOLTIP PLATE, bottom right: a compact dark iron plate (about 3 wide to 1 tall) with a thin bright copper border and a tiny rivet in each corner, blank face, uniform sides.

RULES: every face is BLANK. The whole background is solid flat pure magenta (#FF00FF). No text, no letters, no numbers, no icons, no drop shadows on the magenta, no glow halos outside the pieces (keep every glow inside the piece's outline).
```

### hud.webp (G3)

Node `8Be13fsdQmeBShCBQtCl`, generation `AZQs7AXl9C8ZVI0e4IOu`: gpt-image-2, high, 2K 3:2 (2048x1360), 2546 credits ($0.56). References: HUD, lobby, connect, then the kit's frames and buttons sheets.

```text
Game asset: a UI KIT SHEET of illustrated pixel-art HUD CARDS and PLATES for a dark industrial fantasy fighting game set in a foundry. The pieces will be cut out and stretched as 9-slices, so every straight run between the ends or corners must be plain and uniform.

LOOK: the same material, pixel size and colours as the last two references (pieces of this interface kit already made: frames and buttons on magenta), and the approved target screens of this game (the other references; the first is the match screen with its two player cards at the bottom). Hand-made, heavy, manufactured inside the foundry, never a clean vector or website look: blackened pitted iron, aged copper with rust and verdigris, copper rivets, warm orange furnace light on the top edges, grime and wear. Pixel art with clearly visible square pixels (each art pixel about 4 image pixels), crisp dark outlines, three-to-five tone shading.

PIECES (each one isolated, with wide gaps of flat magenta between pieces):
1. HUD CARD, COPPER, top left: like the player card at the bottom left of the first reference: a horizontal card (about 3.4 wide to 1 tall): an iron card body with copper trim and corner rivets, and at its LEFT end a square PORTRAIT WINDOW: a hollow square frame with a heavier copper rim whose inside is EMPTY (flat magenta shows through; a portrait goes there later). The body to the right of the window is a plain dark iron plate, blank, uniform along its length.
2. HUD CARD, TEAL, top right: exactly the same card MIRRORED: the portrait window at its RIGHT end, and its trim and window rim oxidised teal-green (verdigris teal, the colour of player two) instead of copper.
3. METER, middle left: a long thin recessed iron meter housing (about 8 wide to 1 tall) divided into equal cells by small iron ribs, every cell the same width, with small end caps; the cells are EMPTY dark iron. Beside it two loose CELL FILLS, each exactly the size of the inside of one cell: one glowing molten GOLD, one glowing TEAL.
4. NAMEPLATE, middle right: a small iron name plate (about 4 wide to 1 tall) with a copper rim and a tiny rivet at each end, blank face, uniform between the ends.
5. HANGING NAMEPLATE, bottom left: the same kind of plate, a little larger (about 5 wide to 1 tall), hanging from two short iron chains that rise straight up from its top corners (the chains about as tall as the plate), blank face, uniform between the ends.
6. SUBTITLE RIBBON, bottom right: a thin long riveted iron plate (about 12 wide to 1 tall, like the plate under the CONNECT heading in the references) with small clipped and bolted end caps and a thin copper edge, blank face, uniform along its length.

RULES: every face is BLANK. The whole background is solid flat pure magenta (#FF00FF). No text, no letters, no numbers, no icons, no portraits, no drop shadows on the magenta, no glow halos outside the pieces (keep every glow inside the piece's outline).
```
