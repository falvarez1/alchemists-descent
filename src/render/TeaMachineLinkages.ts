import type { Ctx } from '@/core/types';
import type { LightField, PixelSurface } from '@/render/pixels';
import { TEA, TEA_VALVES, type TeaValve } from '@/world/teaMachine';
import { Cell } from '@/sim/CellType';
import { interpolateBody } from '@/render/RenderPoses';
import { BRASS, BRASS_D, BRASS_L, COPPER, INK, IRON, IRON_D, Pen, STEEL, STEEL_D, STEEL_L, cameraView, type RGB, type ViewRect } from '@/render/sprites/FineArt';

type Point = readonly [number, number];

/**
 * Mechanical drawings of the Bell & Tea Engine's linkages: wheels, rods,
 * cables, guides and coils, rasterised at presentation resolution. Every
 * pose comes from the solver's bodies (interpolated between fixed ticks)
 * and the plates' real travel — idle wheels never spin just because a stage
 * is active, and a cable's twist advances only as far as its plate moved.
 * Fixtures take the room's lamps through the light field, clamped so brass
 * never vanishes into a dark corner.
 */
export function drawTeaLinkages(out: PixelSurface, light: LightField, ctx: Ctx, alpha = 1): void {
  const s = ctx.levels.current?.living?.tea;
  if (!s) return;
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

  // The apparatus occupies one inherited workshop, not a row of unrelated
  // toys. Riveted bays, a shared service manifold and stateful gauges bind the
  // causal stages into a single readable silhouette while leaving every real
  // material reservoir and moving body unobscured.
  const bays: ReadonlyArray<readonly [number, number, number, RGB]> = [
    [452, 614, 1, [0.58, 0.34, 0.16]],
    [616, 710, 2, [0.49, 0.44, 0.28]],
    [712, 827, 3, [0.59, 0.45, 0.22]],
    [829, 930, 4, [0.28, 0.52, 0.55]],
    [932, 1084, 5, [0.35, 0.53, 0.48]],
    [1086, 1189, 6, [0.49, 0.56, 0.34]],
    [1191, 1284, 7, [0.67, 0.35, 0.19]],
    [1286, 1350, 8, [0.52, 0.37, 0.23]],
    [1352, 1450, 10, [0.29, 0.54, 0.57]],
    [1452, 1554, 12, [0.65, 0.53, 0.28]],
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
    p.line(x0 + 8, 255, x1 - 8, 255, BRASS_D, .5, .65);
    // The dial is a physical stage witness. Its needle advances only after
    // this bay has actually completed, mirroring the causal state machine.
    const gaugeX = x0 + 14, gaugeY = 52;
    p.disc(gaugeX, gaugeY, 4.2, [0.29, 0.31, 0.28], INK, .7);
    p.arc(gaugeX, gaugeY, 3.1, Math.PI * 1.08, Math.PI * 1.92, STEEL_L, .5, .75);
    const live = Math.min(1, Math.max(0, s.stage - stage + 1));
    const needle = Math.PI * (1.1 + live * .78);
    p.line(gaugeX, gaugeY, gaugeX + Math.cos(needle) * 2.7, gaugeY + Math.sin(needle) * 2.7,
      live > 0 ? accent : STEEL_D, .5);
    p.disc(gaugeX, gaugeY, .7, BRASS_L, INK);
    // Etched station count: a workshop convention rather than floating text.
    for (let mark = 0; mark <= bayIndex % 4; mark++) p.line(x1 - 14 + mark * 2, 50, x1 - 14 + mark * 2, 55, BRASS_D, .5);
    p.disc(x1 - 10, 62, 1.45, live > 0 ? accent : IRON_D, INK);
    if (live > 0) p.glow(x1 - 10, 62, accent, .42 + Math.sin(ctx.state.frameCount * .08 + stage) * .08);
  }
  // Shared copper service line. Its drooping runs and bolted elbows give the
  // eye one continuous route across the machine without pretending to carry
  // any gameplay signal that is not already present in the cells below.
  {
    const p = penAt(995, 41);
    p.cable([[458, 39], [610, 39], [618, 45], [825, 45], [835, 39], [1080, 39],
      [1090, 45], [1280, 45], [1290, 39], [1548, 39]], 0, { color: COPPER, dark: BRASS_D, width: 1, sag: 2 });
    for (const x of [610, 825, 1080, 1280, 1450]) {
      p.ring(x, x % 2 ? 42 : 39, 2.2, .7, BRASS_D);
      p.rivet(x - .5, (x % 2 ? 42 : 39) - .5, BRASS_L);
    }
  }
  // Consequence residue accumulates only after its corresponding process:
  // mineral run-off, acid etch, boiler soot and oil varnish make the route
  // legible even after the fast chain reaction has passed.
  if (s.stage >= 4) {
    const p = penAt(905, 244);
    for (let i = 0; i < 7; i++) p.curve(900 + i * 5, 244, 899 + i * 5, 249, 897 + i * 6, 253,
      i % 2 ? [0.26, 0.48, 0.51] : [0.39, 0.61, 0.57], .5, .75);
  }
  if (s.stage >= 6) {
    const p = penAt(1122, 212);
    for (let i = 0; i < 5; i++) p.curve(1105 + i * 6, 211, 1107 + i * 6, 219,
      1103 + i * 8, 226, [0.37, 0.5, 0.22], .5, .7);
  }
  if (s.stage >= 8) {
    const p = penAt(1275, 223);
    for (let i = 0; i < 12; i++) p.px(1240 + (i * 17) % 62, 223 - (i * 7) % 12,
      i % 3 ? [0.16, 0.14, 0.13] : [0.29, 0.23, 0.16], .65);
  }
  if (s.stage >= 9) {
    const p = penAt(1332, 226);
    for (let i = 0; i < 8; i++) p.curve(1315 + i * 3, 216, 1314 + i * 3, 221,
      1313 + i * 4, 226, [0.24, 0.18, 0.12], .5, .8);
  }

  /** Guide rails and the brass frame over a plate's real metal; returns the cable eye. */
  const valve = (key: TeaValve): Point => {
    const { plate, dx, dy, max } = TEA_VALVES[key], travel = s.travel?.[key] ?? 0;
    const x = plate.x + travel * dx, y = plate.y + travel * dy;
    const p = penAt(plate.x + plate.w / 2, plate.y);
    if (dy) for (const gx of [plate.x - 2, plate.x + plate.w + 1]) {
      p.rod(gx, plate.y - max - 3, gx, plate.y + plate.h + 1, STEEL, 0.75);
      for (let yy = plate.y - max; yy <= plate.y; yy += 4) p.rivet(gx + (gx < plate.x ? -1 : 1), yy, BRASS_L);
    }
    const w = plate.w, h = plate.h;
    let framed = 0;
    for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < w; xx++) if (ctx.world.type(x + xx, y + yy) === Cell.Metal) framed++;
    if (framed > 0) {
      p.line(x, y, x + w - 1, y, BRASS, 0, 1.15);
      p.line(x, y + h - 1, x + w - 1, y + h - 1, BRASS_D);
      p.line(x, y, x, y + h - 1, BRASS); p.line(x + w - 1, y, x + w - 1, y + h - 1, BRASS_D);
      p.rivet(x + 0.5, y + 0.5); p.rivet(x + w - 1.5, y + 0.5); p.rivet(x + 0.5, y + h - 1.5); p.rivet(x + w - 1.5, y + h - 1.5);
    }
    const eye: Point = dy ? [x + w / 2 - 0.5, y - 2] : [x + w + 1, y + h / 2 - 0.5];
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

  // ---- The striker rod: brackets along the real rod, the flint head and its
  // spark while the first act is fresh. The crank itself is the dressed lever.
  {
    const p = penAt(442, 200);
    for (let y = 118; y < 282; y += 34) { p.box(442, y, 2.4, 1.2, 0, IRON_D); p.rivet(440.5, y - 0.5); p.rivet(443.5, y - 0.5); }
    const head = penAt(462, 92);
    head.polygon([[459.5, 96.5], [463.5, 96.5], [464.5, 90], [460, 90.5]], STEEL, 1, 0.3);
    head.line(460, 90.5, 464.5, 90, STEEL_L);
    if (s.stage >= 1 && s.ticks < 40 && ctx.state.frameCount % 3 !== 0) {
      for (let k = 0; k < 4; k++) {
        const a = -Math.PI * (0.2 + k * 0.2) + Math.sin(ctx.state.frameCount * 0.9 + k) * 0.3, r = 2 + ((ctx.state.frameCount * 2 + k * 5) % 9);
        head.glow(465 + Math.cos(a) * r, 90 + Math.sin(a) * r, [1.2, 0.85, 0.35], 0.9);
      }
    }
  }
  // ---- Pendulum anchors: the chain's eye bolt and the hemp cord's cleat.
  {
    const p = penAt(653, 55);
    p.disc(653, 55, 1.8, IRON, INK); p.px(652.5, 54.5, STEEL_L);
    p.box(575, 80, 2, 1, 0.6, IRON_D); p.rivet(574.5, 79.5);
  }

  // ---- Dominoes carry pip markings that turn with each body.
  for (const b of bodies) if (b.tag?.startsWith('tea-domino-')) {
    const pose = interpolateBody(b, alpha), c = Math.cos(pose.angle), sin = Math.sin(pose.angle);
    const at = (x: number, y: number): Point => [pose.x + x * c - y * sin, pose.y + x * sin + y * c];
    const p = penAt(pose.x, pose.y);
    p.line(...at(-1, 0), ...at(1, 0), INK);
    for (const y of [-6, -3, 4, 7]) p.px(...at(0, y), INK);
  }

  // ---- Domino cable withdraws the spring latch.
  const domino = body('tea-domino-5'), springEye = valve('spring');
  if (domino) {
    const top: Point = [domino.px + Math.sin(domino.pa) * 10, domino.py - Math.cos(domino.pa) * 10];
    run([top, [802, 136], [820, 136], [820, 180], [845, 180], springEye], s.travel?.spring ?? 0, 'cable', [1, 2, 3, 4]);
  }
  // ---- The wound spring crank on its A-frame; its cable opens the water gate.
  const rocker = body('tea-rocker'), waterEye = valve('water');
  if (rocker) {
    const p = penAt(rocker.px, rocker.py);
    const end: Point = [rocker.px + Math.cos(rocker.pa) * 17, rocker.py + Math.sin(rocker.pa) * 17];
    run([end, [855, 211], [923, 211], [923, 154], waterEye], s.travel?.water ?? 0, 'cable', [1, 2, 3]);
    p.rod(rocker.px - 7, rocker.py + 9, rocker.px, rocker.py, IRON, 1.2);
    p.rod(rocker.px, rocker.py, rocker.px + 7, rocker.py + 9, IRON_D, 1.2);
    p.box(rocker.px, rocker.py + 9.5, 8, 0.75, 0, IRON);
    // The preloaded spiral relaxes as the actual spring crank turns.
    for (let a = 0; a <= Math.PI * 5; a += 0.045 * p.step * 2) {
      const r = 2 + a * 0.38, turn = a + rocker.pa;
      p.px(rocker.px + Math.cos(turn) * r, rocker.py + Math.sin(turn) * r, a % 0.5 < 0.25 ? BRASS : BRASS_D);
    }
    p.disc(rocker.px, rocker.py, 1.3, BRASS_L, INK);
  }

  // ---- The duck's sliding carriage and the chain it lifts.
  const duck = body('tea-duck'), acidEye = valve('acid');
  if (duck) {
    const p = penAt(967, 210);
    for (const x of [946, 988]) p.rod(x, 183, x, 237, STEEL, 0.75);
    const y = duck.py + 3;
    p.rod(946, y, 988, y, STEEL_D, 0.75);
    for (const x of [946, 988]) { p.box(x, y - 3, 2, 0.9, 0, BRASS); p.box(x, y + 3, 2, 0.9, 0, BRASS); p.rivet(x - 0.5, y - 3.5); }
    // Down first: the rising float lengthens this leg and lifts the far gate.
    run([[967, duck.py + 5], [967, 250], [1080, 250], [1080, 45], [1105, 45], acidEye], s.travel?.acid ?? 0, 'chain', [1, 2, 3, 4]);
  }
  // ---- The sugar's sling and the lava gate it hauls.
  const sugar = body('tea-sugar'), lavaEye = valve('lava');
  if (sugar) {
    const p = penAt(sugar.px, sugar.py);
    p.line(sugar.px - 7, sugar.py - 5, sugar.px - 5, sugar.py + 7, STEEL_D, 0.5);
    p.line(sugar.px - 5, sugar.py + 7, sugar.px + 5, sugar.py + 7, STEEL, 0.5);
    p.line(sugar.px + 5, sugar.py + 7, sugar.px + 7, sugar.py - 5, STEEL_D, 0.5);
    run([[sugar.px, sugar.py - 8], [1164, 39], [1222, 39], lavaEye], s.travel?.lava ?? 0, 'chain', [1, 2]);
  }
  // ---- The steam piston: rod, ratchet rack, crosshead, oil-gate rod and flint striker.
  const oilEye = valve('oil'), lift = s.travel?.oil ?? 0, piston = body('tea-piston');
  if (piston) {
    const p = penAt(1250, 150);
    // A fixed-length piston rod pushes a ratcheted collar. The rod can return
    // without stretching or pretending the open oil gate returned with it.
    p.rod(1250, piston.py - 4, 1250, piston.py - 94, STEEL, 1.5);
    p.rod(1254, 74, 1254, 108, IRON, 1);
    for (let y = 76; y <= 108; y += 4) p.polygon([[1254, y - 0.6], [1257.5, y], [1254, y + 0.6]], BRASS, 1, 0.2);
    p.box(1252, 98 - lift, 2.5, 1.2, 0, BRASS); p.rivet(1251, 97.5 - lift);
    p.rod(1250, 98 - lift, 1324, 98 - lift, STEEL, 1);
    p.rod(1324, 98 - lift, oilEye[0], oilEye[1], STEEL, 0.75);
    run([[1276, 98 - lift], [1276, 218], [1290, 218]], lift, 'cable', [1]);
    const angle = -0.7 + Math.min(1, lift / 10) * 1.1;
    const q = penAt(1290, 218);
    q.rod(1290, 218, 1290 + Math.cos(angle) * 16, 218 + Math.sin(angle) * 16, STEEL, 1);
    q.polygon([[1290 + Math.cos(angle) * 16, 218 + Math.sin(angle) * 16], [1290 + Math.cos(angle + 0.25) * 18.5, 218 + Math.sin(angle + 0.25) * 18.5], [1290 + Math.cos(angle - 0.1) * 19, 218 + Math.sin(angle - 0.1) * 19]], STEEL_L);
    q.wheel(1290, 218, 3, angle * 3, { spokes: 4, rimWidth: 1 });
    q.rod(1285, 227, 1290, 218, BRASS, 0.75); q.rod(1290, 218, 1295, 227, BRASS_D, 0.75);
    q.polygon([[1303, 227.5], [1306, 227.5], [1307.5, 222.5], [1304.5, 223]], [0.75, 0.79, 0.83], 1, 0.3);
  }
  // ---- The copper tea bag slides through a fixed coil. Its leads join the real
  // metal wire; the normal electrical renderer supplies the travelling glow.
  {
    const p = penAt(1507, 240);
    p.rod(1524, 224, 1519, 224, STEEL, 0.5); p.rod(1519, 224, 1519, 249, STEEL, 0.5);
    for (let y = 232; y < 251; y += 2) {
      p.line(1496, y + 1, 1519, y - 0.5, COPPER, 0.5, y % 4 === 0 ? 1.15 : 0.8);
    }
    p.rod(1496, 231, 1496, 251, BRASS_D, 0.75); p.rod(1519, 231, 1519, 251, BRASS_D, 0.75);
    for (const x of [1386, 1440, 1500]) {
      const q = penAt(x, 36);
      q.rod(x, 33, x, 38, STEEL, 0.5); q.box(x, 37, 2, 0.6, 0, STEEL_D); q.disc(x, 34, 0.9, [0.85, 0.85, 0.9], INK);
    }
  }
  // ---- The electromagnet, its roller guides and the iron latch they carry.
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
      const pulse = 0.7 + Math.sin(ctx.state.frameCount * 0.35 + side) * 0.3;
      for (let t = 0; t <= 1; t += 0.02 * p.step * 2) {
        p.raw(1376 + (latch.px - 15 - 1376) * t, 96 + Math.sin(t * Math.PI) * side * 6, [0.28, 0.75, 0.8], pulse);
      }
    }
  }
  // ---- The air-braked winding drum and the four pulley strands to the bell latch.
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
