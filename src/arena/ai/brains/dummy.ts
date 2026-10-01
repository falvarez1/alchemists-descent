import type { Ctx } from '@/core/types';
import { blankStatus } from '@/arena/ai/brain';
import type { Brain, BrainOptions, BrainSelf, BrainStatus } from '@/arena/ai/brain';
import { Hand } from '@/arena/ai/control';
import { SHOULDER } from '@/arena/ai/worldView';
import type { AiLevel } from '@/config/aiTiers';

/**
 * THE DUMMY (v0, docs/arena/AI-FIGHTERS.md 7): a computer fighter that stands where it is, turns to face the nearest foe
 * (the cursor is the facing), and presses Z every 4 s and T every 9 s whether or not that is wise. It is the first proof of
 * the input seam, and a fine sparring partner: an opponent that never moves, never shoots and never dodges.
 */

const Z_EVERY = 240;
const T_EVERY = 540;

export class DummyBrain implements Brain {
  readonly id = 'dummy' as const;
  level: AiLevel;
  readonly status: BrainStatus = blankStatus();
  private hand: Hand | null = null;

  constructor(opts: BrainOptions) {
    this.level = opts.level;
  }

  reset(): void {
    this.hand?.release();
    Object.assign(this.status, blankStatus());
  }

  think(ctx: Ctx, self: BrainSelf, tick: number): void {
    const hand = (this.hand ??= new Hand(self));
    hand.begin();
    const p = self.player;
    const st = this.status;
    if (p.dead) {
      hand.release();
      st.intent = 'idle';
      hand.end();
      return;
    }
    // the nearest foe on screen (the dummy sees what anyone sees; v0 has no memory and no reaction time)
    let near: { x: number; y: number; d: number; kind: string } | null = null;
    const defs = ctx.enemyCtl.defs;
    for (const e of ctx.enemies) {
      if (e.hp <= 0) continue;
      const h = defs[e.kind]?.h ?? 10;
      const dx = e.x - p.x;
      const dy = e.y - h * 0.5 - (p.y - SHOULDER);
      const d = Math.hypot(dx, dy);
      if (d < 420 && (near === null || d < near.d)) near = { x: e.x, y: e.y - h * 0.5, d, kind: e.kind };
    }
    if (near) {
      hand.aim(near.x, near.y);
      st.intent = 'idle';
      st.target = `${near.kind} ${Math.round(near.d)}`;
      st.aim = { x: near.x, y: near.y };
    } else {
      st.target = '-';
      st.aim = null;
    }
    st.goalX = null;
    st.range = 0;
    const view = self.fighters?.view;
    if (view && tick % Z_EVERY === Z_EVERY - 1) {
      self.hands.press('tactical');
      hand.pressed();
      st.rule = view.tactical.ready ? 'Z on the timer' : `Z on the timer (${view.tactical.cooldownSeconds}s cooling)`;
    }
    if (view && tick % T_EVERY === T_EVERY - 1) {
      self.hands.press('ultimate');
      hand.pressed();
      st.rule = view.ultimate.ready ? 'T on the timer' : 'T on the timer (not charged)';
    }
    hand.end();
    st.idleTicks = hand.idle;
  }
}
