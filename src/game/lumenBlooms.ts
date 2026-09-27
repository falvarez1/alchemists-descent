import type { Ctx, LumenBloom } from '@/core/types';
import { LUMEN } from '@/config/darkness';
import { Cell, isGas } from '@/sim/CellType';
import { packRGB } from '@/sim/colors';

/**
 * LUMEN BLOOMS (light wave): a light-drinking plant rooted in a wall. While
 * light lands on its heart it unfurls a run of pale petals — real Glass
 * cells, walkable and translucent — holds a moment, then furls slowly in the
 * dark, tip first. A timing puzzle: light it, then cross before it closes.
 *
 * Grid-honest: petals are only written into open air (never over a body, a
 * crate or rock) and only cells that are still the bloom's glass are taken
 * back, so a shattered petal is simply regrown on the next unfurl (fail-open:
 * light always re-opens it). Openness is transient; a restored level starts
 * furled and clears any petals its save kept.
 */

/** Petal glass: pale ivory at the tip, a greener vein toward the root. */
export function petalColor(index: number, count: number, row: number): number {
  const t = count > 1 ? index / (count - 1) : 0;
  const vein = (index * 7 + row * 3) % 5 === 0 ? 14 : 0;
  const top = row === 0 ? 1 : 0.86;
  return packRGB(
    Math.round((150 + t * 70 + vein) * top),
    Math.round((196 + t * 40 + vein) * top),
    Math.round((160 + t * 48 + vein * 0.5) * top),
  );
}

/** Is real light on the bloom's heart this tick (the beam, or any blaze)? */
export function bloomLit(ctx: Ctx, b: LumenBloom): boolean {
  const q = ctx.lightQuery;
  if (!q) return false;
  return q.wandLight(b.x, b.y) >= LUMEN.beam || q.level(b.x, b.y) >= LUMEN.blaze;
}

function occupied(ctx: Ctx, x: number, y: number): boolean {
  const p = ctx.player;
  if (!p.dead && x >= p.x - 5 && x <= p.x + 5 && y >= p.y - 18 && y <= p.y + 1) return true;
  for (const e of ctx.enemies) {
    const def = ctx.enemyCtl?.defs?.[e.kind];
    const hw = (def?.halfW ?? 6) + 1, h = def?.h ?? 12;
    if (x >= e.x - hw && x <= e.x + hw && y >= e.y - h && y <= e.y + 1) return true;
  }
  return false;
}

/** Stamp petals up to `want` (root first); stops at the first blocked cell. */
function unfurlTo(ctx: Ctx, b: LumenBloom, want: number, budget: number): number {
  const w = ctx.world;
  let placed = 0;
  while (b.shown < want && placed < budget) {
    const [x, y] = b.petals[b.shown];
    if (!w.inBounds(x, y)) { b.shown++; continue; }
    const i = w.idx(x, y), t = w.types[i];
    if (t === Cell.Glass) { b.shown++; continue; } // already standing (a restore, or never furled)
    if ((t !== Cell.Empty && !isGas(t)) || occupied(ctx, x, y)) break;
    w.replaceCellAt(i, Cell.Glass, petalColor(b.shown >> 1, b.petals.length >> 1, b.shown & 1));
    b.shown++;
    placed++;
  }
  return placed;
}

/** Take petals back to `want` (tip first); only the bloom's own glass. */
function furlTo(ctx: Ctx, b: LumenBloom, want: number, budget: number): number {
  const w = ctx.world;
  let taken = 0;
  while (b.shown > want && taken < budget) {
    b.shown--;
    const [x, y] = b.petals[b.shown];
    if (!w.inBounds(x, y)) continue;
    const i = w.idx(x, y);
    if (w.types[i] === Cell.Glass) {
      w.clearCellAt(i);
      taken++;
    }
  }
  return taken;
}

/** First tick after a (re)load: a furled bloom owns no standing petals. */
function settleRestored(ctx: Ctx, b: LumenBloom): void {
  if (b.shown >= 0) return;
  b.shown = b.petals.length;
  furlTo(ctx, b, Math.round(b.open * b.petals.length), b.petals.length);
}

export function updateLumenBlooms(ctx: Ctx, blooms: LumenBloom[]): void {
  for (const b of blooms) {
    settleRestored(ctx, b);
    const lit = bloomLit(ctx, b);
    const wasOpen = b.open;
    if (lit) {
      b.open = Math.min(1, b.open + LUMEN.openRate);
      b.hold = LUMEN.hold;
    } else if (b.hold > 0) {
      b.hold--;
      if (b.hold === 0 && b.open > 0.05) {
        // The furl begins: a dry creak and a shiver down the petals.
        ctx.audio.creak?.(0.6);
        ctx.events.emit('lightDevice', { kind: 'bloom-furl', x: b.x, y: b.y });
      }
    } else {
      b.open = Math.max(0, b.open - LUMEN.furlRate);
    }
    const want = Math.round(b.open * b.petals.length);
    if (want > b.shown) {
      const n = unfurlTo(ctx, b, want, 3);
      if (wasOpen <= 0.001 && b.open > 0) {
        // Waking: a rising glass chime, and pollen-light spilling off the heart.
        ctx.audio.tone(660, 1320, 0.32, 'sine', 0.035, b.x, b.y);
        ctx.audio.tone(990, 1480, 0.22, 'triangle', 0.018, b.x, b.y);
        ctx.particles.burst(b.x, b.y, 6, null, () => packRGB(190, 255, 214), 0.8, { glow: 1.6, grav: -0.01 });
        ctx.events.emit('lightDevice', { kind: 'bloom-open', x: b.x, y: b.y });
      }
      if (n > 0 && (b.shown & 7) === 0) ctx.audio.tone(1300 + b.shown * 6, 1600, 0.05, 'sine', 0.012, b.x, b.y);
    } else if (want < b.shown) {
      const n = furlTo(ctx, b, want, 1);
      if (n > 0 && (b.shown & 3) === 0) {
        const [x, y] = b.petals[b.shown] ?? [b.x, b.y];
        ctx.particles.burst(x, y, 2, null, () => packRGB(170, 220, 190), 0.4, { glow: 0.9, grav: 0.03 });
      }
    }
  }
}
