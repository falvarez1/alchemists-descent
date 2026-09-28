import type { Ctx, RigidBody } from '@/core/types';
import { Cell } from '@/sim/CellType';

type EnergyContext = Pick<Ctx, 'world' | 'rigidBodies'>;
type Terminal = { x: number; y: number };

/** A linear induction coil: a descending metal armature supplies the work.
 * The voltage has game units; generator drag always opposes the input motion.
 * A stationary weight or a missing terminal cannot create current. */
export function generateFromDrop(ctx: EnergyContext, body: RigidBody, terminal: Terminal, minY: number, maxY: number): number {
  if (body.material !== 'metal' || body.y < minY || body.y > maxY || body.vy <= .02
    || ctx.world.type(terminal.x, terminal.y) !== Cell.Metal) return 0;
  const voltage = Math.min(1800, Math.floor(body.vy * 3200));
  const index = ctx.world.idx(terminal.x, terminal.y);
  ctx.world.setChargeAt(index, Math.max(ctx.world.charge[index], voltage));
  ctx.rigidBodies.applyImpulse(body, 0, -Math.min(.06, body.vy * .15));
  return voltage;
}

/** A powered solenoid attracts an iron armature along its existing guide.
 * Reads current at the coil, so severed wires and discharged coils stop it. */
export function attractElectromagnet(ctx: EnergyContext, body: RigidBody, terminal: Terminal, radius = 80): void {
  if (body.material !== 'metal' || ctx.world.type(terminal.x, terminal.y) !== Cell.Metal) return;
  const charge = ctx.world.charge[ctx.world.idx(terminal.x, terminal.y)];
  const dx = terminal.x - body.x, dy = terminal.y - body.y, distance = Math.hypot(dx, dy);
  if (charge < 20 || distance < 1 || distance > radius) return;
  const impulse = .18 * Math.min(1, charge / 220) * (1 - distance / radius);
  ctx.rigidBodies.applyImpulse(body, dx / distance * impulse, dy / distance * impulse);
}
