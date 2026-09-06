import type { Enemy, EnemyDef } from '@/core/types';
import { weaverBodyHit } from '@/creatures/weaverAnatomy';
import type { World } from '@/sim/World';
import { blocksEntity, Cell } from '@/sim/CellType';
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

const chainPositions = new WeakMap<CreatureBody, Float64Array>();

/** Let contact at either end carry tension through the whole animal. The
 * leftover correction belongs to the other node when terrain blocks a move. */
function constrainAquaticLink(world: World, a: BodyNode, b: BodyNode, rest: number, head: boolean): void {
  const dx = b.x - a.x, dy = b.y - a.y, distance = Math.hypot(dx, dy);
  if (distance < .001 || Math.abs(distance - rest) < .005) return;
  const share = head ? .88 : .55, error = (distance - rest) / distance;
  moveNode(world, b, b.x - dx * error * share, b.y - dy * error * share);
  const ax = b.x - a.x, ay = b.y - a.y, remaining = Math.hypot(ax, ay) || 1;
  moveNode(world, a, a.x + ax * (remaining - rest) / remaining, a.y + ay * (remaining - rest) / remaining);
  const bx = b.x - a.x, by = b.y - a.y, final = Math.hypot(bx, by) || 1;
  moveNode(world, b, b.x - bx * (final - rest) / final, b.y - by * (final - rest) / final);
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
export function tickChain(world: World, body: CreatureBody, x: number, y: number, wet: boolean, tick: number, aquatic = false): void {
  const nodes = body.nodes;
  const head = nodes[0];
  if (Math.hypot(head.x - x, head.y - y) > 70) {
    const dx = x - head.x, dy = y - head.y;
    for (const node of nodes) { node.x += dx; node.y += dy; node.previousX += dx; node.previousY += dy; }
  }
  let positions = chainPositions.get(body);
  if (aquatic) {
    if (!positions || positions.length !== nodes.length * 2) { positions = new Float64Array(nodes.length * 2); chainPositions.set(body, positions); }
    for (let i = 0; i < nodes.length; i++) { positions[i * 2] = nodes[i].x; positions[i * 2 + 1] = nodes[i].y; }
  }
  head.previousX = head.x;
  head.previousY = head.y;
  if (aquatic) moveNode(world, head, x, y);
  else { head.x = x; head.y = y; }
  for (let i = 1; i < nodes.length; i++) {
    const node = nodes[i];
    const ahead = nodes[i - 1], dx = ahead.x - node.x, dy = ahead.y - node.y;
    const length = Math.hypot(dx, dy) || 1;
    const speed = Math.hypot(head.x - head.previousX, head.y - head.previousY);
    const immersion = aquatic ? nodeImmersion(world, node.x, node.y, node.radius) : wet ? 1 : 0;
    const wave = Math.sin(tick * .14 - i * .8) * Math.min(.17, .045 + speed * .055) * immersion;
    const currentX = aquatic ? world.flow.x(node.x, node.y) * immersion * .06 : 0;
    const currentY = aquatic ? world.flow.y(node.x, node.y) * immersion * .06 : 0;
    const drag = aquatic ? .72 + immersion * .15 : wet ? .92 : .72;
    const nx = node.x + (node.x - node.previousX) * drag - dy / length * wave + currentX;
    const ny = node.y + (node.y - node.previousY) * .82 + dx / length * wave + (aquatic ? .24 : .2) * (1 - immersion) + currentY;
    node.previousX = node.x;
    node.previousY = node.y;
    moveNode(world, node, nx, ny);
  }
  if (aquatic) {
    for (let pass = 0; pass < 4; pass++) {
      // Reverse first: a tail caught by newly formed ice restrains the head in
      // this tick, instead of stretching one more link every swimming tick.
      for (let i = nodes.length - 1; i > 0; i--) constrainAquaticLink(world, nodes[i - 1], nodes[i], body.spacing, i === 1);
      for (let i = 1; i < nodes.length; i++) constrainAquaticLink(world, nodes[i - 1], nodes[i], body.spacing, i === 1);
    }
    // Conflicting contacts in a narrow crevice may have no feasible solution.
    // Keep the previous pose and discard that impulse; never accumulate strain.
    const previousValid = nodes.every((_node, i) => i === 0 || Math.hypot(positions![i * 2] - positions![(i - 1) * 2], positions![i * 2 + 1] - positions![(i - 1) * 2 + 1]) <= body.spacing * 1.06);
    if (previousValid && nodes.some((node, i) => i > 0 && Math.hypot(node.x - nodes[i - 1].x, node.y - nodes[i - 1].y) > body.spacing * 1.06)) {
      for (let i = 0; i < nodes.length; i++) {
        const node = nodes[i];
        node.x = node.previousX = positions![i * 2]; node.y = node.previousY = positions![i * 2 + 1];
      }
    }
    return;
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

export function nodeImmersion(world: World, x: number, y: number, radius = 3): number {
  let count = 0;
  for (let dy = -radius; dy <= radius; dy += radius) {
    const xx = Math.floor(x), yy = Math.floor(y + dy);
    if (world.inBounds(xx, yy) && (world.type(xx, yy) === Cell.Water || world.type(xx, yy) === Cell.Blood)) count++;
  }
  return count / 3;
}

/** Shared body hit geometry for projectiles/material splashes. */
export function pointHitsCreature(enemy: Enemy, def: EnemyDef, x: number, y: number, padding = 0): boolean {
  if (enemy.kind === 'weaver' && enemy.weaverLoco) return weaverBodyHit(enemy, x, y, padding);
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
