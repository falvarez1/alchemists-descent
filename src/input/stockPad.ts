import type { Ctx } from '@/core/types';
import type { readVersusPad } from '@/input/versusDevices';

/** One layout for the player-facing Duel and authoring Arena, under the acting slot's binding. */
export function applyStockPad(ctx: Ctx, action: ReturnType<typeof readVersusPad>): void {
  const { input, player } = ctx;
  Object.assign(input.keys, { left: action.left, right: action.right, up: action.up, down: action.down, jump: action.jump, wallJump: action.jump, grab: false });
  if (action.jumpPressed) input.queuedJump = 'wall';
  input.shieldHeld = action.defense;
  if ((action.defensePressed && (!player.grounded || action.left || action.right || action.down)) || action.dodgeDirection) input.queuedDodge = true;
  const dir = action.left ? -1 : action.right ? 1 : player.facing;
  input.mouse.x = player.x + dir * 130; input.mouse.y = player.y - 10;
  input.pourHeld = input.siphonHeld = input.drinkHeld = false;
  if (!action.special) player.fireBlockedUntilRelease = false;
  player.firing = action.special && !action.up && !action.down && !player.fireBlockedUntilRelease;
  if (action.specialPressed && player.firing) player.firePressed = true;
  if (action.specialPressed && action.up) input.queuedRecovery = true;
  if (action.specialPressed && action.down) ctx.fighters?.press('tactical');
  if (action.grab) ctx.arena?.requestStockGrab();
  else if (action.smash) ctx.arena?.requestStockAttack(action.smash === 'up' ? 'launcher' : 'finisher', action.smash === 'left' ? -1 : action.smash === 'right' ? 1 : dir);
  else if (action.attack) ctx.playerCtl.kick(ctx);
}
