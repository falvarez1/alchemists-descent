# Stage art prompts (gpt-image-2)

Provenance for `public/assets/arena/<stage>/` art. Sources kept in `stage-sources/`.

## The Foundry

Backdrop (edit of concepts/foundry-match.png, 16:9, 2K, high):

Edit this pixel-art game concept into a clean BACKGROUND PLATE for the same stage, to be used behind live gameplay.

Change: remove every gameplay element: the large central platform with the gear-and-flask emblem, the two small floating platforms on the left and right, every lantern hanging under those platforms, all four characters and their magic and fire trails, the timer at the top centre, and the three player cards along the bottom. Fill every removed area with the background architecture that stands behind it, continuing the same structures seamlessly: the central furnace tower with its glowing molten amber windows and lava light, the arched aqueduct bridges and walkways, the misty waterfalls, distant pillars, pipes and hanging chains.

Preserve: the exact pixel-art style, palette and lighting (deep slate blue and steel, warm amber furnace glow, teal accents); the tall hanging banner at the left reading THE FOUNDRY with its gear emblem; the banner at the right reading METAL PEOPLE BRIGHTER TOMORROW; the small wall plaques; the hanging chains along the top edge; the pillars and pipework framing the left and right edges; the overall composition with the furnace tower centred.

The lower third of the image becomes a deep misty abyss below the stage, darkening toward near-black at the bottom edge, with faint distant structures. Constraints: nothing in the middle of the image may look like a walkable floor or platform; no characters; no UI; no new text beyond the existing banner lettering.

Main platform (references foundry-match.png, camera-direction.png; custom 3840 x 1280, high):

Game asset for a 2D side-view pixel-art platform fighter: the MAIN STAGE PLATFORM of "The Foundry", isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the large central platform in the reference images (the first is the primary target). A long floating platform of dark riveted iron plates with a bright worn-copper top edge lit amber; beneath it a deep inverted-arch undercarriage of dark iron girders with brass rivets and bolted brackets; a large circular brass gear medallion with an alchemist's flask symbol at the centre of the undercarriage; short hanging chains at both ends; two teal glass lanterns hanging on short chains beneath the platform at one quarter and three quarters of its length.

Proportions: make the platform much LONGER than in the reference. It runs from 2% to 98% of the image width with finished end caps at both ends. The top walking surface is perfectly flat and horizontal, at about 6% from the top of the image, and is the brightest edge. The riveted deck band is about 7% of the image height thick. The undercarriage deepens toward the centre: about 30% of the image height at the ends and reaching about 72% of the image height at the medallion. The hanging lanterns end at about 90%. Perfectly symmetric left to right.

Rendering: exactly the same pixel-art style, palette and detail density as the reference platform: crisp square pixels, dark outlines, slate iron (#2a3440) bodies, worn copper (#ac744b) trim and rivets, an amber (#efac58) lit top edge, teal (#65cac5) lantern glass. Repeat the plate, rivet and girder rhythm along the extra length; keep one medallion only, at the centre.

Nothing else: no characters, no background scenery, no sky, no text, no drop shadows on the background, no glow haze outside the object. Only the platform and its hangings on flat magenta.

Side platform (same references; custom 3072 x 1024, high):

Game asset for a 2D side-view pixel-art platform fighter: one RAISED SIDE PLATFORM of "The Foundry", isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the two small floating platforms in the reference images (upper left and upper right of the first image). A floating beam of dark riveted iron with a bright worn-copper top edge lit amber, bolted corner caps at both ends, and beneath it a compact triangular truss bracket of dark iron girders with brass rivets, with one teal glass lantern hanging on a short chain from the centre of the underside.

Proportions: the platform runs from 3% to 97% of the image width with finished end caps. Its top walking surface is perfectly flat and horizontal, at about 20% from the top of the image, and is the brightest edge. The riveted beam is about 12% of the image height thick. The truss bracket below it is narrower than the beam (about the middle 60% of its length) and reaches down to about 50% of the image height. The hanging lantern ends at about 82%. Perfectly symmetric left to right.

Rendering: exactly the same pixel-art style, palette and detail density as the reference: crisp square pixels, dark outlines, slate iron (#2a3440), worn copper (#ac744b) trim and rivets, an amber (#efac58) lit top edge, teal (#65cac5) lantern glass.

Nothing else: no characters, no background, no text, no drop shadows, no glow haze outside the object. Only the platform and its lantern on flat magenta.

## The Kiln, the Cistern, the Gallery: shared notes

References: each stage's own quadrant of concepts/stages.png, cropped (Kiln x 847..1672 y 0..462, Cistern x 0..825
y 478..940, Gallery x 847..1672 y 478..940) and upscaled 2x as the primary reference; foundry-match.png for the backdrops'
in-match framing; the Foundry's chosen main/side renders (stage-sources/foundry-main.webp, foundry-side.webp) as the
layout reference for the platforms. Bakes: `--glass none` for the Kiln and the Gallery (their lamps are warm or violet,
and Glowshroom glass glows teal), default teal glass for the Cistern.

## The Kiln

Sources: kiln-backdrop.webp, kiln-main.webp (`--width 440 --glass none`), kiln-side.webp (`--width 150 --glass none`).

Backdrop (edit of the Kiln quadrant + foundry-match.png, 16:9, 2K, high):

Edit the first image, a pixel-art game concept of the stage "The Kiln", into a clean BACKGROUND PLATE for the same stage, to be used behind live gameplay. The second image only shows how the finished game frames a stage behind the action: match its calm, receding depth and pixel density, NOT its colours or buildings.

Change: remove every gameplay element: the floating central platform with its iron girder undercarriage, the two brick-and-iron ledges at the left and right with their truss brackets, the small pale running figure, and the title text "THE KILN" with its ornament in the top-left corner. Fill every removed area with the background architecture that stands behind it, continuing the same structures seamlessly: the central brick kiln tower with its molten vertical windows and the lava pouring down its face, the pipes looping out of the tower, the side towers with their glowing slit windows, the crane arms with iron crucibles hanging on long chains, the arched viaduct crossing the middle distance.

Preserve: the exact pixel-art style, palette and lighting (charred dark brick and blackened iron, ember orange and molten amber light, a deep red-brown smoky haze); the hanging crucibles on their chains; the tall banner with the alchemical emblem at the right; the dark brick pillars framing the left and right edges; the kiln tower centred.

Push the middle distance back with a little smoky haze so the plate stays calm behind the fighters: the brightest things are the tower's molten windows and the lava, everything else dim. The lower third of the image becomes a deep pit below the stage: the lava sea glowing far below, distant and partly veiled in smoke, darkening toward near-black at the bottom edge. Constraints: nothing in the middle of the image may look like a walkable floor or platform (the viaduct reads as a distant bridge far behind); no characters; no UI; no text or lettering anywhere.

Main platform (Kiln quadrant + foundry-main; custom 3840 x 1280, high):

Game asset for a 2D side-view pixel-art platform fighter: the MAIN STAGE PLATFORM of "The Kiln", isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the floating central platform in the first reference image (The Kiln). A long floating platform: a deck of blackened riveted iron plates over a course of charred dark brick, with a bright ember-lit top edge glowing orange; a dull brass band along the deck with a small riveted boss at its centre; beneath it an inverted-trapezoid undercarriage of blackened iron girders in an X-truss pattern with brass rivets, ending in short downward iron spikes. Two hanging fire-lamps (small black iron cages with glowing orange-yellow fire glass) hang below the undercarriage at one quarter and three quarters of its length, each on its own thin chain with a clear gap of magenta between the lamp and the undercarriage. Short thin chains hang at both ends.

The second reference image is a finished asset from the same game: match its layout, proportions, framing, pixel scale and finish, but NOT its materials: no gear, no flask, no medallion, no teal glass.

Proportions: the platform runs from 2% to 98% of the image width with finished end caps at both ends. The top walking surface is perfectly flat and horizontal, at about 6% from the top of the image, and is the brightest edge. The iron-and-brick deck band is about 9% of the image height thick. The undercarriage is about 25% of the image height deep at the ends and deepens toward the centre to about 60%. The fire-lamps end at about 88%. Perfectly symmetric left to right.

Rendering: exactly the same pixel-art style, palette and detail density as the Kiln reference: crisp square pixels, dark outlines, blackened iron (#2b2826) and charred brick (#3d2a26) bodies, dull brass (#a07a3c) bands and rivets, an ember-orange (#f0903c) lit top edge, glowing orange-yellow (#ffb347) lamp glass. Repeat the plate, brick and truss rhythm along the length.

Nothing else: no characters, no background scenery, no lava, no sky, no text, no drop shadows on the background, no glow haze outside the object. Only the platform and its hangings on flat magenta.

Side ledge (Kiln quadrant + foundry-side; custom 3072 x 1024, high):

Game asset for a 2D side-view pixel-art platform fighter: one RAISED SIDE LEDGE of "The Kiln", isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the two brick-and-iron ledges at the left and right edges of the first reference image (The Kiln), made free-standing: a floating beam of blackened riveted iron over a course of charred dark brick, a bright ember-lit top edge glowing orange, bolted brass corner caps at both ends; beneath it a compact iron truss bracket with brass rivets; one hanging fire-lamp (a small black iron cage with glowing orange-yellow fire glass) hangs from the centre of the underside on a thin chain, with a clear gap of magenta between the lamp and the bracket.

The second reference image is a finished asset from the same game: match its layout, proportions, framing, pixel scale and finish, but NOT its materials: no teal glass.

Proportions: the ledge runs from 3% to 97% of the image width with finished end caps. Its top walking surface is perfectly flat and horizontal, at about 20% from the top of the image, and is the brightest edge. The iron-and-brick beam is about 13% of the image height thick. The truss bracket below it is narrower than the beam (about the middle 60% of its length) and reaches down to about 48% of the image height. The hanging lamp ends at about 82%. Perfectly symmetric left to right.

Rendering: exactly the same pixel-art style, palette and detail density as the Kiln reference: crisp square pixels, dark outlines, blackened iron (#2b2826), charred brick (#3d2a26), dull brass (#a07a3c) caps and rivets, an ember-orange (#f0903c) lit top edge, glowing orange-yellow (#ffb347) lamp glass.

Nothing else: no characters, no background, no wall or pillar behind it, no text, no drop shadows, no glow haze outside the object. Only the ledge and its lamp on flat magenta.

## The Cistern

Sources: cistern-backdrop.webp, cistern-main.webp (`--width 460`), cistern-side.webp (`--width 160`). The published
backdrop.webp is the source cropped to x 160..1797, y 0..921 and scaled back to 2048 x 1152 (lanczos3): that lowers the
water surface from 62% to 78% of the plate, below the main deck (the deck sits near 67% of the plate in every framing).

Backdrop (edit of the Cistern quadrant + foundry-match.png, 16:9, 2K, high):

Edit the first image, a pixel-art game concept of the stage "The Cistern", into a clean BACKGROUND PLATE for the same stage, to be used behind live gameplay. The second image only shows how the finished game frames a stage behind the action: match its calm, receding depth and pixel density, NOT its colours or buildings.

Change: remove every gameplay element: the central brass walkway platform with its ship's-wheel medallion and undercarriage, the two brass-railed walkways at the left and right edges with the water pouring off them, the small pale running figure, and the title text "THE CISTERN" with its droplet ornament in the top-left corner. Fill every removed area with the background architecture that stands behind it, continuing the same structures seamlessly: the central wheel tower with its big brass ship's wheel and the waterfall pouring from beneath it, the tall glass specimen tanks with dim creatures and plants in green-teal water, the brass pipes, iron arches and hanging chains, the railed gallery in the middle distance. The two outer waterfalls now pour from large brass pipe outlets in the back wall.

Preserve: the exact pixel-art style, palette and lighting (deep teal and blue-green water light, dark iron, worn brass, moss); the specimen tanks; the wheel tower and its waterfall centred; the pipework and stone columns framing the left and right edges.

Push the middle distance back with a little misty haze so the plate stays calm behind the fighters: the brightest things are the waterfalls and the glowing tanks, everything else dim. The lower third of the image becomes a deep flooded pit below the stage: dark water far below with the waterfalls falling into it and submerged pipe arches, darkening toward near-black at the bottom edge. Constraints: nothing in the middle of the image may look like a walkable floor or platform; no characters; no UI; no text or lettering anywhere.

Main platform (Cistern quadrant + foundry-main; custom 3840 x 1280, high):

Game asset for a 2D side-view pixel-art platform fighter: the MAIN STAGE PLATFORM of "The Cistern", isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the central brass walkway platform in the first reference image (The Cistern). A long floating walkway: a deck of riveted brass-trimmed dark iron plates with a bright worn-brass top edge; beneath it a shallow inverted-arch undercarriage of dark teal-grey iron girders and brass brackets, with short pipe stubs and bolted valves; a large round brass ship's-wheel medallion with spokes at the centre of the undercarriage; a little green moss on the girders. Two teal glass lamps (small brass-capped lanterns with glowing teal glass) hang below the undercarriage at one quarter and three quarters of its length, each on its own thin chain with a clear gap of magenta between the lamp and the undercarriage. Short thin chains hang at both ends.

The second reference image is a finished asset from the same game: match its layout, proportions, framing, pixel scale and finish, but use the Cistern's own materials and the ship's wheel instead of its gear-and-flask.

Proportions: the platform runs from 2% to 98% of the image width with finished end caps at both ends. The top walking surface is perfectly flat and horizontal, at about 6% from the top of the image, and is the brightest edge. The riveted deck band is about 8% of the image height thick. The undercarriage is about 25% of the image height deep at the ends and deepens toward the centre to about 62% at the wheel. The lamps end at about 88%. Perfectly symmetric left to right. No water anywhere on or under the platform.

Rendering: exactly the same pixel-art style, palette and detail density as the Cistern reference: crisp square pixels, dark outlines, dark teal-grey iron (#25333a) bodies, worn brass (#b08a45) trim, rivets and wheel, a bright brass (#e8c070) lit top edge, moss green (#5b7a3a) accents, glowing teal (#65cac5) lamp glass. Repeat the plate, rivet and girder rhythm along the length; one ship's wheel only, at the centre.

Nothing else: no characters, no background scenery, no water, no sky, no text, no drop shadows on the background, no glow haze outside the object. Only the platform and its hangings on flat magenta.

Side walkway (Cistern quadrant + foundry-side; custom 3072 x 1024, high):

Game asset for a 2D side-view pixel-art platform fighter: one RAISED SIDE WALKWAY of "The Cistern", isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the brass-railed walkways at the left and right edges of the first reference image (The Cistern), made free-standing and without their railings: a floating walkway beam of riveted brass-trimmed dark iron with a bright worn-brass top edge, bolted brass corner caps at both ends; beneath it a compact bracket of dark teal-grey iron girders with brass rivets, a short pipe stub and a little green moss; one teal glass lamp (a small brass-capped lantern with glowing teal glass) hangs from the centre of the underside on a thin chain, with a clear gap of magenta between the lamp and the bracket.

The second reference image is a finished asset from the same game: match its layout, proportions, framing, pixel scale and finish, with the Cistern's own materials.

Proportions: the walkway runs from 3% to 97% of the image width with finished end caps. Its top walking surface is perfectly flat and horizontal, at about 20% from the top of the image, and is the brightest edge. The riveted beam is about 12% of the image height thick. The bracket below it is narrower than the beam (about the middle 60% of its length) and reaches down to about 48% of the image height. The hanging lamp ends at about 82%. Perfectly symmetric left to right. No railing on top, no water anywhere.

Rendering: exactly the same pixel-art style, palette and detail density as the Cistern reference: crisp square pixels, dark outlines, dark teal-grey iron (#25333a), worn brass (#b08a45) trim and rivets, a bright brass (#e8c070) lit top edge, moss green (#5b7a3a) accents, glowing teal (#65cac5) lamp glass.

Nothing else: no characters, no background, no wall or column behind it, no text, no drop shadows, no glow haze outside the object. Only the walkway and its lamp on flat magenta.

## The Gallery

Sources: gallery-backdrop.webp, gallery-main.webp (`--width 440 --glass none`; of two renders, the one whose banner
hangs on cords below a rod, so the bake keeps it out of the hull), gallery-side.webp (`--width 130 --glass none`),
gallery-top.webp (`--width 120 --glass none`).

Backdrop (edit of the Gallery quadrant + foundry-match.png, 16:9, 2K, high):

Edit the first image, a pixel-art game concept of the stage "The Gallery", into a clean BACKGROUND PLATE for the same stage, to be used behind live gameplay. The second image only shows how the finished game frames a stage behind the action: match its calm, receding depth and pixel density, NOT its colours or buildings.

Change: remove every gameplay element: the pale stone central platform with its hanging banner and vines, the stone ledge with a brass bracket at the upper left, the small stone ledge at the lower left, the stone ledge with a brass bracket at the upper right, the stone ledge on brass scaffolding at the lower right, the small pale running figure, and the title text "THE GALLERY" with its ornament in the top-left corner. Fill every removed area with the background architecture that stands behind it, continuing the same structures seamlessly: the tall gothic library shelves full of old books, the pale stone columns and arches, the tall pointed gothic windows glowing with violet light, the stone statue holding up an astrolabe ring, the glass bell jars with plants hanging on chains, the brass pipes and the ivy.

Preserve: the exact pixel-art style, palette and lighting (purple dusk light, pale grey stone, dark wood shelves, worn brass, moss green, soft violet glow); the hanging bell jars; the statue right of centre; the stone columns with ivy framing the left and right edges.

Push the middle distance back with a little violet haze so the plate stays calm behind the fighters: the brightest things are the gothic windows and the bell jars, everything else dim. The lower third of the image becomes a deep shadowed drop below the stage: the shelves, arches and pipes descending into a dim purple-black depth, darkening toward near-black at the bottom edge. Constraints: nothing in the middle of the image may look like a walkable floor or platform; no characters; no UI; no text or lettering anywhere.

Main platform (Gallery quadrant + foundry-main; custom 3840 x 1280, high):

Game asset for a 2D side-view pixel-art platform fighter: the MAIN STAGE PLATFORM of "The Gallery", isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the pale stone central platform in the first reference image (The Gallery). A long floating slab of pale carved grey stone blocks with a thin gilt edge along the top; beneath it an ornate undercarriage of carved stone corbels and dark wood beams held by curled gilt-brass brackets, deepening toward the centre; a few strands of green ivy hanging from the underside. A heraldic banner (deep violet-black cloth with a gold tree emblem and a gold fringe) hangs from a thin brass rod below the centre on two thin cords, with a clear gap of magenta between the rod and the stone. Two small brass lanterns with warm amber glass hang below the undercarriage at one quarter and three quarters of its length, each on its own thin chain with a clear gap of magenta between the lantern and the stone.

The second reference image is a finished asset from the same game: match its layout, proportions, framing, pixel scale and finish, but use the Gallery's own materials: pale stone and gilt, no gear, no flask, no iron plates.

Proportions: the platform runs from 2% to 98% of the image width with finished end caps at both ends. The top walking surface is perfectly flat and horizontal, at about 6% from the top of the image, and is the brightest edge. The stone slab is about 9% of the image height thick. The undercarriage is about 20% of the image height deep at the ends and deepens toward the centre to about 45%. The banner hangs below it and ends at about 85%; the lanterns end at about 75%; the ivy strands are thin and short. Perfectly symmetric left to right.

Rendering: exactly the same pixel-art style, palette and detail density as the Gallery reference: crisp square pixels, dark outlines, pale stone (#b8b4b0 with #8c8790 shadows), dark wood (#3a2c2a), gilt brass (#c8a050) brackets and edge, moss green (#6a8a3a) ivy, deep violet (#2c2440) banner cloth with gold (#d8b060) emblem, warm amber (#ffc070) lantern glass. Repeat the stone block and bracket rhythm along the length; one banner only, at the centre.

Nothing else: no characters, no background scenery, no shelves, no sky, no text, no drop shadows on the background, no glow haze outside the object. Only the platform and its hangings on flat magenta.

Side ledge (Gallery quadrant + foundry-side; custom 3072 x 1024, high):

Game asset for a 2D side-view pixel-art platform fighter: one RAISED SIDE LEDGE of "The Gallery", isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the pale stone ledge with a gilt-brass bracket at the upper right of the first reference image (The Gallery), made free-standing: a floating slab of pale carved grey stone blocks with a thin gilt edge along the top, finished stone end caps at both ends; beneath it a compact curled gilt-brass bracket with a small dark wood beam; a few thin strands of green ivy trailing from one end; one small brass lantern with warm amber glass hanging from the centre of the underside on a thin chain, with a clear gap of magenta between the lantern and the bracket.

The second reference image is a finished asset from the same game: match its layout, proportions, framing, pixel scale and finish, with the Gallery's own materials (pale stone and gilt, no iron, no teal glass).

Proportions: the ledge runs from 3% to 97% of the image width with finished end caps. Its top walking surface is perfectly flat and horizontal, at about 20% from the top of the image, and is the brightest edge. The stone slab is about 12% of the image height thick. The bracket below it is narrower than the slab (about the middle 60% of its length) and reaches down to about 46% of the image height. The hanging lantern ends at about 80%. Symmetric left to right apart from the ivy.

Rendering: exactly the same pixel-art style, palette and detail density as the Gallery reference: crisp square pixels, dark outlines, pale stone (#b8b4b0 with #8c8790 shadows), dark wood (#3a2c2a), gilt brass (#c8a050), moss green (#6a8a3a) ivy, warm amber (#ffc070) lantern glass.

Nothing else: no characters, no background, no column or wall behind it, no flowers, no text, no drop shadows, no glow haze outside the object. Only the ledge and its hangings on flat magenta.

Top perch (Gallery quadrant + foundry-side; custom 3072 x 1024, high):

Game asset for a 2D side-view pixel-art platform fighter: the small TOP PLATFORM of "The Gallery", the highest perch at the centre of the stage, isolated on a flat, pure magenta (#FF00FF) background. Strict side view, orthographic, no perspective.

Design target: the pale stone ledges of the first reference image (The Gallery), made into a free-floating perch: a slab of pale carved grey stone blocks with a thin gilt edge along the top and a carved stone keystone at the centre of its front face, finished stone end caps at both ends; beneath it a symmetric pair of curled gilt-brass brackets meeting under the centre; one glass bell jar lamp (a small brass-capped glass dome with a soft violet glow and a tiny plant inside) hanging from the centre of the underside on a thin chain, with a clear gap of magenta between the lamp and the brackets.

The second reference image is a finished asset from the same game: match its layout, proportions, framing, pixel scale and finish, with the Gallery's own materials (pale stone and gilt, no iron, no teal glass).

Proportions: the perch runs from 3% to 97% of the image width with finished end caps. Its top walking surface is perfectly flat and horizontal, at about 20% from the top of the image, and is the brightest edge. The stone slab is about 12% of the image height thick. The brackets below it are narrower than the slab (about the middle 50% of its length) and reach down to about 44% of the image height. The hanging bell jar ends at about 82%. Perfectly symmetric left to right.

Rendering: exactly the same pixel-art style, palette and detail density as the Gallery reference: crisp square pixels, dark outlines, pale stone (#b8b4b0 with #8c8790 shadows), gilt brass (#c8a050), soft violet (#b49ae8) bell-jar glass, a little moss green (#6a8a3a).

Nothing else: no characters, no background, no text, no drop shadows, no glow haze outside the object. Only the perch and its lamp on flat magenta.
