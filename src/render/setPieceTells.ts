import type { AuthoredLight, PlacedPrefab } from '@/core/types';

/**
 * FAR TELLS FOR SET PIECES (levels review #15). A floor's ruin galleries, brazier
 * shrines, machines and flora rooms sat in the rock as thin tubes that read as
 * nothing from a tunnel away: no marker, and nothing to say "something is built
 * here". Each gets one small lamp of the colour its own fixture would throw (coals
 * still warm in a shrine, a pilot lamp on a machine, glow-moss in a flora room),
 * seeded through the same shadow-casting authored-light path the Builder's lights
 * use, so the glow leaks out of the room exactly as far as the room is open.
 *
 * Deliberately NOT tells: the light puzzles and glass galleries (their subject is
 * the dark), and encounter lairs (a glow there would be bait). Cheap: one light
 * per piece (8-12 a floor), derived from data every level already carries
 * (`placedPrefabs`), so a resumed floor has them too.
 */

interface TellSpec {
  rgb: readonly [number, number, number];
  intensity: number;
  radius: number;
  flicker: number;
  bloom: number;
}

/** First matching rule wins. */
const TELLS: ReadonlyArray<{ match: (id: string) => boolean; spec: TellSpec }> = [
  // Coals still warm in an unlit shrine.
  { match: (id) => id === 'builtin-brazier-shrine', spec: { rgb: [1, 0.55, 0.2], intensity: 1.0, radius: 38, flicker: 0.5, bloom: 0.5 } },
  // A pilot lamp on a machine: steadier, amber.
  { match: (id) => id.startsWith('machine-'), spec: { rgb: [1, 0.72, 0.28], intensity: 1.1, radius: 40, flicker: 0.12, bloom: 0.5 } },
  // Cold brass light through a ruin's broken roof.
  { match: (id) => id === 'builtin-ruin-gallery', spec: { rgb: [0.5, 0.68, 1], intensity: 0.8, radius: 44, flicker: 0.1, bloom: 0.3 } },
  // A vault's brass fittings catching a little light.
  { match: (id) => id === 'builtin-plate-vault', spec: { rgb: [1, 0.85, 0.42], intensity: 0.75, radius: 34, flicker: 0.05, bloom: 0.3 } },
  // Glow-moss in a flora room.
  { match: (id) => id.startsWith('flora-'), spec: { rgb: [0.3, 0.92, 0.42], intensity: 0.8, radius: 38, flicker: 0.2, bloom: 0.3 } },
  // Rime-light in the Cold Store's rooms.
  { match: (id) => id.startsWith('cold-'), spec: { rgb: [0.55, 0.88, 1], intensity: 0.8, radius: 38, flicker: 0.08, bloom: 0.3 } },
];

/** The spec a piece's id earns, or null when it carries no tell. */
export function tellSpecFor(id: string): TellSpec | null {
  for (const rule of TELLS) if (rule.match(id)) return rule.spec;
  return null;
}

/**
 * The open cell nearest (cx, cy) inside a piece's box (a lamp seeded in rock is
 * absorbed at once, and a machine room is a thin tube in solid stone), or null.
 */
function openSpot(p: PlacedPrefab, cx: number, cy: number, open: (x: number, y: number) => boolean): { x: number; y: number } | null {
  const reach = Math.max(p.x1 - p.x0, p.y1 - p.y0);
  for (let r = 0; r <= reach; r += 2) {
    for (let a = 0; a < 360; a += r === 0 ? 360 : Math.max(10, Math.round(400 / r))) {
      const x = Math.round(cx + Math.cos((a * Math.PI) / 180) * r);
      const y = Math.round(cy + Math.sin((a * Math.PI) / 180) * r);
      if (x < p.x0 || x > p.x1 || y < p.y0 || y > p.y1) continue;
      // Room for the seed's four neighbours too.
      if (open(x, y) && open(x - 2, y) && open(x + 2, y) && open(x, y - 2) && open(x, y + 2)) return { x, y };
    }
  }
  return null;
}

/**
 * One lamp per tell-bearing piece, in the level's cells, aimed at the piece's focus
 * (or a little above its middle) and moved to the nearest open cell inside it when
 * `open` is given; a piece with no open cell gets no lamp.
 */
export function setPieceTellLights(
  prefabs: readonly PlacedPrefab[] | undefined,
  open?: (x: number, y: number) => boolean,
): AuthoredLight[] {
  const out: AuthoredLight[] = [];
  if (!prefabs) return out;
  prefabs.forEach((p, n) => {
    const spec = tellSpecFor(p.id);
    if (!spec) return;
    let x = p.focus ? p.focus.x : Math.floor((p.x0 + p.x1) / 2);
    let y = p.focus ? p.focus.y - 6 : Math.floor(p.y0 + (p.y1 - p.y0) * 0.4);
    if (open) {
      const spot = openSpot(p, x, y, open);
      if (!spot) return;
      x = spot.x;
      y = spot.y;
    }
    out.push({
      x,
      y,
      r: spec.rgb[0],
      g: spec.rgb[1],
      b: spec.rgb[2],
      intensity: spec.intensity,
      radius: spec.radius,
      bloom: spec.bloom,
      flicker: spec.flicker,
      flickerPhase: (n * 2.39996) % (Math.PI * 2),
      falloff: 'soft',
      occluded: true,
    });
  });
  return out;
}

const CACHE = new WeakMap<object, AuthoredLight[]>();

/**
 * The level's tell lamps, worked out once per prefab list (the light build and the
 * composer both read them every frame) with the world's open cells as they stand
 * the first time the level is drawn.
 */
export function cachedSetPieceTells(
  prefabs: readonly PlacedPrefab[] | undefined,
  world: { width: number; height: number; types: Uint8Array },
  blocks: (cell: number) => boolean,
): readonly AuthoredLight[] {
  if (!prefabs) return [];
  const hit = CACHE.get(prefabs);
  if (hit) return hit;
  const { width: W, height: H, types } = world;
  const lights = setPieceTellLights(prefabs, (x, y) => x > 0 && y > 0 && x < W && y < H && !blocks(types[x + y * W]));
  CACHE.set(prefabs, lights);
  return lights;
}
