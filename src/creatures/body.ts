import type { Enemy, EnemyDef } from '@/core/types';
import type { World } from '@/sim/World';
import { blocksEntity } from '@/sim/CellType';
import type { BodyNode, CreatureBody } from './types';

export function circleFree(world: World, x: number, y: number, radius: number): boolean {
  for (let dy = -radius; dy <= radius; dy++) {
    const half = Math.sqrt(Math.max(0, radius * radius - dy * dy));
    for (let dx = -half; dx <= half; dx += 1) {
      const xx = Math.floor(x + dx), yy = Math.floor(y + dy);
      if (!world.inBounds(xx, yy) || blocksEntity(world.type(xx, yy))) return false;
    }
  }
  return true;
}

function moveNode(world: World, node: BodyNode, x: number, y: number): void {
  const dx = x - node.x, dy = y - node.y;
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy))));
  node.contact = false;
  for (let step = 0; step < Math.min(steps, 20); step++) {
    const nx = node.x + dx / steps, ny = node.y + dy / steps;
    if (circleFree(world, nx, node.y, node.radius)) node.x = nx;
    else node.contact = true;
    if (circleFree(world, node.x, ny, node.radius)) node.y = ny;
    else node.contact = true;
  }
}

export function createChain(x: number, y: number, facing = 1, count = 9, spacing = 4): CreatureBody {
  return {
    spacing,
    nodes: Array.from({ length: count }, (_, i) => ({
      x: x - facing * i * spacing, y, previousX: x - facing * i * spacing, previousY: y,
      radius: Math.max(1, 3.8 - i * 0.32), contact: false,
    })),
  };
}

/** Position constraints plus swept cell contact; only the head is steered by AI. */
export function tickChain(world: World, body: CreatureBody, x: number, y: number, wet: boolean, tick: number): void {
  const nodes = body.nodes;
  const head = nodes[0];
  if (Math.hypot(head.x - x, head.y - y) > 70) {
    const dx = x - head.x, dy = y - head.y;
    for (const node of nodes) { node.x += dx; node.y += dy; node.previousX += dx; node.previousY += dy; }
  }
  head.previousX = head.x;
  head.previousY = head.y;
  head.x = x;
  head.y = y;
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    const nx = node.x + (node.x - node.previousX) * (wet ? 0.92 : 0.72);
    const ny = node.y + (node.y - node.previousY) * 0.82 + (wet ? Math.sin(tick * 0.12 - i * 0.8) * 0.07 : 0.2);
    node.previousX = node.x;
    node.previousY = node.y;
    moveNode(world, node, nx, ny);
  }
  for (let pass = 0; pass < 4; pass++) {
    for (let i = 1; i < nodes.length; i++) {
      const a = nodes[i - 1], b = nodes[i];
      if (i > 1) {
        const before = nodes[i - 2];
        const bendX = a.x - before.x, bendY = a.y - before.y;
        const bendLength = Math.hypot(bendX, bendY) || body.spacing;
        const targetX = a.x + bendX / bendLength * body.spacing;
        const targetY = a.y + bendY / bendLength * body.spacing;
        moveNode(world, b, b.x + (targetX - b.x) * 0.12, b.y + (targetY - b.y) * 0.12);
      }
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.hypot(dx, dy) || 0.001;
      const correction = (distance - body.spacing) / distance;
      moveNode(world, b, b.x - dx * correction * 0.82, b.y - dy * correction * 0.82);
      if (i > 1) moveNode(world, a, a.x + dx * correction * 0.18, a.y + dy * correction * 0.18);
    }
  }
}

/** Shared body hit geometry for projectiles/material splashes. */
export function pointHitsCreature(enemy: Enemy, def: EnemyDef, x: number, y: number, padding = 0): boolean {
  const nodes = enemy.body?.nodes;
  if (!nodes) return Math.abs(x - enemy.x) <= def.halfW + padding && y >= enemy.y - def.h - padding && y <= enemy.y + padding;
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i], b = nodes[Math.max(0, i - 1)];
    const dx = b.x - a.x, dy = b.y - a.y;
    const lengthSq = dx * dx + dy * dy;
    const t = lengthSq > 0 ? Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / lengthSq)) : 0;
    if (Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= Math.max(a.radius, b.radius) + padding) return true;
  }
  return false;
}
