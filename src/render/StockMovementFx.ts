import { FIGHTER_DEFS } from '@/content/fighters';
import type { Ctx } from '@/core/types';
import { makeSkeleton, poseAlchemist } from '@/entities/playerPose';
import type { V } from '@/entities/playerPose';
import type { PixelSurface } from '@/render/pixels';
import { drawDuelGhost } from '@/render/duel/DuelFighterSprites';

const pose = makeSkeleton();

/** Narrow motion accents from concepts/motion-defense.png, tied to real action state. */
export function drawStockMovementFx(out: PixelSurface, ctx: Ctx): void {
  const arena = ctx.arena, p = ctx.player;
  if (!arena?.stockMatch || p.dead) return;
  const dodge = arena.stockDodge(arena.bound), recovering = arena.isRecovering(arena.bound);
  const shield = arena.stockShield(arena.bound);
  const grab = arena.stockGrab(arena.bound);
  if (!dodge?.busy && !shield?.busy && !grab?.busy && !recovering && !arena.isLaunching(arena.bound) && !p.stockFastFall) return;
  const id = ctx.fighters?.id;
  const hex = Number.parseInt((id ? FIGHTER_DEFS[id].accent : '#65cac5').slice(1), 16);
  const color = [(hex >> 16 & 255) / 255, (hex >> 8 & 255) / 255, (hex & 255) / 255];
  const quiet = ctx.state.reduceFlashes === true;
  if (shield?.guarding) {
    const fraction = shield.strength / 100, radius = 10 + 4 * fraction;
    const low = fraction < .3, r = low ? 1 : .28, g = low ? .64 : .84, b = low ? .22 : .78;
    const guardDot = (x: number, y: number, alpha: number): void => {
      if (out.blendFinePx) out.blendFinePx(x, y, r * alpha, g * alpha, b * alpha, alpha);
      else out.addPx(x, y, r * alpha, g * alpha, b * alpha);
    };
    // A thin complete ring reads as defense; depletion breaks the ring into amber dashes.
    for (let i = 0; i < 160; i++) {
      if (low && i % 16 > 10) continue;
      const angle = i / 160 * Math.PI * 2;
      const x = p.x + Math.cos(angle) * radius, y = p.y - 11 + Math.sin(angle) * (radius + 3);
      const alpha = quiet ? .4 : .72;
      guardDot(x, y, alpha);
      if (!low && i % 40 < 20) guardDot(p.x + Math.cos(angle) * (radius - 1.7), p.y - 11 + Math.sin(angle) * (radius + 1.3), alpha * .35);
    }
    if (!low) for (const angle of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) {
      const x = p.x + Math.cos(angle) * radius, y = p.y - 11 + Math.sin(angle) * (radius + 3);
      for (let i = -1.5; i <= 1.5; i += .5) {
        guardDot(x + i, y + Math.abs(i) - 1.5, quiet ? .4 : .9);
        guardDot(x + i, y - Math.abs(i) + 1.5, quiet ? .4 : .9);
      }
    }
  }
  const dot = (x: number, y: number, alpha: number, ivory = false): void => {
    const r = ivory ? .93 : color[0], g = ivory ? .85 : color[1], b = ivory ? .67 : color[2];
    if (out.blendFinePx) {
      out.blendFinePx(x, y, r * alpha, g * alpha, b * alpha, alpha);
      if (!quiet) out.blendFinePx(x + .5, y, r * alpha, g * alpha, b * alpha, alpha);
    }
    else out.addPx(x, y, r * alpha, g * alpha, b * alpha);
  };
  const line = (a: V, b: V, dx: number, dy: number, alpha: number): void => {
    const count = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2));
    for (let i = 0; i <= count; i++) {
      const x = a.x + (b.x - a.x) * i / count + dx, y = a.y + (b.y - a.y) * i / count + dy;
      dot(x, y, alpha); dot(x + .5, y, alpha);
    }
  };
  if (grab?.phase === 'active' || grab?.phase === 'hold') {
    for (let i = -1; i <= 1; i++) dot(p.x + grab.facing * 14 + i, p.y - 12 + Math.abs(i), quiet ? .3 : .65, true);
  }
  if (grab?.phase === 'recovery' && (grab.throwX || grab.throwY) && grab.age < 8) {
    const fade = (1 - grab.age / 8) * (quiet ? .3 : .7);
    for (let i = 0; i < 24; i++) {
      const t = i / 23, x = p.x + grab.throwX * (8 + t * 18), y = p.y - 12 + grab.throwY * t * 18 - Math.sin(t * Math.PI) * 5;
      dot(x, y, fade * (1 - t * .6), true);
    }
  }
  const shadow = (x: number, y: number, rx: number, ry: number, alpha: number): void => {
    for (let py = -ry; py <= ry; py += .5) for (let px = -rx; px <= rx; px += .5) {
      if (px * px / (rx * rx) + py * py / (ry * ry) > 1) continue;
      const r = (.17 + color[0] * .18) * alpha, g = (.22 + color[1] * .16) * alpha, b = (.25 + color[2] * .18) * alpha;
      if (out.blendFinePx) out.blendFinePx(x + px, y + py, r, g, b, alpha);
      else out.addPx(x + px, y + py, r, g, b);
    }
  };
  if (p.stockFastFall) for (const side of [-1, 1]) for (let i = 0; i < (quiet ? 5 : 12); i++) dot(p.x + side * 7, p.y - 18 - i, .5 * (1 - i / 12), true);
  if (dodge?.phase === 'startup') {
    for (let i = -2; i <= 2; i++) { dot(p.x + i, p.y - 24 + Math.abs(i), .8); dot(p.x + i, p.y - 20 - Math.abs(i), .8); }
  }
  if (dodge?.phase === 'evade') {
    // Echoes: two see-through copies of the fighter's own sprite trailing the dodge (the rig's silhouettes otherwise).
    const ghosts = !quiet && [2, 4].map(n => drawDuelGhost(out, ctx, -dodge.vx * n, -dodge.vy * n, n === 2 ? .38 : .2, color as [number, number, number])).every(Boolean);
    if (!quiet && !ghosts) {
      const s = poseAlchemist(ctx, p, pose);
      for (const n of [2, 4]) {
        const dx = -dodge.vx * n, dy = -dodge.vy * n;
        const alpha = n === 2 ? .22 : .11;
        for (const [a, b] of [[s.head, s.neck], [s.neck, s.hip], [s.chest, s.backElbow], [s.backElbow, s.backHand], [s.chest, s.frontHand], [s.hip, s.backKnee], [s.backKnee, s.backFoot], [s.hip, s.frontKnee], [s.frontKnee, s.frontFoot]]) line(a, b, dx, dy, alpha);
        const shade = n === 2 ? .55 : .3;
        shadow(s.head.x + dx, s.head.y + dy, 2.4, 2.6, shade);
        shadow((s.chest.x + s.hip.x) / 2 + dx, (s.chest.y + s.hip.y) / 2 + dy, id === 'brann-rook' ? 3.6 : 2.7, 4.8, shade);
        if (id === 'ilyra-voss') {
          shadow(s.head.x + dx, s.head.y - 2 + dy, 4.8, .65, shade);
          shadow(s.head.x - s.facing + dx, s.head.y - 3.3 + dy, 2, 1.3, shade);
        }
        if (id === 'brann-rook') shadow(s.chest.x + s.facing * 4 + dx, s.chest.y + 2 + dy, 1.2, 6.2, shade);
        if (id === 'mara-quell') shadow(s.hip.x - s.facing * 2 + dx, s.hip.y + 2 + dy, 3.5, 4.1, shade);
      }
    }
    // A broken arc marks evasion; never a bubble that could be mistaken for a shield.
    if (dodge.evading) for (let i = 0; i < 25; i++) {
      if (i % 8 === 7) continue;
      const angle = Math.PI * (1.03 + i / 32);
      dot(p.x + Math.cos(angle) * 10, p.y - 8 + Math.sin(angle) * 13, quiet ? .35 : .8, true);
    }
  }
  if (dodge?.phase === 'recovery') for (let i = -2; i <= 2; i++) dot(p.x + i, p.y + 2, .45, true);
  if (recovering || arena.isLaunching(arena.bound)) {
    const speed = Math.hypot(p.vx, p.vy) || 1;
    const dx = -p.vx / speed, dy = -p.vy / speed;
    const count = quiet ? 5 : 20;
    for (let i = 2; i < count; i++) {
      if (i % 5 === 0) continue;
      const offset = Math.sin(i * 1.7) * 2;
      dot(p.x + dx * i * 1.5 - dy * offset, p.y - 7 + dy * i * 1.5 + dx * offset, (1 - i / count) * .8);
    }
  }
}
