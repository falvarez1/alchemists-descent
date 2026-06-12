import type { Ctx } from '@/core/types';
import { grantFullReviewKit } from '@/entities/Player';

function isTextEntry(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return target.isContentEditable || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Backquote is the reserved QA console key. Today it grants the review kit;
 * later this class can own the visible console and typed command dispatch.
 */
export class DebugConsole {
  private enabled = false;

  constructor(private readonly ctx: Ctx) {
    window.addEventListener('keydown', (e) => this.onKeyDown(e));
  }

  private onKeyDown(e: KeyboardEvent): void {
    if (e.repeat || e.code !== 'Backquote' || isTextEntry(e.target)) return;
    if (this.ctx.state.mode !== 'play') return;

    e.preventDefault();
    e.stopImmediatePropagation();
    this.enableGodMode();
  }

  private enableGodMode(): void {
    const ctx = this.ctx;
    ctx.audio.ensure();
    if (ctx.levels.current === null) ctx.levels.startDescent(ctx);

    ctx.state.debugGodMode = true;
    const wasDead = ctx.player.dead;
    ctx.player.dead = false;
    grantFullReviewKit(ctx.player);
    ctx.player.invuln = Math.max(ctx.player.invuln, 90);
    ctx.wands.grantReviewLoadout();
    ctx.levels.seedReviewKit(ctx);

    if (wasDead) ctx.events.emit('playerRespawned');
    ctx.events.emit('toast', {
      text: this.enabled ? 'GOD MODE REFRESHED' : 'GOD MODE ENABLED',
    });
    this.enabled = true;
  }
}
