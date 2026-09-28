import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { BATH_TRIP_WATER, TEA, TEA_BACKUP, TEA_CORD_PULLEY, TEA_STAGE as S, TEA_VALVES, type TeaValve } from '@/world/teaMachine';
import { Cell } from '@/sim/CellType';
import { interpolateBody } from '@/render/RenderPoses';
import { BRASS, BRASS_D, BRASS_L, COPPER, HEMP, HEMP_D, INK, IRON, IRON_D, Pen, STEEL, STEEL_D, STEEL_L, cameraView,
  type RGB, type ViewRect } from '@/render/sprites/FineArt';

type Point = readonly [number, number];

const FAULT_GLOW: RGB = [1.15, 0.78, 0.32];
const EMBER: RGB = [1.3, 0.62, 0.18];
const ASH: RGB = [0.2, 0.17, 0.15];

/**
 * Mechanical drawings of the Bell & Tea Engine's linkages: wheels, rods,
 * cables, guides and coils, rasterised at presentation resolution. Every
 * pose comes from the solver's bodies (interpolated between fixed ticks)
 * and the plates' real travel — idle wheels never spin just because a stage
 * is active, and a cable's twist advances only as far as its plate moved.
 * The three service fixtures a player can touch (the priming pan, the
 * Persuader, the duck's grate) pulse while their station waits, and their
 * backups (slow match, clockwork knocker, seep) are drawn advancing.
 */
export function drawTeaLinkages(out: PixelSurface, light: LightField, ctx: Ctx, alpha = 1): void {
  const s = ctx.levels.current?.living?.tea;
  if (!s) return;
  const frame = ctx.state.frameCount;
  const view: ViewRect = cameraView(ctx.camera, 24);
  const litAt = (x: number, y: number): RGB => {
    const sample = light.sample(x, y);
    return [Math.min(1.05, Math.max(0.5, sample.r)), Math.min(1.05, Math.max(0.5, sample.g)), Math.min(1.05, Math.max(0.5, sample.b))];
  };
  const penAt = (x: number, y: number): Pen => new Pen(out, view, litAt(x, y));
  const bodies = ctx.rigidBodies.bodies;
  const body = (tag: string): { px: number; py: number; pa: number } | undefined => {
    const b = bodies.find(candidate => candidate.tag === tag);
    if (!b) return undefined;
    const pose = interpolateBody(b, alpha);
    return { px: pose.x, py: pose.y, pa: pose.angle };
  };
  const eyeRing = (p: Pen, x: number, y: number): void => { p.ring(x, y, 1.4, 0.6, BRASS); p.px(x - 0.5, y - 0.5, BRASS_L); };
  const pulse = 0.55 + Math.sin(frame * 0.14) * 0.35;
  /** A soft beckoning halo around the fixture a waiting station needs. */
  const beckon = (x: number, y: number, r: number): void => {
    const p = penAt(x, y);
    const grow = (frame % 70) / 70; // an expanding ripple, plus a steady ring
    p.ring(x, y, r + grow * 9, 0.8, FAULT_GLOW, (1 - grow) * 0.9);
    p.ring(x, y, r, 0.9, FAULT_GLOW, 0.55 + pulse * 0.4);
    p.glow(x, y, FAULT_GLOW, 0.45 * pulse);
  };

  // The apparatus occupies one inherited workshop, not a row of unrelated
  // toys. Riveted bays, a shared service manifold and stateful gauges bind the
  // causal stations into one readable silhouette.
  const bays: ReadonlyArray<readonly [number, number, number, RGB]> = [
    [452, 596, S.CORD, [0.58, 0.34, 0.16]],
    [598, 700, S.SWING, [0.49, 0.44, 0.28]],
    [702, 770, S.DOMINOES, [0.59, 0.45, 0.22]],
    [772, 870, S.SPRING, [0.55, 0.5, 0.25]],
    [872, 960, S.POUR, [0.28, 0.52, 0.55]],
    [962, 1060, S.MARBLE, [0.35, 0.53, 0.48]],
    [1062, 1292, S.FUSE2, [0.49, 0.56, 0.34]],
    [1294, 1450, S.GENERATOR, [0.67, 0.35, 0.19]],
    [1452, 1554, S.DONE, [0.65, 0.53, 0.28]],
  ];
  for (let bayIndex = 0; bayIndex < bays.length; bayIndex++) {
    const [x0, x1, stage, accent] = bays[bayIndex];
    const centre = (x0 + x1) / 2, p = penAt(centre, 142);
    if (!p.inView(x0, 31, x1, 258)) continue;
    for (const x of [x0 + 3, x1 - 3]) {
      p.rod(x, 42, x, 256, bayIndex % 2 ? IRON_D : IRON, 1);
      for (let y = 50; y < 252; y += 26) p.rivet(x + (x === x0 + 3 ? .8 : -.8), y, BRASS_D);
    }
    p.curve(x0 + 3, 46, centre, 31 - (bayIndex % 3) * 3, x1 - 3, 46, IRON_D, 1.2);
    p.line(x0 + 5, 252, x1 - 5, 252, IRON_D, 1.4);
    // The dial is a physical stage witness: its needle swings over only once
    // this bay's handoff has actually happened.
    const gaugeX = x0 + 14, gaugeY = 52;
    p.disc(gaugeX, gaugeY, 4.2, [0.29, 0.31, 0.28], INK, .7);
    p.arc(gaugeX, gaugeY, 3.1, Math.PI * 1.08, Math.PI * 1.92, STEEL_L, .5, .75);
    const done = s.stage >= stage ? 1 : 0;
    const needle = Math.PI * (1.1 + done * .78);
    p.line(gaugeX, gaugeY, gaugeX + Math.cos(needle) * 2.7, gaugeY + Math.sin(needle) * 2.7, done ? accent : STEEL_D, .5);
    p.disc(gaugeX, gaugeY, .7, BRASS_L, INK);
    for (let mark = 0; mark <= bayIndex % 4; mark++) p.line(x1 - 14 + mark * 2, 50, x1 - 14 + mark * 2, 55, BRASS_D, .5);
    p.disc(x1 - 10, 62, 1.45, done ? accent : IRON_D, INK);
    if (done) p.glow(x1 - 10, 62, accent, .42 + Math.sin(frame * .08 + stage) * .08);
  }
  {
    const p = penAt(995, 41);
    p.cable([[458, 39], [610, 39], [618, 45], [825, 45], [835, 39], [1080, 39],
      [1090, 45], [1280, 45], [1290, 39], [1548, 39]], 0, { color: COPPER, dark: BRASS_D, width: 1, sag: 2 });
    for (const x of [610, 825, 1080, 1280, 1450]) {
      p.ring(x, x % 2 ? 42 : 39, 2.2, .7, BRASS_D);
      p.rivet(x - .5, (x % 2 ? 42 : 39) - .5, BRASS_L);
    }
  }
  // Soot from the blasts accumulates only once they have happened.
  if (s.stage >= S.CHARGES) {
    const p = penAt(1420, 223);
    for (let i = 0; i < 14; i++) p.px(1350 + (i * 17) % 150, 223 - (i * 7) % 14, i % 3 ? [0.16, 0.14, 0.13] : [0.29, 0.23, 0.16], .65);
  }

  /** Guide rails and the brass frame over a plate's real metal; returns the cable eye. */
  const valve = (key: TeaValve): Point => {
    const { plate, dx, dy, max } = TEA_VALVES[key], travel = s.travel?.[key] ?? 0;
    const x = plate.x + travel * dx, y = plate.y + travel * dy;
    const p = penAt(plate.x + plate.w / 2, plate.y);
    if (dy) for (const gx of [plate.x - 2, plate.x + plate.w + 1]) {
      p.rod(gx, plate.y - max - 3, gx, plate.y + plate.h + 1, STEEL, 0.75);
      for (let yy = plate.y - max; yy <= plate.y; yy += 4) p.rivet(gx + (gx < plate.x ? -1 : 1), yy, BRASS_L);
    } else for (const gy of [plate.y - 2, plate.y + plate.h + 1]) {
      const reach = plate.x + (dx > 0 ? plate.w + max : -max);
      p.rod(Math.min(plate.x, reach), gy, Math.max(plate.x + plate.w, reach), gy, STEEL, 0.6);
    }
    const w = plate.w, h = plate.h;
    let framed = 0;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (ctx.world.type(x + xx, y + yy) === Cell.Metal) framed++;
    if (framed > 0) {
      p.line(x, y, x + w - 1, y, BRASS, 0, 1.15);
      p.line(x, y + h - 1, x + w - 1, y + h - 1, BRASS_D);
      p.line(x, y, x, y + h - 1, BRASS); p.line(x + w - 1, y, x + w - 1, y + h - 1, BRASS_D);
      p.rivet(x + 0.5, y + 0.5); p.rivet(x + w - 1.5, y + h - 1.5);
    }
    const eye: Point = dy ? [x + w / 2 - 0.5, y - 2] : dx > 0 ? [x + w + 1, y + h / 2 - 0.5] : [x - 2, y + h / 2 - 0.5];
    eyeRing(p, ...eye);
    return eye;
  };

  /** A cable over pulleys: `pulleys` names which interior points carry a wheel. */
  const run = (points: readonly Point[], stroke: number, material: 'cable' | 'chain' | 'rope', pulleys: readonly number[], color?: RGB): void => {
    const p = penAt(points[0][0], points[0][1]);
    p.cable(points, stroke, { material, color });
    for (const i of pulleys) {
      const [x, y] = points[i];
      penAt(x, y).wheel(x, y, 4.5, stroke / 4.5, { spokes: 4, groove: true, rimWidth: 1.2 });
    }
  };

  // ======================= I. IGNITION =======================
  // Striker rod brackets and flint head over the fuse head.
  {
    const p = penAt(442, 270);
    for (let y = 256; y < 288; y += 12) { p.box(442, y, 2.4, 1.2, 0, IRON_D); p.rivet(440.5, y - 0.5); p.rivet(443.5, y - 0.5); }
    p.polygon([[449, 250], [453.5, 250], [454.5, 254.5], [450, 254]], STEEL, 1, 0.3);
    p.line(450, 250, 454.5, 250, STEEL_L);
    if (s.stage >= S.FUSE && s.ticks < 40 && frame % 3 !== 0) {
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI * (0.2 + k * 0.2) + Math.sin(frame * 0.9 + k) * 0.3, r = 2 + ((frame * 2 + k * 5) % 9);
        p.glow(TEA.striker.x + Math.cos(a) * r, TEA.striker.y + Math.sin(a) * r, [1.2, 0.85, 0.35], 0.9);
      }
    }
  }
  // The fuse's brass trough lip along its stone bed.
  {
    const p = penAt(515, 259);
    p.line(450, 259.5, TEA.fuse.x1 + 3, 259.5, BRASS_D, 0.6);
    for (let x = 456; x < TEA.fuse.x1; x += 14) p.rivet(x, 259.5, BRASS);
  }
  // The cracked coupling: a brass collar with a split running through it.
  {
    const c = TEA.coupling, p = penAt(c.x + 3, c.y + 3);
    p.box(c.x + c.w / 2 - 0.5, c.y + 1, c.w / 2 + 0.6, 1.4, 0, BRASS, INK);
    p.box(c.x + c.w / 2 - 0.5, c.y + c.h - 2, c.w / 2 + 0.6, 1.2, 0, BRASS_D, INK);
    p.line(c.x + 2.5, c.y - 0.5, c.x + 3.5, c.y + 2.5, INK, 0.5);
    p.line(c.x + 3.5, c.y + 2.5, c.x + 2, c.y + 4.5, INK, 0.5);
    p.line(c.x + 2, c.y + 4.5, c.x + 3, c.y + c.h - 0.5, INK, 0.5);
    if (s.stage === S.SPARK) p.glow(c.x + 3, c.y + 2, FAULT_GLOW, 0.25 * pulse);
  }
  // The priming pan under the floor, and the slow match that backs it up.
  {
    const pan = TEA.pan, cx = pan.x + pan.w / 2, p = penAt(cx, pan.y + 2);
    p.polygon([[pan.x - 1, pan.y], [pan.x + pan.w, pan.y], [pan.x + pan.w - 1, pan.y + pan.h + 0.6], [pan.x, pan.y + pan.h + 0.6]], BRASS, 1, 0.25);
    p.line(pan.x - 1, pan.y + 0.3, pan.x + pan.w, pan.y + 0.3, BRASS_L, 0.4);
    p.disc(cx, pan.y + pan.h - 0.8, 1, INK); // the touch hole
    p.rivet(pan.x + 0.5, pan.y + 1); p.rivet(pan.x + pan.w - 1.5, pan.y + 1);
    const matchStart: Point = [445, 268], matchEnd: Point = [pan.x - 1, pan.y + pan.h];
    const burnt = s.stage > S.SPARK ? 1 : s.stage === S.SPARK ? Math.min(1, (s.faultTicks ?? 0) / TEA_BACKUP.spark) : 0;
    const ex = matchStart[0] + (matchEnd[0] - matchStart[0]) * burnt, ey = matchStart[1] + (matchEnd[1] - matchStart[1]) * burnt;
    const q = penAt(480, 268);
    if (burnt > 0) q.cable([matchStart, [ex, ey]], 0, { material: 'rope', color: ASH, dark: INK, sag: 1 });
    if (burnt < 1) q.cable([[ex, ey], matchEnd], 0, { material: 'rope', color: HEMP, dark: HEMP_D, sag: 1 });
    for (let x = 460; x < pan.x - 2; x += 18) q.ring(x, 266.5, 1, 0.5, IRON_D); // staples
    if (s.stage === S.SPARK) {
      q.glow(ex, ey, EMBER, 0.9 + Math.sin(frame * 0.6) * 0.2);
      q.raw(ex, ey, [1.4, 0.9, 0.4], 1);
      for (let k = 0; k < 3; k++) { // a thread of smoke curling up off the match
        const t = ((frame * 0.6 + k * 9) % 26) / 26;
        q.px(ex + Math.sin(frame * 0.05 + k * 2 + t * 5) * 1.6 * t, ey - 1 - t * 9, [0.36, 0.34, 0.32], 0.7 * (1 - t));
      }
      beckon(cx, pan.y + 1.5, 7);
    }
  }

  // ======================= II. MOMENTUM =======================
  // The pendulum's chain eye bolt, and the hemp cord's pulley and lower run to its cleat.
  {
    const p = penAt(653, 55);
    p.disc(653, 55, 1.8, IRON, INK); p.px(652.5, 54.5, STEEL_L);
    const q = penAt(TEA_CORD_PULLEY.x, 160);
    q.wheel(TEA_CORD_PULLEY.x, TEA_CORD_PULLEY.y, 3.5, 0, { spokes: 4, groove: true, rimWidth: 1 });
    const bob = bodies.find(b => b.tag === 'tea-pendulum');
    const cleatX = TEA.cleat.x + TEA.cleat.w / 2, cleatY = TEA.cleat.y + 3;
    if (bob?.tether) q.cable([[TEA_CORD_PULLEY.x + 3, TEA_CORD_PULLEY.y], [cleatX, cleatY - 1]], 0, { material: 'rope', sag: 0 });
    else q.cable([[TEA_CORD_PULLEY.x + 3, TEA_CORD_PULLEY.y], [TEA_CORD_PULLEY.x + 4, TEA_CORD_PULLEY.y + 16]], 0, { material: 'rope', color: ASH, sag: 1 });
    q.box(cleatX, cleatY, 2.2, 0.9, 0, IRON_D); q.rivet(cleatX - 1.5, cleatY - 0.4);
  }
  // Ramp guard rail and the tollgate, whose chain drops through the floor to the Persuader.
  {
    const p = penAt(715, 150);
    for (let x = 672; x < 758; x += 1.5) {
      const y = x <= 700 ? 149.2 : 149.2 + Math.floor((x - 700) * .37);
      p.px(x, y, BRASS_D, 0.8);
    }
    const eye = valve('gate'), g = TEA.persuader;
    run([eye, [eye[0] + 0.5, 104], [g.x, 104], [g.x, 262]], s.travel?.gate ?? 0, 'chain', [1, 2]);
    // Floor slot the chain passes through, and the Persuader's shackle.
    const q = penAt(g.x, 262);
    q.box(g.x, 262.5, 3, 1, 0, IRON_D); q.rivet(g.x - 2, 262.5); q.rivet(g.x + 2, 262.5);
    const bob = body('tea-persuader');
    if (bob) {
      const r = penAt(bob.px, bob.py);
      r.disc(bob.px, bob.py, 5.3, BRASS, INK, .6);
      r.disc(bob.px - 1.5, bob.py - 1.8, 1.5, BRASS_L);
      r.line(bob.px - 3.2, bob.py + 2, bob.px + 3.2, bob.py + 2, BRASS_D, .5);
      if (s.stage === S.KICK) beckon(bob.px, bob.py, 7.5);
    }
    // The clockwork knocker: a sprung arm on the ceiling that winds while the
    // gate stays shut, then swings into the Persuader.
    const kx = g.x + 15, ky = 267, k = penAt(kx, ky);
    const wind = s.stage === S.KICK ? Math.min(1, (s.faultTicks ?? 0) / TEA_BACKUP.kick) : 0;
    const armA = Math.PI * (0.62 - wind * 0.5);
    k.box(kx, ky - 1.5, 3.2, 1.6, 0, IRON, INK);
    for (let a = 0; a < Math.PI * 4; a += 0.18) k.px(kx + Math.cos(a + wind * 9) * (0.6 + a * .22), ky - 1.5 + Math.sin(a + wind * 9) * (0.6 + a * .22) * .6, BRASS_D);
    k.rod(kx, ky, kx + Math.cos(armA) * 11, ky + Math.sin(armA) * 11, STEEL, 1);
    k.disc(kx + Math.cos(armA) * 11, ky + Math.sin(armA) * 11, 1.6, IRON, INK);
    k.disc(kx, ky, 1, BRASS_L, INK);
  }
  // Dominoes carry pip markings that turn with each body.
  for (const b of bodies) if (b.tag?.startsWith('tea-domino-')) {
    const pose = interpolateBody(b, alpha), c = Math.cos(pose.angle), sin = Math.sin(pose.angle);
    const at = (x: number, y: number): Point => [pose.x + x * c - y * sin, pose.y + x * sin + y * c];
    const p = penAt(pose.x, pose.y);
    p.line(...at(-1, 0), ...at(1, 0), INK);
    for (const y of [-6, -3, 4, 7]) p.px(...at(0, y), INK);
  }
  {
    const b = TEA.backstop, p = penAt(b.x + 1, b.y);
    p.box(b.x + 1, b.y - 0.5, 2.6, 1, 0, BRASS, INK); p.rivet(b.x + 1, b.y + 6);
  }
  // The last domino's cable draws the latch out from under the wound crank.
  const domino = body('tea-domino-5'), springEye = valve('spring');
  if (domino) {
    const top: Point = [domino.px + Math.sin(domino.pa) * 10, domino.py - Math.cos(domino.pa) * 10];
    run([top, [860, 142], [874, 142], [874, 183.5], springEye], s.travel?.spring ?? 0, 'cable', [1, 2, 3]);
  }
  // The wound spring crank on its A-frame; its cable lifts the header tank's plug.
  const rocker = body('tea-rocker'), tapEye = valve('tap');
  if (rocker) {
    const p = penAt(rocker.px, rocker.py);
    const end: Point = [rocker.px + Math.cos(rocker.pa) * 17, rocker.py + Math.sin(rocker.pa) * 17];
    run([end, [930, 112], [1004, 112], tapEye], s.travel?.tap ?? 0, 'cable', [1, 2]);
    p.rod(rocker.px - 7, rocker.py + 9, rocker.px, rocker.py, IRON, 1.2);
    p.rod(rocker.px, rocker.py, rocker.px + 7, rocker.py + 9, IRON_D, 1.2);
    p.box(rocker.px, rocker.py + 9.5, 8, 0.75, 0, IRON);
    for (let a = 0; a <= Math.PI * 5; a += 0.045 * p.step * 2) {
      const r = 2 + a * 0.38, turn = a + rocker.pa;
      p.px(rocker.px + Math.cos(turn) * r, rocker.py + Math.sin(turn) * r, a % 0.5 < 0.25 ? BRASS : BRASS_D);
    }
    p.disc(rocker.px, rocker.py, 1.3, BRASS_L, INK);
  }

  // ======================= III. WATER =======================
  {
    const t = TEA.tank, p = penAt((t.x0 + t.x1) / 2, 140);
    // Brass straps and a sight glass whose float reads the tank's real water.
    for (const y of [t.y0 - 2, t.y1 + 2]) p.line(t.x0 - 4, y, t.x1 + 4, y, BRASS_D, 0.6);
    let water = 0;
    for (let y = t.y0; y <= t.y1; y++) for (let x = t.x0; x <= t.x1; x++) if (ctx.world.type(x, y) === Cell.Water) water++;
    const level = water / ((t.x1 - t.x0 + 1) * (t.y1 - t.y0 + 1));
    p.rod(t.x1 + 7, t.y0, t.x1 + 7, t.y1, STEEL_D, 1.5);
    p.box(t.x1 + 7, t.y1 - level * (t.y1 - t.y0), 1.6, 0.8, 0, BRASS_L);
    // Downpipe bands, and the clog of swollen tea leaves at its foot.
    const pipe = TEA.pipe;
    for (let y = pipe.y0 + 8; y < pipe.y1; y += 20) {
      p.line(pipe.x0 - 4.5, y, pipe.x0 - 0.5, y, BRASS, 0.6); p.line(pipe.x1 + 0.5, y, pipe.x1 + 4.5, y, BRASS, 0.6);
    }
    const q = penAt(1003, 256);
    for (let i = 0; i < 10; i++) q.px(pipe.x0 + (i * 7) % 6, pipe.y1 - (i * 3) % 3, i % 2 ? [0.33, 0.25, 0.12] : [0.24, 0.18, 0.09]);
    // The nozzle under the floor.
    q.box(TEA.nozzle.x + 0.5, 264.5, 3.2, 1.1, 0, BRASS, INK);
    q.px(TEA.nozzle.x + 0.5, 266.5, [0.55, 0.75, 0.9], 0.6 + Math.sin(frame * 0.3) * 0.3);
  }
  // The duck's bath: a riveted brass rim, the carriage guides, and the rod
  // that lifts the marble's pin through a bell crank.
  {
    const b = TEA.bath, p = penAt((b.x0 + b.x1) / 2, 320);
    p.line(b.x0 - 4, 311.5, b.x1 + 4, 311.5, BRASS, 0.6);
    for (const x of [b.x0 - 2, b.x1 + 2]) { p.rivet(x, 318); p.rivet(x, 326); }
    for (const x of [b.x0 + 2, b.x1 - 2]) p.rod(x, b.y0, x, b.y1, STEEL, 0.5);
    const duck = body('tea-duck'), pinEye = valve('pin');
    const rodX = 1014, crankY = 170;
    const top = duck ? duck.py - 3 : TEA.duckRest - 3;
    const r = penAt(rodX, 240);
    r.rod(1011, top, rodX, top - 2, STEEL, 0.75);
    r.rod(rodX, top - 2, rodX, crankY, STEEL, 0.75);
    for (let y = 270; y < 310; y += 10) r.box(rodX, y, 1.2, 0.5, 0, IRON_D); // rod guides in the catwalk
    r.wheel(1028, crankY, 2.5, (TEA.duckRest - (duck?.py ?? TEA.duckRest)) * 0.3, { spokes: 4, rimWidth: .8 });
    r.rod(rodX, crankY, 1028, crankY, STEEL_D, 0.75);
    r.rod(1028, crankY, pinEye[0], pinEye[1] + TEA.pin.h + 3, STEEL, 0.75);
    if (s.stage === S.POUR) {
      beckon((b.x0 + b.x1) / 2, 313, 11);
      // The seep gauge on the bath wall: how close the drips are to floating the duck.
      const fill = Math.min(1, countWater(ctx, b) / BATH_TRIP_WATER);
      const g = penAt(b.x1 + 8, 320);
      g.rod(b.x1 + 8, 330, b.x1 + 8, 314, IRON_D, 2);
      g.rod(b.x1 + 8, 330, b.x1 + 8, 330 - fill * 16, [0.4, 0.7, 0.95], 1.2);
    }
  }
  // The marble's top rail and the flint it strikes at the second fuse's head.
  {
    const r = TEA.rail, p = penAt(1150, 180);
    for (let x = TEA.pin.x + 7; x < r.x1 - 12; x += 1.5) {
      const y = r.y + Math.floor((x - r.x0) * r.slope) - 16;
      p.px(x, y + 0.5, BRASS_D, 0.85);
    }
    for (let x = r.x0 + 30; x < r.x1; x += 40) { const y = r.y + Math.floor((x - r.x0) * r.slope); p.rod(x, y + 3, x, y + 12, IRON_D, 0.8); }
    const marble = body('tea-marble');
    if (marble) {
      const q = penAt(marble.px, marble.py);
      q.disc(marble.px - 1.4, marble.py - 1.6, 1.5, STEEL_L, undefined, undefined, true);
    }
    const struck = s.stage > S.MARBLE;
    const f = TEA.flint, fp = penAt(f.x, f.y);
    const a = struck ? Math.PI * 0.62 : Math.PI * 0.18;
    fp.rod(f.x + 6, f.y, f.x + 6 + Math.cos(a) * 13, f.y + Math.sin(a) * 13, STEEL, 1);
    fp.polygon([[f.x + 6 + Math.cos(a) * 13 - 1.5, f.y + Math.sin(a) * 13], [f.x + 6 + Math.cos(a) * 13 + 1.5, f.y + Math.sin(a) * 13 - 1],
      [f.x + 6 + Math.cos(a) * 15, f.y + Math.sin(a) * 15 + 1.5]], [0.75, 0.79, 0.83], 1, 0.3);
    fp.disc(f.x + 6, f.y, 1.4, BRASS_L, INK);
    fp.polygon([[TEA.fuse2.x0 - 1, 227.5], [TEA.fuse2.x0 + 2, 227.5], [TEA.fuse2.x0 + 3.5, 222.5], [TEA.fuse2.x0 + 0.5, 223]], [0.75, 0.79, 0.83], 1, 0.3);
  }
  // Brackets under the second fuse's shelf.
  {
    const p = penAt(1400, 240);
    for (let x = TEA.fuse2.x0 + 6; x < 1496; x += 44) { p.rod(x, 230, x - 6, 258, IRON_D, 0.9); p.rivet(x, 231); }
  }

  // ======================= IV. LIGHTNING =======================
  {
    const p = penAt(1507, 240);
    p.rod(1524, 224, 1519, 224, STEEL, 0.5); p.rod(1519, 224, 1519, 249, STEEL, 0.5);
    for (let y = 232; y < 251; y += 2) p.line(1496, y + 1, 1519, y - 0.5, COPPER, 0.5, y % 4 === 0 ? 1.15 : 0.8);
    p.rod(1496, 231, 1496, 251, BRASS_D, 0.75); p.rod(1519, 231, 1519, 251, BRASS_D, 0.75);
    for (const x of [1386, 1440, 1500]) {
      const q = penAt(x, 36);
      q.rod(x, 33, x, 38, STEEL, 0.5); q.box(x, 37, 2, 0.6, 0, STEEL_D); q.disc(x, 34, 0.9, [0.85, 0.85, 0.9], INK);
    }
  }
  const latch = body('tea-magnet-latch');
  if (latch) {
    const p = penAt(1400, 96);
    for (const y of [90, 102]) p.rod(1377, y, 1440, y, STEEL, 0.75);
    for (const x of [1404, 1416, 1428, 1440]) p.wheel(x, 102, 2, (1423 - latch.px) / 2, { spokes: 4, rim: STEEL, face: STEEL_D, hub: STEEL_L, rimWidth: 0.8 });
    for (let x = 1359; x < 1375; x += 1.5) p.line(x, 91, x + 0.5, 103, COPPER, 0.5, x % 3 === 0 ? 1.15 : 0.85);
    p.rod(1368, 89, 1368, 91, STEEL, 0.5);
    p.box(1367, 92, 8.5, 0.6, 0, IRON_D); p.box(1367, 103, 8.5, 0.6, 0, IRON_D);
    const charge = ctx.world.charge[ctx.world.idx(TEA.magnetTerminal.x, TEA.magnetTerminal.y)];
    if (charge >= 20) for (const side of [-1, 1]) {
      const glow = 0.7 + Math.sin(frame * 0.35 + side) * 0.3;
      for (let t = 0; t <= 1; t += 0.02 * p.step * 2) {
        p.raw(1376 + (latch.px - 15 - 1376) * t, 96 + Math.sin(t * Math.PI) * side * 6, [0.28, 0.75, 0.8], glow);
      }
    }
  }
  const counterweight = body('tea-counterweight'), bellEye = valve('bell');
  if (counterweight) {
    const movingY = bellEye[1] - 8, drop = counterweight.py - 81;
    run([[counterweight.px, counterweight.py - 12], [1423, 54], [1534, 54], [1534, movingY], [1540, 54], [1546, movingY], [1552, 54], [1552, 32]],
      drop, 'chain', [2, 4, 6]);
    const p = penAt(1423, 54);
    p.box(1540, movingY + 4, 6.5, 0.9, 0, BRASS); p.rod(1542, movingY + 4, bellEye[0], bellEye[1], STEEL, 0.5);
    p.wheel(1423, 54, 9, drop / 9, { spokes: 4, rimWidth: 2, groove: true });
    for (let spoke = 0; spoke < 4; spoke++) {
      const angle = drop / 9 + spoke * Math.PI / 2;
      const x = 1423 + Math.cos(angle) * 10.5, y = 54 + Math.sin(angle) * 10.5;
      p.box(x, y, 3, 0.8, angle + Math.PI / 2, STEEL);
    }
    for (const x of [1407, 1439]) p.rod(x, 65, x, 227, STEEL, 0.75);
    p.rod(1423, 62, 1423, 66, IRON_D, 1.5); p.disc(1423, 54, 1.4, BRASS_L, INK);
  }
}

function countWater(ctx: Ctx, r: { x0: number; x1: number; y0: number; y1: number }): number {
  let n = 0;
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) if (ctx.world.type(x, y) === Cell.Water) n++;
  return n;
}
