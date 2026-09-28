import type { Ctx } from '@/core/types';
import type { StoryFigureView } from '@/core/story';
import type { Skeleton, V } from '@/entities/playerPose';
import { makeSkeleton } from '@/entities/playerPose';
import type { LightField, PixelSurface } from '@/render/pixels';
import { material, type CreatureMaterial } from '@/render/creatures/palette';
import { blankLight, sampleSceneLight, sharedRaster, type CreatureRaster } from '@/render/creatures/raster';
import { figureScale, poseFigure } from './figurePose';

/**
 * The STORY FIGURES, drawn (wave 3 WS-S): Pell and the echoes' Guild workers,
 * on the creature rasterizer the alchemist uses — lit volumes, a sel-out
 * outline, the same skeleton. Each costume is a silhouette you can read at a
 * glance: Pell's long olive coat, red scarf, soft cap and the map case on his
 * back; the workers' overalls and flat caps; the foreman's bowler; the
 * Docent's frock coat and tall hat; the first stoker, an iron automaton with
 * a furnace door glowing in its chest.
 *
 * GHOSTS (the echoes) wear the same shapes in memory's colour: a pale
 * green-glass ramp, translucent (the cave shows through), self-lit, no dark
 * outline — at five fade levels so an echo can surface and dissolve.
 */

// Material slots (1-based in the raster).
const COAT = 1, COAT_D = 2, TROUSER = 3, BOOT = 4, SKIN = 5, HAIR = 6, HAT = 7, SCARF = 8, LEATHER = 9, BRASS = 10,
  PAPER = 11, WOOD = 12, IRON = 13, FURNACE = 14, GLASS = 15, EYE = 16, SHIRT = 17, APRON = 18, GLINT = 19, CRATE = 20;

type Palette = Partial<Record<number, CreatureMaterial>>;

const BASE: Palette = {
  [SKIN]: material({ keys: [0x3a1c12, 0x7a432c, 0xb86e4c, 0xe39c72, 0xfbc89c], gloss: 0.15, rim: 0.6, outline: 0x160a06 }),
  [HAIR]: material({ keys: [0x0a0806, 0x1c1610, 0x33291c, 0x4e4030], gloss: 0.3, rim: 0.5, outline: 0x040302 }),
  [BOOT]: material({ keys: [0x050404, 0x120e0c, 0x241c16, 0x3a2e24], gloss: 0.5, shine: 20, rim: 0.5, outline: 0x020101 }),
  [LEATHER]: material({ keys: [0x120a0e, 0x2a181c, 0x482b28, 0x6d4535, 0x9a6b4a], gloss: 0.25, rim: 0.6, outline: 0x060304 }),
  [BRASS]: material({ keys: [0x3a1806, 0x8a4816, 0xd07a2a, 0xffb55a, 0xffe6a8], gloss: 0.8, shine: 22, rim: 0.7, outline: 0x140802 }),
  [PAPER]: material({ keys: [0x5a5240, 0x9a8e6c, 0xcfc29c, 0xefe4c4, 0xfff8e4], gloss: 0.05, rim: 0.5, outline: 0x241e14 }),
  [WOOD]: material({ keys: [0x140c06, 0x34200e, 0x5c3a1c, 0x86592e], gloss: 0.3, rim: 0.6, outline: 0x060403 }),
  [IRON]: material({ keys: [0x100c0a, 0x2a221e, 0x463a32, 0x6a5a4c, 0x94826e], gloss: 0.55, shine: 18, rim: 0.7, outline: 0x060403 }),
  [FURNACE]: material({ keys: [0x6a1a00, 0xe05a08, 0xffb030, 0xfff2b0], emissive: 1, glow: 0x7a2a04, glowK: 1.1 }),
  [GLASS]: material({ keys: [0x24343a, 0x5a7a82, 0xb0d4dc, 0xf0ffff], translucent: 0.45, gloss: 1, shine: 30, rim: 1, outline: 0x0a1418 }),
  [EYE]: material({ keys: [0x010101, 0x07090a, 0x101418], gloss: 1, shine: 40 }),
  [GLINT]: material({ keys: [0xf4f0e0, 0xffffff], emissive: 1 }),
  [SHIRT]: material({ keys: [0x3a3830, 0x6a665a, 0x9e9888, 0xcfc8b4], gloss: 0.1, rim: 0.6, outline: 0x141310 }),
  [APRON]: material({ keys: [0x1a100a, 0x3a2414, 0x5e3c22, 0x86603a], gloss: 0.35, rim: 0.6, outline: 0x080503 }),
  [CRATE]: material({ keys: [0x1c120a, 0x3e2a16, 0x644626, 0x8e6a3c], gloss: 0.2, rim: 0.6, outline: 0x0a0604 }),
};

interface Costume {
  mats: CreatureMaterial[];
  hat: 'cap' | 'flatcap' | 'bowler' | 'tophat' | 'visor' | 'goggles' | 'stoker';
  longCoat: boolean;
  scarf: boolean;
  apron: boolean;
  mapCase: boolean;
  /** Carries the lantern pole in the free hand (Pell away from his camp). */
  pole: boolean;
  bulky: boolean;
}

function mats(over: Palette): CreatureMaterial[] {
  const out: CreatureMaterial[] = [];
  for (let i = 1; i <= CRATE; i++) out.push(over[i] ?? BASE[i] ?? BASE[SHIRT]!);
  return out;
}

const COSTUMES: Record<StoryFigureView['costume'], Omit<Costume, 'pole'>> = {
  surveyor: {
    mats: mats({
      [COAT]: material({ keys: [0x14120a, 0x2c2616, 0x4a3f24, 0x6e5e36, 0x94804e], gloss: 0.12, rim: 0.8, outline: 0x060504 }),
      [COAT_D]: material({ keys: [0x0c0a06, 0x1e1a10, 0x332b1a, 0x4c4128], gloss: 0.1, rim: 0.7, outline: 0x060504 }),
      [TROUSER]: material({ keys: [0x0e0e10, 0x1e1e22, 0x323238, 0x4a4a52], gloss: 0.1, rim: 0.5, outline: 0x050506 }),
      [HAT]: material({ keys: [0x100e0c, 0x24201a, 0x3a342a, 0x585042], gloss: 0.1, rim: 0.6, outline: 0x050403 }),
      [SCARF]: material({ keys: [0x2a0c0a, 0x5a1a14, 0x8a2e22, 0xb44c36, 0xd8745a], gloss: 0.1, rim: 0.7, outline: 0x120404 }),
    }),
    hat: 'cap', longCoat: true, scarf: true, apron: false, mapCase: true, bulky: false,
  },
  worker: {
    mats: mats({
      [COAT]: material({ keys: [0x0a1018, 0x16243a, 0x283e5c, 0x40608a], gloss: 0.1, rim: 0.7, outline: 0x04060a }),
      [COAT_D]: material({ keys: [0x060a10, 0x101a2a, 0x1c2c44, 0x2c4462], gloss: 0.1, rim: 0.6, outline: 0x04060a }),
      [TROUSER]: material({ keys: [0x0a1018, 0x16243a, 0x283e5c, 0x40608a], gloss: 0.1, rim: 0.6, outline: 0x04060a }),
      [HAT]: material({ keys: [0x100e0c, 0x26221c, 0x3e382e, 0x5a5242], gloss: 0.1, rim: 0.6, outline: 0x050403 }),
    }),
    hat: 'flatcap', longCoat: false, scarf: false, apron: false, mapCase: false, bulky: false,
  },
  foreman: {
    mats: mats({
      [COAT]: material({ keys: [0x1a0e08, 0x3a2012, 0x5e3620, 0x86553a], gloss: 0.15, rim: 0.7, outline: 0x080402 }),
      [COAT_D]: material({ keys: [0x100804, 0x28160c, 0x422616, 0x5e3a24], gloss: 0.1, rim: 0.6, outline: 0x080402 }),
      [TROUSER]: material({ keys: [0x0c0c0c, 0x1e1e1c, 0x32302c, 0x4a4640], gloss: 0.1, rim: 0.5, outline: 0x040404 }),
      [HAT]: material({ keys: [0x040404, 0x0e0e0e, 0x1e1e1e, 0x323232], gloss: 0.5, shine: 20, rim: 0.6, outline: 0x020202 }),
    }),
    hat: 'bowler', longCoat: false, scarf: false, apron: false, mapCase: false, bulky: false,
  },
  docent: {
    mats: mats({
      [COAT]: material({ keys: [0x06080a, 0x10141a, 0x1c222c, 0x2e3644, 0x465262], gloss: 0.2, rim: 0.8, outline: 0x020304 }),
      [COAT_D]: material({ keys: [0x040506, 0x0a0c10, 0x141820, 0x20262e], gloss: 0.15, rim: 0.7, outline: 0x020304 }),
      [TROUSER]: material({ keys: [0x08080a, 0x141418, 0x222228, 0x34343c], gloss: 0.1, rim: 0.5, outline: 0x030303 }),
      [HAT]: material({ keys: [0x030303, 0x0c0c0e, 0x1a1a1e, 0x2e2e34], gloss: 0.6, shine: 24, rim: 0.6, outline: 0x010101 }),
      [HAIR]: material({ keys: [0x3a3632, 0x6e6860, 0xa49c90, 0xd8d0c4], gloss: 0.2, rim: 0.6, outline: 0x141210 }),
    }),
    hat: 'tophat', longCoat: true, scarf: false, apron: false, mapCase: false, bulky: false,
  },
  stoker: {
    mats: mats({ [COAT]: BASE[IRON]!, [COAT_D]: material({ keys: [0x0a0806, 0x1c1614, 0x302824, 0x483c34], gloss: 0.5, shine: 16, rim: 0.6, outline: 0x040302 }), [TROUSER]: BASE[IRON]!, [HAT]: BASE[IRON]! }),
    hat: 'stoker', longCoat: false, scarf: false, apron: false, mapCase: false, bulky: true,
  },
  clerk: {
    mats: mats({
      [COAT]: material({ keys: [0x14140f, 0x2c2c22, 0x464636, 0x66664e], gloss: 0.1, rim: 0.7, outline: 0x060604 }),
      [COAT_D]: material({ keys: [0x0c0c08, 0x1c1c16, 0x2e2e24, 0x44443a], gloss: 0.1, rim: 0.6, outline: 0x060604 }),
      [TROUSER]: material({ keys: [0x0e0e10, 0x1e1e22, 0x323238, 0x4a4a52], gloss: 0.1, rim: 0.5, outline: 0x050506 }),
      [HAT]: material({ keys: [0x0a2a1a, 0x14563a, 0x2a8a5c, 0x5ac08e], translucent: 0.35, gloss: 0.6, rim: 0.8, outline: 0x04140c }),
    }),
    hat: 'visor', longCoat: false, scarf: false, apron: false, mapCase: false, bulky: false,
  },
  grinder: {
    mats: mats({
      [COAT]: BASE[SHIRT]!,
      [COAT_D]: material({ keys: [0x1c1a16, 0x3a362e, 0x5a5448, 0x7e7666], gloss: 0.1, rim: 0.6, outline: 0x0a0908 }),
      [TROUSER]: material({ keys: [0x14100c, 0x2a221a, 0x443828, 0x62523a], gloss: 0.1, rim: 0.5, outline: 0x060504 }),
      [HAT]: BASE[BRASS]!,
    }),
    hat: 'goggles', longCoat: false, scarf: false, apron: true, mapCase: false, bulky: false,
  },
};

/* ---------------- ghosts ---------------- */

const GHOST_LEVELS = 5;
/** Per slot: how bright the part reads in memory (0 dim coat, 1 bright skin/brass). */
const GHOST_TONE: Record<number, number> = { [COAT]: 0.35, [COAT_D]: 0.2, [TROUSER]: 0.25, [BOOT]: 0.1, [SKIN]: 0.85, [HAIR]: 0.3, [HAT]: 0.3, [SCARF]: 0.55,
  [LEATHER]: 0.3, [BRASS]: 0.9, [PAPER]: 1, [WOOD]: 0.3, [IRON]: 0.35, [FURNACE]: 1, [GLASS]: 0.9, [EYE]: 0.1, [GLINT]: 1, [SHIRT]: 0.6, [APRON]: 0.3, [CRATE]: 0.4 };

function ghostSet(level: number): CreatureMaterial[] {
  // Memory is mostly light: faint → substantial, but never solid (the cave always shows through).
  const see = 0.5 + (1 - level / (GHOST_LEVELS - 1)) * 0.42;
  const out: CreatureMaterial[] = [];
  for (let i = 1; i <= CRATE; i++) {
    const tone = GHOST_TONE[i] ?? 0.4;
    const keys = tone > 0.7 ? [0x2e6a64, 0x6cc4b4, 0xbcf2e4, 0xf4fffa]
      : tone > 0.4 ? [0x1e4c48, 0x3e8e84, 0x7ed2c0, 0xc8f6ea]
        : [0x12302e, 0x245e58, 0x4a9a8e, 0x8ed4c6];
    // A pale rim instead of the living's dark outline: the silhouette glows at its edge.
    out.push(material({ keys, translucent: see, emissive: 0.35 + tone * 0.3, glow: 0x0e4a42, glowK: 0.25 + tone * 0.35, rim: 1, gloss: 0.2, outline: 0x9af4e2 }));
  }
  return out;
}
const GHOSTS: CreatureMaterial[][] = Array.from({ length: GHOST_LEVELS }, (_, i) => ghostSet(i));

/* ---------------- drawing ---------------- */

const LIGHT = blankLight();
const SKELS = new WeakMap<object, Skeleton>();

function limb(r: CreatureRaster, a: V, b: V, ra: number, rb: number, z: number, mat: number, group: number, far = false): void {
  r.capsule(a.x, a.y, ra, b.x, b.y, rb, z, z, mat, { group, far });
}

function boot(r: CreatureRaster, foot: V, facing: number, z: number, group: number, far: boolean, k: number): void {
  r.ellipse(foot.x + facing * 0.8 * k, foot.y - 0.6 * k, 1.8 * k, 1.0 * k, 0, z + 0.3, BOOT, { group, far });
}

/** Draw one story figure. Pell is lit by the scene; a ghost carries its own light. */
export function drawStoryFigure(out: PixelSurface, field: LightField, ctx: Ctx, f: StoryFigureView, carriesPole: boolean): void {
  if (f.alpha <= 0.02 || !out.setFinePx) return;
  let s = SKELS.get(f);
  if (!s) { s = makeSkeleton(); SKELS.set(f, s); }
  const { props } = poseFigure(f, s);
  const c = COSTUMES[f.costume];
  const ghost = f.ghost;
  const level = Math.max(0, Math.min(GHOST_LEVELS - 1, Math.round(f.alpha * (GHOST_LEVELS - 1))));
  const table = ghost ? GHOSTS[level] : c.mats;
  const k = figureScale(f.costume);
  const fc = s.facing;
  const r = sharedRaster;
  const step = out.pixelStep ?? 1;
  const reach = 22 * k;
  r.begin(step, f.x - reach, f.y - 30 * k - (props.rope ? 60 : 0), f.x + reach, f.y + 3, table, f.x, f.y);
  r.outline = 1; r.bands = ghost ? 0.5 : 0.7; r.dither = false; r.blend = 1.4;
  const bulky = c.bulky ? 1.7 : 1;
  // Behind: far arm and leg, the map case, the coat's back.
  limb(r, s.chest, s.backElbow, 0.9 * bulky, 0.78 * bulky, -6, c.bulky ? IRON : COAT_D, 2, true);
  limb(r, s.backElbow, s.backHand, 0.78 * bulky, 0.6 * bulky, -6, c.bulky ? IRON : COAT_D, 2, true);
  r.ellipse(s.backHand.x, s.backHand.y, 0.85 * bulky, 0.75 * bulky, 0, -5.6, c.bulky ? IRON : LEATHER, { group: 2, far: true });
  limb(r, s.hip, s.backKnee, 1.15 * bulky, 0.95 * bulky, -5, TROUSER, 3, true);
  limb(r, s.backKnee, s.backFoot, 0.95 * bulky, 0.8 * bulky, -5, c.bulky ? IRON : TROUSER, 3, true);
  boot(r, s.backFoot, fc, -5, 3, true, bulky);
  if (c.mapCase) {
    // The map case, slung diagonally across his back.
    const ax = s.chest.x - fc * 2.6, ay = s.chest.y - 1.2, bx = s.hip.x - fc * 3.2, by = s.hip.y + 2.6;
    r.capsule(ax, ay, 0.95, bx, by, 0.95, -3.5, -3.5, LEATHER, { group: 4 });
    r.ellipse(ax, ay, 1.05, 1.05, 0, -3.4, BRASS, { group: 4 });
  }
  if (carriesPole) {
    // The lantern pole in the back hand, the lantern swinging from its crook.
    const px = s.backHand.x, py = s.backHand.y;
    r.capsule(px, py + 7, 0.35, px + fc * 0.8, py - 14, 0.35, -4, -4, WOOD, { group: 5 });
    const sway = Math.sin(ctx.state.frameCount * 0.05 + f.seed) * 0.8;
    const lx = px + fc * 3.4 + sway, ly = py - 11.5;
    r.capsule(px + fc * 0.8, py - 14, 0.28, lx, py - 13.4, 0.28, -4, -4, WOOD, { group: 5 });
    r.ellipse(lx, ly, 1.1, 1.4, 0, -3.8, GLASS, { group: 6, noOutline: true });
    r.ellipse(lx, ly - 1.6, 1.0, 0.45, 0, -3.7, BRASS, { group: 6 });
    r.glowStamp(lx, ly, 0.9, 1.1, 0, FURNACE, 1.2, 0.5, 6);
  }
  // The torso.
  const mid = { x: (s.hip.x + s.chest.x) / 2, y: (s.hip.y + s.chest.y) / 2 };
  const tw = c.bulky ? 3.4 : 2.1;
  r.capsule(s.hip.x, s.hip.y, tw - 0.1, mid.x, mid.y, tw, 0, 0, c.bulky ? IRON : COAT, { group: 1 });
  r.capsule(mid.x, mid.y, tw, s.chest.x, s.chest.y, tw + 0.35, 0, 0.5, c.bulky ? IRON : COAT, { group: 1 });
  if (c.longCoat) {
    // A long coat to the knees: a flared skirt behind the legs, split at the front.
    const kx = (s.backKnee.x + s.frontKnee.x) / 2, ky = Math.max(s.backKnee.y, s.frontKnee.y) + 1.2;
    r.capsule(s.hip.x - fc * 0.6, s.hip.y, 2.3, kx - fc * 1.4, ky, 2.7, -1, -1.2, COAT_D, { group: 1 });
  }
  if (c.apron) r.capsule(s.hip.x + fc * 0.8, s.hip.y + 1.4, 1.8, s.chest.x + fc * 1.1, s.chest.y + 1.2, 1.6, 1.2, 1.4, APRON, { group: 1 });
  if (c.bulky) {
    // The furnace door in the stoker's chest, and its grate glowing.
    const fx = mid.x + fc * 1.6, fy = mid.y - 0.6;
    r.ellipse(fx, fy, 1.7, 1.5, 0, 3.4, IRON, { group: 1 });
    r.ellipse(fx, fy, 1.1, 0.95, 0, 3.6, FURNACE, { group: 1, noOutline: true });
    r.glowStamp(fx, fy, 1.4, 1.2, 0, FURNACE, 1.4 + Math.sin(ctx.state.frameCount * 0.12 + f.seed) * 0.3, 0.5, 1);
    for (const dx of [-1.6, 1.6]) r.dot(s.chest.x + dx, s.chest.y + 0.6, BRASS, 2, 4);
  } else {
    // Buttons down the front.
    for (let i = 0; i < 3; i++) r.dot(s.chest.x + fc * 1.2 + (mid.x - s.chest.x) * i * 0.5, s.chest.y + 1 + i * 1.5, c.longCoat ? BRASS : LEATHER, 2, 4);
  }
  // Near leg.
  limb(r, s.hip, s.frontKnee, 1.2 * bulky, 1.0 * bulky, 3, TROUSER, 8);
  limb(r, s.frontKnee, s.frontFoot, 1.0 * bulky, 0.85 * bulky, 3, c.bulky ? IRON : TROUSER, 8);
  boot(r, s.frontFoot, fc, 3, 8, false, bulky);
  if (c.longCoat) {
    // The coat's front panel over the near thigh.
    r.capsule(s.hip.x + fc * 0.8, s.hip.y - 0.6, 2.0, s.frontKnee.x + fc * 0.3, s.frontKnee.y + 0.6, 1.6, 3.6, 3.8, COAT, { group: 9 });
  }
  // Shoulders, scarf.
  r.ellipse(s.chest.x - fc * 0.2, s.chest.y - 0.2, (c.bulky ? 4.2 : 2.6), 1.3 * (c.bulky ? 1.4 : 1), s.lean * 0.8, 2, c.bulky ? IRON : COAT, { group: 10 });
  if (c.scarf) {
    r.ellipse(s.neck.x, s.neck.y + 0.4, 1.7, 1.1, 0, 4.2, SCARF, { group: 10 });
    const tail = Math.sin(ctx.state.frameCount * 0.06 + f.seed) * 0.4;
    r.capsule(s.neck.x - fc * 0.6, s.neck.y + 0.8, 0.7, s.neck.x - fc * (2.2 + tail), s.neck.y + 4.4, 0.55, 4.1, 4.0, SCARF, { group: 10 });
  }
  // Head.
  const ht = s.headTilt, hc = Math.cos(ht), hs = Math.sin(ht);
  const H = (side: number, up: number): [number, number] => [s.head.x + (side * fc) * hc * k - (-up) * hs * k, s.head.y + (side * fc) * hs * k + (-up) * hc * k];
  if (c.hat === 'stoker') {
    // An iron dome with a grille for a face and one lamp-eye.
    r.ellipse(s.head.x, s.head.y, 2.8 * k, 2.5 * k, ht, 4, IRON, { group: 11 });
    for (let i = -1; i <= 1; i++) r.stroke(...H(1.0, i * 0.8), ...H(2.4, i * 0.8), COAT_D, 0, true);
    const [ex, ey] = H(1.3, 0.9);
    r.ellipse(ex, ey, 0.6, 0.6, 0, 4.6, FURNACE, { group: 11, noOutline: true });
    r.glowStamp(ex, ey, 0.7, 0.7, 0, FURNACE, 1.6, 0.4, 11);
  } else {
    limb(r, s.neck, s.head, 0.8, 0.85, 3, SKIN, 11);
    r.ellipse(s.head.x, s.head.y, 2.2 * k, 2.35 * k, ht, 4, SKIN, { group: 11 });
    r.ellipse(...H(2.1, 0.0), 0.85 * k, 0.65 * k, ht + fc * 0.25, 4.6, SKIN, { group: 11 });
    r.stamp(...H(-1.2, 0.2), 0.5, 0.65, ht, SKIN, 0.5, false, 11);
    const [ex, ey] = H(1.15, 0.7);
    if (s.eyesShut) r.stroke(ex - 0.5, ey, ex + 0.45, ey + 0.1, HAIR, 0, true);
    else {
      r.stamp(ex, ey, 0.5, 0.6, 0, EYE, 0, false, 11);
      r.dot(ex + 0.15 + s.gazeX * 0.2 * fc, ey - 0.2 + s.gazeY * 0.15, GLINT, 1, 30);
    }
    if (s.mouth > 0.3) r.stamp(...H(1.5, -1.0), 0.45, 0.2 + s.mouth * 0.3, ht, EYE, 0, true, 11);
    if (f.costume === 'docent') {
      // Spectacles and white side-whiskers.
      r.stroke(...H(0.6, 0.8), ...H(1.9, 0.8), BRASS, 1, true);
      r.stamp(...H(-0.2, -1.2), 1.2, 0.9, ht, HAIR, 1, false, 11);
    } else if (f.costume === 'foreman') {
      r.stamp(...H(1.6, -0.7), 1.0, 0.35, ht, HAIR, 1.4, false, 11); // a moustache
    }
    drawHat(r, c.hat, H, s, fc, k);
  }
  // Near arm and whatever is in the hands.
  const armMat = c.bulky ? IRON : (f.costume === 'worker' || f.costume === 'grinder' ? SHIRT : COAT);
  if (props.crate) {
    const cx = (s.backHand.x + s.frontHand.x) / 2 + fc * 1.2, cy = (s.backHand.y + s.frontHand.y) / 2 - 1.4;
    r.poly(crateBox(cx, cy, 3.2, 2.6), 4, 6.5, CRATE, 0.3, { group: 12 });
    r.stroke(cx - 3.2, cy, cx + 3.2, cy, WOOD, 0, true);
  }
  if (props.wheel) {
    const cx = (s.backHand.x + s.frontHand.x) / 2, cy = (s.backHand.y + s.frontHand.y) / 2;
    r.ellipse(cx, cy, 2.3, 2.3, 0, 6.2, BRASS, { group: 12 });
    r.ellipse(cx, cy, 1.4, 1.4, 0, 6.4, IRON, { group: 12 });
  }
  if (props.board) {
    const bx = s.backHand.x + fc * 0.6, by = s.backHand.y - 0.8;
    r.poly(crateBox(bx, by, 2.2, 1.7), 4, 7.2, PAPER, 0.05, { group: 12 });
  }
  if (props.lens) {
    const lx = (s.backHand.x + s.frontHand.x) / 2, ly = Math.min(s.backHand.y, s.frontHand.y) - 1.6;
    r.ellipse(lx, ly, 2.6, 2.6, 0, 7, GLASS, { group: 12, noOutline: true });
    r.glowStamp(lx, ly, 2.2, 2.2, 0, GLINT, 0.8, 0.2, 12);
  }
  limb(r, s.chest, s.frontElbow, 0.95 * bulky, 0.82 * bulky, 8, armMat, 13);
  limb(r, s.frontElbow, s.frontHand, 0.82 * bulky, 0.62 * bulky, 8.5, armMat, 13);
  r.ellipse(s.frontHand.x, s.frontHand.y, 0.85 * bulky, 0.75 * bulky, 0, 8.8, c.bulky ? IRON : SKIN, { group: 13 });
  if (props.shovel) {
    const hx = s.frontHand.x, hy = s.frontHand.y, a = Math.atan2(hy - s.backHand.y, hx - s.backHand.x);
    const ex2 = hx + Math.cos(a) * 7, ey2 = hy + Math.sin(a) * 7;
    r.capsule(s.backHand.x, s.backHand.y, 0.35, ex2, ey2, 0.35, 8.6, 8.6, WOOD, { group: 14 });
    r.ellipse(ex2 + Math.cos(a) * 1.4, ey2 + Math.sin(a) * 1.4, 1.6, 1.0, a, 8.7, IRON, { group: 14 });
  }
  if (props.bell) {
    r.ellipse(s.frontHand.x, s.frontHand.y - 1.6, 1.1, 1.3, 0, 9, BRASS, { group: 14 });
  }
  if (props.rope) {
    const rx = (s.backHand.x + s.frontHand.x) / 2;
    r.capsule(rx, s.frontHand.y - 60, 0.3, rx, f.y + 1, 0.3, -7, -7, WOOD, { group: 15 });
  }
  if (ghost) {
    LIGHT.lx = -0.3; LIGHT.ly = -0.7; LIGHT.lz = 0.65; LIGHT.r = 1; LIGHT.g = 1; LIGHT.b = 1; LIGHT.flash = 0; LIGHT.glow = 0.4 + f.alpha * 0.6;
  } else {
    sampleSceneLight(field, s.chest.x, s.chest.y, 10, 0, LIGHT, 1);
    // Pell keeps to his lantern's light, but never vanishes into the gloom beside it.
    LIGHT.r = Math.max(0.62, LIGHT.r); LIGHT.g = Math.max(0.6, LIGHT.g); LIGHT.b = Math.max(0.6, LIGHT.b);
  }
  r.resolve(out, LIGHT);
}

const BOX = new Float64Array(8);
function crateBox(cx: number, cy: number, hw: number, hh: number): Float64Array {
  BOX[0] = cx - hw; BOX[1] = cy - hh; BOX[2] = cx + hw; BOX[3] = cy - hh; BOX[4] = cx + hw; BOX[5] = cy + hh; BOX[6] = cx - hw; BOX[7] = cy + hh;
  return BOX;
}

function drawHat(r: CreatureRaster, hat: Costume['hat'], H: (side: number, up: number) => [number, number], s: Skeleton, fc: number, k: number): void {
  const ba = s.brimAngle;
  if (hat === 'cap') {
    // A soft surveyor's cap, the peak shading the brow.
    const [cx, cy] = H(-0.2, 2.1);
    r.ellipse(cx, cy, 2.5 * k, 1.35 * k, ba, 5.8, HAT, { group: 16 });
    const [px, py] = H(1.9, 1.5);
    r.ellipse(px, py, 1.5 * k, 0.45 * k, ba + fc * 0.1, 6.0, HAT, { group: 16 });
    r.shade(...H(1.2, 1.1), 1.6, 0.4, ba, -1, 11);
  } else if (hat === 'flatcap') {
    const [cx, cy] = H(0.1, 2.0);
    r.ellipse(cx, cy, 2.6 * k, 1.1 * k, ba + fc * 0.08, 5.8, HAT, { group: 16 });
    const [px, py] = H(2.2, 1.6);
    r.ellipse(px, py, 1.2 * k, 0.4 * k, ba, 6, HAT, { group: 16 });
  } else if (hat === 'bowler') {
    const [cx, cy] = H(-0.1, 2.6);
    r.ellipse(cx, cy, 2.1 * k, 1.7 * k, ba, 5.8, HAT, { group: 16 });
    const [bx, by] = H(-0.1, 1.5);
    r.ellipse(bx, by, 3.0 * k, 0.5 * k, ba, 6, HAT, { group: 16 });
  } else if (hat === 'tophat') {
    const [bx, by] = H(-0.1, 1.6);
    r.ellipse(bx, by, 3.2 * k, 0.5 * k, ba, 6, HAT, { group: 16 });
    const [a1, a2] = H(-0.1, 2.0), [b1, b2] = H(-0.1, 5.4);
    r.capsule(a1, a2, 1.8 * k, b1, b2, 1.9 * k, 5.8, 5.9, HAT, { group: 16 });
    r.stamp(...H(-0.1, 2.3), 1.9, 0.4, ba, LEATHER, 1, false, 16);
  } else if (hat === 'visor') {
    const [px, py] = H(1.6, 1.8);
    r.ellipse(px, py, 1.8 * k, 0.4 * k, ba, 6, HAT, { group: 16, noOutline: true });
    r.stamp(...H(-0.2, 1.9), 2.2, 0.35, ba, LEATHER, 1, false, 11);
  } else if (hat === 'goggles') {
    r.stamp(...H(0.1, 1.6), 2.3, 0.45, ba, LEATHER, 1, false, 11);
    r.ellipse(...H(1.2, 1.9), 0.7 * k, 0.7 * k, 0, 6, BRASS, { group: 16 });
    r.ellipse(...H(1.2, 1.9), 0.45 * k, 0.45 * k, 0, 6.2, GLASS, { group: 16, noOutline: true });
  }
}
