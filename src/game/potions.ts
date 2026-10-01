import { addElixirFrames, effectFrames, elixirDef, POTION_CAP_FRAMES } from '@/content/elixirs';
import { entityRandom } from '@/core/simRandom';
import type { Ctx } from '@/core/types';
import { Cell } from '@/sim/CellType';
import { COLOR_FN } from '@/sim/colors';

/**
 * DRINKING (X held): the flask swallows its real cells. An elixir loads its effect
 * (content/elixirs: each cell is worth so many frames, the cup holds POTION_CAP_FRAMES
 * at most and refuses more rather than waste a cell); water soaks you from the inside
 * and puts you out; anything else will not go down.
 *
 * A potion goes down a cell every SIP_EVERY frames, so holding X for a moment is a
 * dose you can measure and let go of; water keeps its old two cells a frame.
 */
const SIP_EVERY = 2;
/** The "cup is full" line, at most this often (frames). */
const FULL_TOAST_FRAMES = 90;
let lastFullToast = -9999;

export function drinkFlask(ctx: Ctx): void {
  const s = ctx.flask.state;
  const st = ctx.player.status;
  if (s.material === null || s.count === 0) return;
  const m = s.material;
  const def = elixirDef(m);
  if (def === undefined && m !== Cell.Water) return;

  if (def !== undefined) {
    if (ctx.state.frameCount % SIP_EVERY !== 0) return;
    if (effectFrames(st, def.effect) >= POTION_CAP_FRAMES) {
      // Full to the brim: the cell stays in the flask.
      if (ctx.state.frameCount - lastFullToast > FULL_TOAST_FRAMES) {
        lastFullToast = ctx.state.frameCount;
        ctx.events.emit('toast', { text: `${def.chip.label}: AS STRONG AS IT GETS` });
      }
      return;
    }
    addElixirFrames(st, def, def.framesPerCell);
    if (!ctx.state.debugGodMode) {
      s.count -= 1;
      if (s.count === 0) s.material = null;
    }
    // A mote of the draught lifts off the drinker, in its own colour.
    const p = ctx.player;
    ctx.particles.spawn(p.x + (entityRandom() - 0.5) * 6, p.y - 15, (entityRandom() - 0.5) * 0.3, -0.5 - entityRandom() * 0.3,
      null, COLOR_FN[m](), 24, { grav: -0.01, glow: 1.4 });
    if (ctx.state.frameCount % 10 === 0) ctx.audio.sfx('player.drink');
    ctx.telemetry.count('potion.sip.' + def.chip.label.toLowerCase());
    ctx.events.emit('flaskUsed', { verb: 'drink', material: m, amount: 1 });
    return;
  }

  // Water: soaks you from the inside and puts you out (unchanged).
  const sips = Math.min(2, s.count);
  st.wet = 120;
  st.burning = 0;
  if (!ctx.state.debugGodMode) {
    s.count -= sips;
    if (s.count === 0) s.material = null;
  }
  if (ctx.state.frameCount % 10 === 0) ctx.audio.sfx('player.drink');
  ctx.events.emit('flaskUsed', { verb: 'drink', material: m, amount: sips });
}
