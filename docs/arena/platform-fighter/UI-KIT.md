# Foundry UI kit

The duel's interface is built from illustrated pieces that look made inside the game's foundry, replacing clean,
vector-like panels. The materials are blackened iron, aged copper, reinforced corners, restrained mechanical ornament
and warm furnace-lit highlights. Major headings use cast-metal lettering; small labels stay plain and readable.

The targets are the approved screens in `alchemists-descent-worktrees/UI/V1/` (the `ChatGPT Image Oct 4, 2026 ...`
files): results, HUD, pause, lobby and connect. The `Screenshot*.png` files in that folder show the old UI being
replaced.

- **Pieces:** `public/assets/arena/ui/*.png`, indexed by `public/assets/arena/ui/kit.json`.
- **Sources:** `docs/arena/platform-fighter/ui-sources/*.webp`, the seven generated sheets (lossy WebP, q92).
- **Build:** `node scripts/arena-sprites/build-ui-kit.mjs` cuts every piece from the sources and writes the PNGs and
  kit.json. It is deterministic, so rerunning it never needs a new generation.
- **Preview:** `node scripts/arena-sprites/preview-ui-kit.mjs [http://127.0.0.1:<port>/]` writes
  `verify-out/ui-kit/preview.html`, which uses the real CSS recipes below. Given a dev-server URL, it also
  screenshots each section to `verify-out/ui-kit/preview-*.png`.
- **Picking rectangles on a new sheet:** `node scripts/arena-sprites/cut-ui.mjs list <sheet> --preview out.png` numbers
  every piece. `cut-ui.mjs cut <sheet> --rect ... --factor F` tries one piece exactly as the kit would cut it.
- **Library:** `scripts/arena-sprites/ui-kit-lib.mjs` holds the image operations: key, cut, regularise, 9-slice,
  seamless tile, flatten and lift.

## The one display rule

**1 art pixel = 2 CSS px** (`kit.scale`, and `scale` on each piece), always with `image-rendering: pixelated`. The
panels, buttons and beads then share the chunky pixel of the fighters' sprites.

Every size, slice and band in kit.json is in **art pixels**; multiply by 2 for CSS. Each piece's `css` field gives its
natural CSS size. Do not scale pieces by non-integer amounts. Do not use the text textures at sizes where their grain
turns to mush; see Lettering below.

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
- `period`: the length of one seamless edge repeat
- `states`
- `use`
- `scale`
- `css`

| Kind | Pieces |
|---|---|
| frame (hollow 9-slice, transparent centre) | `frame-panel` (lobby, pause, results, connect), `frame-card` (P1 copper), `frame-card-teal` (P2), `frame-slot` (room code, value boxes, rules bar), `frame-stage` (stage tile; its bottom 34 px are the label plate) |
| plate (filled 9-slice, fixed height) | `button-copper` and `button-iron` (each with normal / hot / pressed), `keycap-wide` (Esc, Enter), `band` (super cut-in) |
| image | `keycap`; `arrow-left` / `arrow-right` (normal, hot); `or-gear`; `gear-crest`; `vs-medallion`; `seal-copper`; `seal-teal`; `bead-copper` / `bead-teal` and their `-spent` versions; `timer-sign`; `banner-plate`; `chain-mount`; `lantern` (lit, unlit, glow); `divider` (whole) and its parts `divider-cap-left`, `divider-diamond`, `divider-cap-right` |
| tile | `divider-line` (repeat-x), `chain` (repeat-y), `fill-iron` (panel interiors), `fill-worn` (lighter, for slots) |
| texture | `text-copper`, `text-iron` (for `background-clip: text`) |
| word | `word-fight`, `word-game`, `word-time`, `word-vs`, `word-3`, `word-2`, `word-1` |

The faces of the timer sign, banner plate and VS medallion are blank on purpose: the game puts the time, word art or
VS on them. The lantern's `glow` state is the lit flame alone. Lay it over the unlit lantern and animate its opacity
for a flicker.

## CSS recipes

In these recipes, `S` = 2 and `U` = `/assets/arena/ui/`. The values are frame-panel's.

**Hollow frame.** The fill goes behind and the frame goes over, so the element's children are never affected:

```css
.panel { position: relative; isolation: isolate; box-sizing: border-box; padding: 60px 64px 60px 64px; /* slice x S */ }
.panel::before { content: ''; position: absolute; z-index: -1; inset: 28px 30px 28px 28px; /* band x S */
  background: url(U/fill-iron.png) 0 0 / 384px auto repeat; image-rendering: pixelated; }
.panel::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-style: solid;
  border-width: 60px 64px 60px 64px;
  border-image: url(U/frame-panel.png) 30 32 30 32 / 60px 64px 60px 64px round; image-rendering: pixelated; }
```

The cards and slots work the same way; slots use `fill-worn.png` at 384px. A frame cannot be smaller than its slices:
frame-panel's minimum is 64 x 60 art px (128 x 120 CSS).

**Plate or button.** The height is fixed at `size[1] x S`, and the states swap `border-image-source`:

```css
.btn { box-sizing: border-box; height: 68px; display: inline-flex; align-items: center; justify-content: center;
  border-style: solid; border-width: 16px 40px;
  border-image: url(U/button-copper.png) 8 20 8 20 fill / 16px 40px round stretch; image-rendering: pixelated; }
.btn:hover, .btn:focus-visible { border-image-source: url(U/button-copper-hot.png); }
.btn:active { border-image-source: url(U/button-copper-pressed.png); }
```

The cut-in band is used the same way (`8 18 8 18`, 72px tall). Its period is long, 115 art px, so it reads best at
least about 150 art px wide.

**Divider.** A flex row of five parts: `divider-cap-left`, then a `flex: 1` div with
`background: url(U/divider-line.png) 0 0 / 20px 22px repeat-x`, then `divider-diamond`, then the same line div, then
`divider-cap-right`. The images are 22px tall. For a fixed width, use `divider.png` whole.

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

1. **Generate.** gpt-image-2 (ElevenLabs flow `dm0rRnzJZIFo7p38WDLO`) made seven 2K sheets at high quality. Each sheet
   has every piece isolated on flat `#FF00FF` magenta, apart from the textures sheet, which is a 2 x 2 grid of
   edge-to-edge swatches.
   - **References** are the approved target screens. Lobby `0fOkpcA4ZvRsW7F1ns9k`, results `Pi9vnoi2yw5BKHQPvhwb`,
     pause `FGlICm3jtixaiDJYHRCO`, connect `xpgJxgixB4i03KwFIlK7` and HUD `pmQFQDbqr7u3Q1JAyqYK` are
     `UI/V1/ChatGPT Image Oct 4, 2026 ...`. The arena backdrop, `public/assets/arena/foundry-backdrop.png`, is
     `hDbkWpZwlMeQkhzhzu3D`.
   - **Prompt rules:**
     - Ask for each art pixel to be about 4 image pixels.
     - Ask for blank faces: text is added by the game.
     - Keep every glow inside its piece's outline, because a halo on the magenta cannot be keyed.
     - Edges that will repeat must be "plain and uniform along their whole length".
2. **Key.** Each pixel gets a magenta-ness: high and balanced red and blue, with low green. An anti-aliased fringe is
   decontaminated (the key colour is un-mixed), not just cut.
3. **Cut.** Each piece's loose rectangle is tightened to its drawn pixels, then area-downsampled to art pixels.
   - The downsample is a box filter with fractional footprints, weighted by coverage so the key never tints an edge.
   - The factor (source px per art px) or exact size is chosen per piece, so the piece is the right size at the one
     display scale. A panel is cut at 5, a card at 4, word art at 3, the gear crest at 9, and a bead at exactly 11 x 11.
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
     filled centre and fixed height. The centre slice is exactly one period, so CSS `round` tiles whole periods.
   - Plate states are forced to the normal state's period, so hover and press never shift the pattern.
   - Judging only the seam was not enough: on the panel, it picked a stretch near a corner that held two unevenly
     spaced rivets, so a long edge showed rivets in pairs.
5. **Tiles.**
   - The fills are cropped opaque, then made seamless by cross-fading a wrap margin (`seamlessTile`), then flattened.
     Flattening divides out the sheet's broad lighting with a wrapping box blur; otherwise the gradient striped the
     panel once tiled. Both fills are 192 art px wide, so a panel interior shows little repetition. fill-iron is 101
     tall: one rivet row per tile.
   - The text textures repeat only across, and are lifted (gamma and gain: copper 0.75 x 1.15, iron 0.6 x 1.4). As
     generated, they were shaded for a plate and too dark to read as lettering on dark iron.
   - The divider line and the chain are the most periodic strip of their piece.
6. **Check.**
   - Each frame was stretched to three sizes, and each button state to three widths, with `nineSlice` (zoomed contact
     sheets).
   - The preview page shows everything through the real CSS, over the game's backdrop:
     `verify-out/ui-kit/preview-frames.png`, `-buttons`, `-divider`, `-ornaments`, `-words`, `-type`, `-fills`.

## Spend

The seven sheets cost 17,320 credits, $3.80 at gpt-image-2 high, 2K, one generation each. No re-generation was needed.
Every later fix (rivet period, tile width, lighting, text lift) was a rebuild from the same sources.

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
