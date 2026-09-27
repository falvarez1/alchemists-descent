import type { Enemy, EnemyDamageSource, EnemyKind } from '@/core/types';

/**
 * THE BOSS WARD. The Kiln Colossus and the Sunken Leviathan are the run's
 * set-piece fights, so their hit points move ONLY for harm the player set in
 * motion. QA watched the Colossus die on its own with the player idling 114
 * cells away: a world-repair carve had opened its ceiling tank (thermal shock),
 * its own slam and fireballs left live charge in the floor it then walked
 * through, and gunpowder the lava lit went off beside it. None of that is the
 * player's victory, so none of it may cost a warded boss a hit point.
 *
 * What counts as the player's:
 * - a DIRECT blow (his wand's bolts and blasts, his kick, a thrown leg) — always;
 * - any other harm (a blast he did not cast, fire, current, acid, a flood, a
 *   thermal shock) only while he is ENGAGED: he cast a spell, poured or threw a
 *   flask within BOSS_ACT_TICKS, at a point within BOSS_ENGAGE_CELLS of the boss.
 *   Digging the Kiln's seal, zapping the Sump, lighting the powder under it —
 *   every designed play starts with a cast or a pour, so the world's answer to
 *   it lands; an idle player's world never does.
 * - never a blast the boss itself authored (its slam, its fireballs, its death):
 *   `blastAuthor` reads the explosion's source tag.
 *
 * Foundation-level (no systems) so the sim's explosion pass and the entity
 * layer share one rule.
 */

/** The bosses the ward protects. */
export const WARDED_BOSSES: ReadonlySet<EnemyKind> = new Set<EnemyKind>(['colossus', 'leviathan']);

/** A cast, pour or throw keeps the world's harm "his" for 8 s (ticks at 60 Hz). */
export const BOSS_ACT_TICKS = 8 * 60;

/** ...when it happened this close to the boss: the lair plus a sniping lane. */
export const BOSS_ENGAGE_CELLS = 360;

/**
 * THE KILN QUENCH. A doused kiln no longer bleeds a silent 1.4 hp every tick
 * (84 hp/s — a flood was an instant, unreadable win). Each douse the player
 * caused CRACKS it: one big, readable thermal-shock burst worth `share` of its
 * max hp, then, while it is still soaked, another every `rearmTicks`. The burst
 * flashes the water on its body to real steam, so a flood buys a handful of
 * cracks, not a drain to zero.
 */
export const KILN_QUENCH = {
  /** Share of max hp one thermal-shock crack takes (16%: ~83 hp of 520). */
  share: 0.16,
  /** A kiln still soaked cracks again after 2.5 s. */
  rearmTicks: 150,
} as const;

export function isWardedBoss(kind: EnemyKind): boolean {
  return WARDED_BOSSES.has(kind);
}

/**
 * The warded boss an explosion's source tag names as its author — the Kiln's
 * 'colossus-slam', 'colossus-fireball', 'colossus-death' — or null for any
 * other blast (the player's own, gunpowder, barrels, bombers).
 */
export function blastAuthor(tag: string | undefined): EnemyKind | null {
  if (!tag) return null;
  for (const kind of WARDED_BOSSES) {
    if (tag === kind || tag.startsWith(`${kind}-`)) return kind;
  }
  return null;
}

/** A boss arena's fragile organ: the cells its designed weakness lives in. */
export interface BossOrganRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * The organ of a warded boss's arena, from its GENERATED spawn (world/structures):
 * the Kiln's ceiling tanks (the three casings, seals 61-68 rows above the spawn)
 * or the Sump's casing floor and three drain plugs (6-9 rows below). These are
 * the PLAYER's to open: world repair never carves them (world/validate) and the
 * boss's own blasts never break them (sim/explosion) — QA watched the Colossus's
 * first fireball volley shatter its own tank and waste the flood.
 */
export function bossOrganRect(boss: { x: number; y: number; kind?: EnemyKind } | null | undefined): BossOrganRect | null {
  if (!boss) return null;
  // The Kiln's three ceiling tanks (GEN 51, world/structures): the centre one
  // 27 wide with its seal 67-68 rows above the spawn, the side ones 15 wide at
  // ±34 with seals 61-62 rows up, gold tells two rows under each.
  if (boss.kind === 'colossus') return { x0: boss.x - 42, y0: boss.y - 79, x1: boss.x + 42, y1: boss.y - 59 };
  if (boss.kind === 'leviathan') return { x0: boss.x - 28, y0: boss.y + 6, x1: boss.x + 28, y1: boss.y + 9 };
  return null;
}

/**
 * A boss's whole ARENA, from its generated spawn — the ledger rect world/structures
 * reserves for it: the Kiln (RX 62, RY 40, FLOOR 30: spawn at cy+29) or the Sump
 * (the 84x52 pocket, rim and plinth: spawn at cy+26). Findability repair routes
 * around it and only cuts it as a last resort (world/validate, world/repairRoute).
 */
export function bossArenaRect(boss: { x: number; y: number; kind?: EnemyKind } | null | undefined): BossOrganRect | null {
  if (!boss) return null;
  if (boss.kind === 'colossus') return { x0: boss.x - 64, y0: boss.y - 81, x1: boss.x + 64, y1: boss.y + 6 };
  if (boss.kind === 'leviathan') return { x0: boss.x - 44, y0: boss.y - 52, x1: boss.x + 44, y1: boss.y + 10 };
  return null;
}

interface QuenchState {
  /** Ticks until a still-soaked kiln may crack again. */
  cd: number;
  /** This douse was the player's (he was engaged when it began or while it lasted). */
  credited: boolean;
}

/** Per-run memory of the player's last act and of each warded boss's harm. */
export class BossWard {
  private actFrame = -1e9;
  private actX = 0;
  private actY = 0;
  private readonly harmed = new WeakSet<Enemy>();
  private readonly quenches = new WeakMap<Enemy, QuenchState>();

  /** The player acted at (x, y) on this tick: a cast, a pour, a throw. */
  noteAct(frame: number, x: number, y: number): void {
    this.actFrame = frame;
    this.actX = x;
    this.actY = y;
  }

  /** Forget the last act (a level change: an act on another floor engages nothing here). */
  reset(): void {
    this.actFrame = -1e9;
  }

  /** The player acted near this boss recently: the world's harm to it is his. */
  engaged(e: Enemy, frame: number): boolean {
    if (frame - this.actFrame > BOSS_ACT_TICKS) return false;
    return Math.hypot(this.actX - e.x, this.actY - e.y) <= BOSS_ENGAGE_CELLS;
  }

  /**
   * May harm from `source` land on `e`? Always for an unwarded creature and for
   * a direct blow; otherwise only while the player is engaged. An allowed blow
   * marks the boss as harmed by the player (see harmedByPlayer).
   */
  allows(e: Enemy, source: EnemyDamageSource, frame: number): boolean {
    if (!isWardedBoss(e.kind)) return true;
    const ok = source === 'direct' || this.engaged(e, frame);
    if (ok) this.harmed.add(e);
    return ok;
  }

  /** Has any harm the ward allowed ever landed on this boss? */
  harmedByPlayer(e: Enemy): boolean {
    return this.harmed.has(e);
  }

  /**
   * Advance the Kiln's quench one tick. `soaked` is the wet status. Returns the
   * thermal-shock damage to deal THIS tick: 0, or one crack of KILN_QUENCH.share
   * of max hp. A douse is credited the moment the player is engaged during it
   * and stays his while the kiln stays wet (dig the seal, then watch the flood);
   * an uncredited douse (a stray drip, a flood nobody caused) never cracks it.
   */
  quenchTick(e: Enemy, soaked: boolean, frame: number): number {
    let s = this.quenches.get(e);
    if (!s) {
      s = { cd: 0, credited: false };
      this.quenches.set(e, s);
    }
    if (s.cd > 0) s.cd--;
    if (!soaked) {
      s.credited = false;
      return 0;
    }
    if (!s.credited) s.credited = this.engaged(e, frame);
    if (!s.credited || s.cd > 0) return 0;
    s.cd = KILN_QUENCH.rearmTicks;
    this.harmed.add(e);
    return e.maxHp * KILN_QUENCH.share;
  }
}
