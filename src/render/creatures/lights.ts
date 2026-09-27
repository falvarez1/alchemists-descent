import type { Ctx, Enemy } from '@/core/types';
import { corpses } from '@/creatures/corpses';
import { organismLights } from '@/render/organisms';
import { BR, BR_CHEST } from '@/creatures/species/brute';
import { GEL } from '@/creatures/species/gel';
import { IMP, IMP_BODY } from '@/creatures/species/imp';
import { LZ, LZ_HEAD } from '@/creatures/species/lizard';
import { MG, MG_HEAD } from '@/creatures/species/mage';
import { SRP } from '@/creatures/species/serpents';
import { WSP, WSP_BELL } from '@/creatures/species/wisp';

export type SeedLight = (x: number, y: number, r: number, g: number, b: number) => void;

/**
 * Living light, read from the bodies that make it: the angler's lure where the
 * lure actually dangles, the acid sac swelling before a spit, a bomber's core
 * heating on its fuse, a jelly's heart pulsing with each beat. Corpses keep a
 * guttering fraction of theirs.
 */
function lightOf(ctx: Ctx, e: Enemy, seed: SeedLight, k: number): void {
  const rig = e.rig, F = rig?.f, t = ctx.state.frameCount;
  switch (e.kind) {
    case 'colossus': {
      const heat = e.status.wet > 0 ? 0.3 : 0.85 + Math.sin(t * 0.09 + e.bobPhase) * 0.25;
      const c = rig?.pts[BR_CHEST] ?? { x: e.x, y: e.y - 12 };
      seed(c.x, c.y, heat * 2.0 * k, heat * 1.2 * k, heat * 0.25 * k);
      seed(c.x - (F ? Math.sign(F[BR.face] || 1) : 1) * 8, c.y - 18, heat * 0.9 * k, heat * 0.55 * k, heat * 0.12 * k);
      break;
    }
    case 'golem': {
      const pulse = 0.7 + Math.sin(t * 0.12 + e.bobPhase) * 0.3;
      const c = rig?.pts[BR_CHEST] ?? { x: e.x, y: e.y - 10 };
      seed(c.x, c.y, pulse * 1.1 * k, pulse * 0.8 * k, pulse * 0.18 * k);
      if (e.jetFuel > 0) seed(e.x, e.y + 2, 1.5 * k, 0.9 * k, 0.22 * k);
      break;
    }
    case 'leviathan': {
      const lure = rig?.chains[1]?.pts.at(-1);
      const l = F ? F[SRP.lure] : 0.65 + Math.sin(t * 0.07 + e.bobPhase) * 0.35;
      seed(lure?.x ?? e.x, (lure?.y ?? e.y - 14) + 1, l * 0.45 * k, l * 1.2 * k, l * 1.5 * k);
      const mid = rig?.chains[0]?.pts[4];
      if (mid) seed(mid.x, mid.y, 0.05 * k, 0.25 * k, 0.32 * k);
      break;
    }
    case 'wisp': {
      const b = rig?.pts[WSP_BELL] ?? { x: e.x, y: e.y - 4 };
      const g = F ? F[WSP.glow] : 0.7;
      seed(b.x, b.y, 0.45 * g * k, 0.95 * g * k, 1.2 * g * k);
      break;
    }
    case 'imp': {
      const b = rig?.pts[IMP_BODY] ?? { x: e.x, y: e.y - 6 };
      const f = (0.55 + Math.sin(t * 0.31 + e.bobPhase) * 0.1) * k;
      seed(b.x, b.y, f, f * 0.45, f * 0.08);
      const ch = F ? F[IMP.charge] : 0;
      if (ch > 0.1) seed(b.x + (F![IMP.face] >= 0 ? 4 : -4), b.y + 1, ch * 1.4 * k, ch * 0.75 * k, ch * 0.18 * k);
      break;
    }
    case 'mage': {
      const pulse = 0.8 + Math.sin(t * 0.1 + e.bobPhase) * 0.2;
      const h = rig?.pts[MG_HEAD] ?? { x: e.x, y: e.y - 12 };
      const cast = F ? F[MG.cast] : 0;
      seed(h.x, h.y + 4, (0.45 + cast * 0.6) * pulse * k, (0.15 + cast * 0.25) * pulse * k, (0.6 + cast * 0.6) * pulse * k);
      break;
    }
    case 'weaver': {
      const loco = e.weaverLoco;
      const x = loco?.px ?? e.x, y = loco?.py ?? e.y - 10;
      const pulse = 0.55 + Math.sin(t * 0.11 + e.bobPhase) * 0.25;
      const attack = (e.windup ?? 0) > 0 || e.blink > 0 ? 0.45 : 0;
      const face = loco?.face ?? 1, tx = -(loco?.ny ?? -1), ty = loco?.nx ?? 0;
      seed(x + tx * face * 10, y + ty * face * 10, (0.2 + attack * 0.4) * k, (0.4 + attack) * k, (0.2 + attack * 0.4) * k);
      seed(x - tx * face * 8, y - ty * face * 8 - 3, pulse * 0.1 * k, pulse * 0.35 * k, pulse * 0.16 * k);
      break;
    }
    case 'rillback': {
      const windup = e.rillChargeWindup ?? 0;
      if (e.blink > 0 || windup > 0) {
        const f = (0.35 + Math.max(e.blink, windup) * 0.06) * k;
        const n = e.body?.nodes[3];
        seed(n?.x ?? e.x, n?.y ?? e.y - 5, f * 0.25, f * 0.8, f);
      }
      break;
    }
    case 'spitter': {
      const sac = F ? F[LZ.throat] : 0;
      if (sac > 0.1) { const h = rig!.pts[LZ_HEAD]; seed(h.x, h.y + 2, sac * 0.5 * k, sac * 0.95 * k, sac * 0.08 * k); }
      break;
    }
    case 'bomber': {
      const heat = F ? F[GEL.heat] : 0.4;
      const c = rig?.soft;
      seed(c?.cx ?? e.x, c?.cy ?? e.y - 4, heat * 1.1 * k, heat * 0.5 * k, heat * 0.08 * k);
      break;
    }
    case 'acidslime': {
      const c = rig?.soft;
      seed(c?.cx ?? e.x, c?.cy ?? e.y - 4, 0.14 * k, 0.24 * k, 0.02 * k);
      break;
    }
    case 'eggs': {
      const ripe = Math.min(1, e.timer / (1400 + e.bobPhase * 220));
      seed(e.x, e.y - 3, 0.04 * k, (0.12 + ripe * 0.2) * k, 0.08 * k);
      break;
    }
    case 'stonemaw': {
      const n = e.body?.nodes[3];
      if (n) seed(n.x, n.y, 0.28 * k, 0.13 * k, 0.02 * k);
      break;
    }
    case 'rootloper': {
      const b = rig?.pts[0];
      if (b) seed(b.x + 2, b.y, 0.2 * k, 0.16 * k, 0.03 * k);
      break;
    }
    default: break;
  }
}

export function creatureLights(ctx: Ctx, seed: SeedLight): void {
  for (const e of ctx.enemies) lightOf(ctx, e, seed, 1);
  organismLights(ctx, seed); // WS-N organisms: beads, throats, bellies (render/organisms)
  for (const c of corpses()) if (c.world === ctx.world && c.glow > 0.02) lightOf(ctx, c.e, seed, c.glow);
  // The alchemist's dropped wand keeps a little light until it gutters out.
  if (ctx.player.dead && ctx.rigidBodies?.bodies) {
    const t = ctx.fx.deathTime ?? 0, k = Math.max(0, Math.min(1, 1 - (t - 0.5) / 1.4));
    if (k > 0.02) for (const b of ctx.rigidBodies.bodies) {
      if (b.tag !== 'player-corpse-wand') continue;
      const tx = b.x + Math.cos(b.angle) * 5.8, ty = b.y + Math.sin(b.angle) * 5.8;
      seed(tx, ty, 0.3 * k, 0.9 * k, 1.05 * k);
    }
  }
}
