// ===================== Wave Director =====================
// Ported from noita-sandbox.html lines 2156-2203 (startWave / updateWaves).
// DOM writes (wave-num, enemies-left, showBanner) become events on ctx.events;
// the UI layer subscribes and renders them.

import { VIEW_W, WIDTH } from '@/config/constants';
import { clamp } from '@/core/math';
import type { Ctx, WaveDirectorApi, WaveState } from '@/core/types';

/**
 * Fresh wave state for a new game.
 *
 * Original boot value (line 2157) was `intermission: 60`, but updateWaves
 * early-exits outside play mode, and the first entry into play mode
 * (setMode, original line 4026) always resets intermission to 150 before the
 * countdown can ever tick — the 60 here matches the original literal at line
 * 2157 and is never consumed in practice.
 */
export function createWaveState(): WaveState {
  return { num: 0, active: false, intermission: 60, kills: 0 };
}

export class WaveDirector implements WaveDirectorApi {
  /** Last count emitted via enemiesLeft (the original rewrote the DOM readout every frame). */
  private lastEnemiesLeft = -1;

  constructor(private ctx: Ctx) {}

  /** Original: startWave(n) — lines 2167-2189. */
  start(n: number): void {
    const ctx = this.ctx;
    const waves = ctx.waves;
    const player = ctx.player;

    waves.num = n;
    waves.active = true;
    ctx.events.emit('waveStarted', { num: n });
    ctx.events.emit('waveBanner', { big: 'WAVE ' + n, small: 'HOSTILES INBOUND' });
    ctx.audio.waveHorn();

    const slimes = 2 + Math.floor(n * 0.8);
    const imps = n >= 2 ? Math.floor(n * 0.6) : 0;
    const golems = n >= 3 ? Math.floor(n / 3) : 0;

    const spawnXs: number[] = [];
    for (let i = 0; i < slimes + imps + golems; i++) {
      let sx: number;
      do {
        sx = Math.floor(clamp(player.x + (Math.random() - 0.5) * VIEW_W * 1.5, 14, WIDTH - 15));
      } while (Math.abs(sx - player.x) < 90 && Math.random() < 0.85);
      spawnXs.push(sx);
    }
    let idx = 0;
    for (let i = 0; i < slimes; i++) ctx.enemyCtl.spawn('slime', spawnXs[idx++], 6);
    for (let i = 0; i < imps; i++) ctx.enemyCtl.spawn('imp', spawnXs[idx++], 12 + Math.random() * 14);
    for (let i = 0; i < golems; i++) ctx.enemyCtl.spawn('golem', spawnXs[idx++], 6);
  }

  /** Original: updateWaves() — lines 2191-2203. */
  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.player.dead) return;
    if (ctx.enemies.length !== this.lastEnemiesLeft) {
      this.lastEnemiesLeft = ctx.enemies.length;
      ctx.events.emit('enemiesLeft', { count: this.lastEnemiesLeft });
    }
    const waves = ctx.waves;
    if (!waves.active) {
      waves.intermission--;
      if (waves.intermission <= 0) this.start(waves.num + 1);
    } else if (ctx.enemies.length === 0) {
      waves.active = false;
      waves.intermission = 240;
      ctx.player.hp = Math.min(ctx.player.maxHp, ctx.player.hp + 25);
      ctx.events.emit('waveBanner', { big: 'WAVE CLEAR', small: '+25 HP — NEXT WAVE SOON' });
    }
  }
}
