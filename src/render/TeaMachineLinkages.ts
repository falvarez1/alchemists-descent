import type { Ctx } from '@/core/types';
import type { PixelSurface } from '@/render/pixels';
import { TEA, TEA_VALVES, type TeaValve } from '@/world/teaMachine';
import { Cell } from '@/sim/CellType';

type Point = readonly [number, number];
type Color = readonly [number, number, number];
const BRASS: Color = [.83, .65, .31], STEEL: Color = [.64, .73, .74], SHADOW: Color = [.09, .12, .13];

/** Mechanical drawings follow the same solver poses and plate travel as the
 * real mechanism. Idle wheels never spin just because a stage is active. */
export function drawTeaLinkages(out: PixelSurface, ctx: Ctx): void {
  const s = ctx.levels.current?.living?.tea;
  if (!s) return;
  const dot = (x: number, y: number, color: Color): void => out.setPx(Math.round(x), Math.round(y), ...color);
  const line = (a: Point, b: Point, color = BRASS, phase?: number): void => {
    const length = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]));
    // Outline the whole run first. Outlining each individual point would
    // erase its neighbour's bright centre, making long cables almost black.
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i <= length; i++) {
      const t = length ? i / length : 0, x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
      if (pass === 0) {
        dot(x - 1, y, SHADOW); dot(x + 1, y, SHADOW); dot(x, y - 1, SHADOW); dot(x, y + 1, SHADOW);
      } else dot(x, y, phase === undefined || ((i + Math.floor(phase)) % 5 + 5) % 5 < 3 ? color : [.3, .33, .3]);
    }
  };
  const wheel = (x: number, y: number, r: number, travel: number): void => {
    for (let a = 0; a < Math.PI * 2; a += .08) {
      dot(x + Math.cos(a) * (r + 1), y + Math.sin(a) * (r + 1), SHADOW);
      dot(x + Math.cos(a) * r, y + Math.sin(a) * r, BRASS);
    }
    for (let n = 0; n < 4; n++) {
      const a = travel / r + n * Math.PI / 2;
      line([x, y], [x + Math.cos(a) * (r - 2), y + Math.sin(a) * (r - 2)]);
    }
    dot(x, y, [.98, .9, .62]);
  };
  const cable = (points: readonly Point[], stroke: number, color = BRASS): void => {
    let phase = stroke;
    for (let i = 1; i < points.length; i++) {
      line(points[i - 1], points[i], color, phase);
      phase += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    }
    for (let i = 1; i < points.length - 1; i++) wheel(...points[i], 5, stroke);
  };
  const valve = (key: TeaValve): Point => {
    const { plate, dx, dy, max } = TEA_VALVES[key], travel = s.travel?.[key] ?? 0;
    const x = plate.x + travel * dx, y = plate.y + travel * dy;
    if (dy) for (const gx of [plate.x - 2, plate.x + plate.w + 1]) {
      line([gx, plate.y - max - 3], [gx, plate.y + plate.h + 1], STEEL);
      for (let yy = plate.y - max; yy <= plate.y; yy += 4) dot(gx + (gx < plate.x ? -1 : 1), yy, BRASS);
    }
    for (let yy = 0; yy < plate.h; yy++) for (let xx = 0; xx < plate.w; xx++) {
      if (xx > 0 && xx < plate.w - 1 && yy > 0 && yy < plate.h - 1) continue;
      if (ctx.world.type(x + xx, y + yy) === Cell.Metal) dot(x + xx, y + yy, BRASS);
    }
    const eye: Point = dy ? [x + Math.floor(plate.w / 2), y - 2] : [x + plate.w + 1, y + Math.floor(plate.h / 2)];
    dot(...eye, [.98, .9, .62]); return eye;
  };
  wheel(430, 300, 9, s.stage > 0 ? 10 : 0);
  line([430, 300], [441, 287]); line([441, 98], [464, 98]); line([464, 98], [465, 90], STEEL);
  const bodies = ctx.rigidBodies.bodies, rocker = bodies.find(b => b.tag === 'tea-rocker');
  const domino = bodies.find(b => b.tag === 'tea-domino-5'), springEye = valve('spring');
  if (domino) cable([[domino.x + Math.sin(domino.angle) * 10, domino.y - Math.cos(domino.angle) * 10],
    [802, 136], [820, 136], [820, 180], [845, 180], springEye], s.travel?.spring ?? 0);
  const waterEye = valve('water');
  if (rocker) {
    const end: Point = [rocker.x + Math.cos(rocker.angle) * 17, rocker.y + Math.sin(rocker.angle) * 17];
    cable([end, [855, 211], [923, 211], [923, 154], waterEye], s.travel?.water ?? 0);
    line([rocker.x - 7, rocker.y + 9], [rocker.x, rocker.y], STEEL); line([rocker.x, rocker.y], [rocker.x + 7, rocker.y + 9], STEEL);
    // The preloaded spiral relaxes as the actual spring crank turns.
    for (let a = 0; a <= Math.PI * 5; a += .045) {
      const r = 2 + a * .38, turn = a + rocker.angle;
      dot(rocker.x + Math.cos(turn) * r, rocker.y + Math.sin(turn) * r, BRASS);
    }
    dot(rocker.x, rocker.y, [.98, .9, .62]);
  }
  for (const b of bodies) if (b.tag?.startsWith('tea-domino-')) {
    const c = Math.cos(b.angle), sin = Math.sin(b.angle);
    const p = (x: number, y: number): Point => [b.x + x * c - y * sin, b.y + x * sin + y * c];
    line(p(-1, 0), p(1, 0), SHADOW);
    for (const y of [-6, -3, 4, 7]) dot(...p(0, y), SHADOW);
  }
  const duck = bodies.find(b => b.tag === 'tea-duck'), acidEye = valve('acid');
  if (duck) {
    for (const x of [946, 988]) line([x, 183], [x, 237], STEEL);
    line([946, duck.y + 3], [988, duck.y + 3], STEEL);
    for (const x of [946, 988]) { line([x - 2, duck.y], [x + 2, duck.y]); line([x - 2, duck.y + 6], [x + 2, duck.y + 6]); }
    // Down first: the rising float lengthens this leg and lifts the far gate.
    cable([[967, duck.y + 5], [967, 250], [1080, 250], [1080, 45], [1105, 45], acidEye], s.travel?.acid ?? 0, STEEL);
  }
  const sugar = bodies.find(b => b.tag === 'tea-sugar'), lavaEye = valve('lava');
  if (sugar) {
    line([sugar.x - 7, sugar.y - 5], [sugar.x - 5, sugar.y + 7], STEEL);
    line([sugar.x - 5, sugar.y + 7], [sugar.x + 5, sugar.y + 7], STEEL);
    line([sugar.x + 5, sugar.y + 7], [sugar.x + 7, sugar.y - 5], STEEL);
    cable([[sugar.x, sugar.y - 8], [1164, 39], [1222, 39], lavaEye], s.travel?.lava ?? 0, STEEL);
  }
  const oilEye = valve('oil'), lift = s.travel?.oil ?? 0, piston = bodies.find(b => b.tag === 'tea-piston');
  if (piston) {
    // A fixed-length piston rod pushes a ratcheted collar. The rod can return
    // without stretching or pretending the open oil gate returned with it.
    line([1250, piston.y - 4], [1250, piston.y - 94], STEEL);
    line([1254, 74], [1254, 108], STEEL);
    for (let y = 76; y <= 108; y += 4) line([1254, y], [1257, y]);
    line([1250, 98 - lift], [1254, 98 - lift]);
    line([1250, 98 - lift], [1324, 98 - lift], STEEL);
    line([1324, 98 - lift], oilEye, STEEL);
    cable([[1276, 98 - lift], [1276, 218], [1290, 218]], lift);
    const angle = -.7 + Math.min(1, lift / 10) * 1.1;
    line([1290, 218], [1290 + Math.cos(angle) * 16, 218 + Math.sin(angle) * 16], STEEL);
    wheel(1290, 218, 3, angle * 3);
    line([1285, 227], [1290, 218], BRASS); line([1290, 218], [1295, 227], BRASS);
    line([1304, 227], [1307, 223], [.75, .79, .83]);
  }
  // The copper tea bag slides through a fixed coil. Its leads join the real
  // metal wire; the normal electrical renderer supplies the travelling glow.
  line([1524, 224], [1519, 224], STEEL); line([1519, 224], [1519, 249], STEEL);
  for (let y = 232; y < 251; y += 4) {
    line([1496, y], [1496, y + 2], BRASS); line([1519, y], [1519, y + 2], BRASS);
    line([1496, y + 2], [1519, y - 1], [.67, .38, .16]);
  }
  for (const x of [1386, 1440, 1500]) {
    line([x, 33], [x, 38], STEEL); line([x - 2, 37], [x + 2, 37], STEEL);
  }
  const latch = bodies.find(b => b.tag === 'tea-magnet-latch');
  if (latch) {
    for (const y of [90, 102]) line([1377, y], [1440, y], STEEL);
    for (const x of [1404, 1416, 1428, 1440]) wheel(x, 102, 2, 1423 - latch.x);
    for (let x = 1359; x < 1375; x += 3) line([x, 91], [x, 103], BRASS);
    line([1368, 89], [1368, 91], STEEL);
    const charge = ctx.world.charge[ctx.world.idx(TEA.magnetTerminal.x, TEA.magnetTerminal.y)];
    if (charge >= 20) for (const side of [-1, 1]) {
      for (let t = 0; t <= 1; t += .02) dot(1376 + (latch.x - 15 - 1376) * t,
        96 + Math.sin(t * Math.PI) * side * 6, [.28, .75, .8]);
    }
  }
  const counterweight = bodies.find(b => b.tag === 'tea-counterweight'), bellEye = valve('bell');
  if (counterweight) {
    const movingY = bellEye[1] - 8;
    cable([[counterweight.x, counterweight.y - 12], [1423, 54], [1534, 54], [1534, movingY],
      [1540, 54], [1546, movingY], [1552, 54], [1552, 32]], counterweight.y - 81, STEEL);
    line([1534, movingY + 4], [1546, movingY + 4]); line([1542, movingY + 4], bellEye);
    wheel(1423, 54, 9, counterweight.y - 81); // air-braked winding drum
    for (let spoke = 0; spoke < 4; spoke++) {
      const angle = (counterweight.y - 81) / 9 + spoke * Math.PI / 2;
      const x = 1423 + Math.cos(angle) * 10, y = 54 + Math.sin(angle) * 10;
      line([x - Math.sin(angle) * 3, y + Math.cos(angle) * 3], [x + Math.sin(angle) * 3, y - Math.cos(angle) * 3], STEEL);
    }
    for (const x of [1407, 1439]) line([x, 65], [x, 227], STEEL);
  }
}
