import type { Ctx, Enemy, TrickshotRuntime } from '@/core/types';

function runtime(ctx: Ctx): TrickshotRuntime {
  return ctx.fx.trickshot ??= { remainingMs: 0, elapsedMs: 0, scale: 1, chainMs: 0, chain: 0,
    seen: new Set(), label: '', labelMs: 0, continuousMs: 0, recoveryMs: 0 };
}

/** Presentation time owns the short dramatic beat. Pausing never spends it,
 * and the material/AI/physics systems still take unchanged fixed-size ticks. */
export function advanceTrickshotClock(ctx: Ctx, elapsedMs: number): number {
  if (!ctx.state.trickshot?.enabled || ctx.player.dead || ctx.state.mode !== 'play') {
    ctx.fx.trickshot = undefined; return 1;
  }
  const r = ctx.fx.trickshot;
  if (!r) return 1;
  if (ctx.state.paused || ctx.time?.manual) return 1;
  const dt = Math.max(0, Math.min(100, elapsedMs));
  r.remainingMs = Math.max(0, r.remainingMs - dt); r.elapsedMs += dt;
  r.labelMs = Math.max(0, r.labelMs - dt); r.chainMs = Math.max(0, r.chainMs - dt);
  r.recoveryMs = Math.max(0, r.recoveryMs - dt);
  if (r.chainMs === 0) { r.chain = 0; r.seen.clear(); }
  if (r.remainingMs > 0) {
    r.continuousMs += dt;
    if (r.continuousMs >= 4000) { r.remainingMs = 0; r.recoveryMs = 600; }
  } else r.continuousMs = 0;
  const envelope = Math.min(1, r.elapsedMs / 75, r.remainingMs / 180);
  return 1 - (1 - r.scale) * Math.max(0, envelope);
}

export function recordTrickshot(ctx: Ctx, enemy: Enemy, kind: 'hit' | 'kill' | 'sever' | 'finish'): void {
  const settings = ctx.state.trickshot;
  if (!settings?.enabled || ctx.player.dead || ctx.state.mode !== 'play') return;
  const r = runtime(ctx), fresh = !r.seen.has(enemy);
  if (!fresh && kind === 'hit') return; // one victim cannot farm a chain
  if (fresh) { r.seen.add(enemy); r.chain++; }
  r.chainMs = settings.chainWindowMs;
  const dramatic = kind !== 'hit' || r.chain >= 2;
  r.label = kind === 'finish' ? 'RETURNED WITH INTEREST' : kind === 'sever' ? 'LEG ON LOAN' : r.chain > 1 ? `${r.chain} TARGET CHAIN` : 'CLEAN HIT';
  r.labelMs = kind === 'finish' ? 2100 : 1100;
  if (dramatic && r.recoveryMs === 0) {
    r.remainingMs = Math.max(r.remainingMs, settings.durationMs * (kind === 'finish' ? 1.35 : 1));
    r.elapsedMs = 0;
    r.scale = kind === 'finish' ? Math.max(.2, settings.timeScale * .75) : settings.timeScale;
  }
  ctx.telemetry.count(`trickshot.${kind}`);
}

export function canHumiliate(ctx: Ctx, enemy: Enemy): boolean {
  const owner = ctx.player.legClub?.owner;
  return ctx.state.trickshot?.enabled === true && enemy.kind === 'weaver' && enemy.hp > 0 &&
    enemy.hp <= Math.min(40, enemy.maxHp * .3) && !!owner && owner === enemy.weaverSalvageId;
}
