import { describe, expect, test } from 'vitest';
import { StockLedge } from '@/arena/StockLedge';
import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';

function scene(side = 1) {
  let intact = true, ceiling = false;
  const solid = (x: number, y: number) => (intact && (x - 100) * side >= 0 && y >= 100) || (ceiling && y < 100 && y >= 85 && (x - 100) * side >= 0);
  const free = (x: number, y: number) => {
    for (let dx = -PLAYER_HALF_W; dx <= PLAYER_HALF_W; dx++) for (let dy = 0; dy < PLAYER_H; dy++) if (solid(x + dx, y - dy)) return false;
    return true;
  };
  const body = { x: 100 - side * (PLAYER_HALF_W + 2), y: 100 + PLAYER_H - 2, vx: side, vy: 2, grounded: false };
  const keys = { dir: side, up: false, down: false, jump: false };
  const ledge = new StockLedge();
  const step = (canAct = true) => { const next = ledge.step(body, keys, canAct, solid, free); if (next) Object.assign(body, next); return next; };
  return { body, keys, ledge, step, destroy: () => { intact = false; }, roof: () => { ceiling = true; } };
}

describe('stock ledges', () => {
  test.each([-1, 1])('catches the real outside corner and climbs without crossing solid cells, side %i', side => {
    const s = scene(side); expect(s.step()).not.toBeNull(); expect(s.ledge.phase).toBe('hang');
    expect(s.body.x).toBe(100 - side * (PLAYER_HALF_W + 1)); expect(s.body.grounded).toBe(false);
    s.keys.up = true;
    for (let i = 0; i < 30; i++) s.step();
    expect(s.ledge.busy).toBe(false); expect(s.body.grounded).toBe(true); expect(s.body.y).toBe(99);
    expect((s.body.x - 100) * side).toBeGreaterThan(PLAYER_HALF_W);
  });
  test('down drops away and cannot regrab before a real landing', () => {
    const s = scene(); s.step(); s.keys.down = true; const drop = s.step();
    expect(drop?.vx).toBeLessThan(0); expect(s.ledge.busy).toBe(false); expect(s.ledge.airReady).toBe(false);
    s.keys.down = false; s.body.vy = 2; expect(s.step()).toBeNull();
    s.body.grounded = true; s.step(); expect(s.ledge.airReady).toBe(true);
  });
  test('hang expires and its protection lasts only eight ticks', () => {
    const s = scene(); s.step(); let protectedTicks = Number(s.ledge.protected);
    for (let i = 0; i < 50; i++) { s.step(); protectedTicks += Number(s.ledge.protected); }
    expect(protectedTicks).toBe(8); expect(s.ledge.busy).toBe(false); expect(s.ledge.airReady).toBe(false);
  });
  test('destroying the corner drops the fighter immediately', () => {
    const s = scene(); s.step(); s.destroy(); s.step(); expect(s.ledge.busy).toBe(false);
  });
  test('a low ceiling, rising motion, down input, and a combat lock all prevent a catch', () => {
    const s = scene(); s.roof(); expect(s.step()).toBeNull();
    const rising = scene(); rising.body.vy = -1; expect(rising.step()).toBeNull();
    const down = scene(); down.keys.down = true; expect(down.step()).toBeNull();
    const locked = scene(); expect(locked.step(false)).toBeNull();
  });
  test('an interruption releases the ledge without replenishing its aerial budget', () => {
    const s = scene(); s.step(); s.step(false); expect(s.ledge.busy).toBe(false); expect(s.ledge.airReady).toBe(false);
    s.ledge.reset(); expect(s.ledge.airReady).toBe(true);
  });
});
