import type { Rng } from '@/core/rng';
import type { Ctx, LockKind, RegionGraph } from '@/core/types';
import { makePickup } from '@/core/pickupDefs';
import type { CarveAvoid, PlacementLedger } from '@/world/connect';
import { carvePocket, connectToCaves, sealedFootprints, prefabFootprints } from '@/world/connect';
import { gasBellRoom } from '@/world/lockGasBell';
import { weirRoom } from '@/world/lockWeir';
import { type LockOutput, type LockSite, placeLockRoom, seaTopRow } from '@/world/locks';

/**
 * The floor's LOCK, placed (world/locks has the pattern). Returns whether the lock stands. A floor
 * whose lock could not be seated is never left keyless: the key goes where the old pocket vault put
 * it (the main-path region farthest from the spawn, a walk-in pocket joined to the caves) with no seal,
 * and the report says so.
 */
export function placeLock(
  ctx: Ctx, rng: Rng, kind: LockKind, graph: RegionGraph, ledger: PlacementLedger, site: LockSite,
  fits: Uint8Array | undefined, out: LockOutput,
): boolean {
  let stood = false;
  if (kind === 'gasbell') stood = placeLockRoom(ctx, rng, graph, ledger, site, fits, out, gasBellRoom(ctx, rng, out), 'lock-gas-bell');
  else if (kind === 'weir') {
    // (a flooded floor: the hall stands above the sea, or the sea comes in through its connector)
    const seaTop = seaTopRow(ctx.world);
    stood = placeLockRoom(ctx, rng, graph, ledger, Number.isFinite(seaTop) ? { ...site, maxFloorY: seaTop - 14 } : site, fits, out, weirRoom(ctx, rng, out), 'lock-weir');
  }
  if (stood) return true;
  if (out.pickups.some((p) => p.kind === 'key')) return false;
  placeFallbackKey(ctx, rng, graph, ledger, site, fits, out);
  return false;
}

/** The old vault, without its rng draws: a walk-in pocket for the key on the farthest main-path region. */
function placeFallbackKey(
  ctx: Ctx, rng: Rng, graph: RegionGraph, ledger: PlacementLedger, site: LockSite,
  fits: Uint8Array | undefined, out: LockOutput,
): void {
  let best: { cx: number; cy: number } | null = null;
  let bestD = -1;
  for (const reg of graph.regions) {
    if (!reg.onMainPath && reg.area < 250) continue;
    if (ledger.intersects(reg.cx - 15, reg.cy - 15, reg.cx + 15, reg.cy + 15)) continue;
    const d = Math.abs(reg.cx - site.spawn.x) + Math.abs(reg.cy - site.spawn.y) * 0.6;
    if (d > bestD) { bestD = d; best = { cx: reg.cx, cy: reg.cy }; }
  }
  const kx = Math.floor(best ? best.cx : 1600 - site.spawn.x);
  const ky = Math.floor(best ? best.cy : 530);
  carvePocket(ctx.world, kx, ky, 11, 12);
  out.pickups.push(makePickup('key', kx, ky)); // it falls to the pocket's floor like any pickup
  const avoid: CarveAvoid[] = [...sealedFootprints(ledger), ...prefabFootprints(ledger)];
  connectToCaves(ctx.world, rng, graph, kx - 8, ky, 12, fits, { halfW: 7, up: 21, down: 9 }, avoid);
  console.warn(`[locks] ${ctx.state.currentBiome}: the lock could not be seated; the key rests unsealed at ${kx},${ky}`);
}
