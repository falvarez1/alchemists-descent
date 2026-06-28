import type { EnemyDef, EnemyKind } from '@/core/types';
import { Cell } from '@/sim/CellType';
import {
  acidColor,
  bloodColor,
  fireColor,
  nitrogenColor,
  slimeColor,
  stoneColor,
  toxicColor,
  vineColor,
} from '@/sim/colors';

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  slime: { hp: 48, halfW: 5, h: 8, bounty: 30, gore: Cell.Slime, goreFn: slimeColor },
  imp: { hp: 40, halfW: 5, h: 12, bounty: 50, gore: Cell.Fire, goreFn: fireColor },
  golem: { hp: 170, halfW: 7, h: 20, bounty: 150, gore: Cell.Stone, goreFn: stoneColor },
  acidslime: { hp: 40, halfW: 5, h: 8, bounty: 45, gore: Cell.Acid, goreFn: acidColor },
  wisp: { hp: 22, halfW: 4, h: 8, bounty: 60, gore: Cell.Nitrogen, goreFn: nitrogenColor },
  mage: { hp: 60, halfW: 5, h: 14, bounty: 120, gore: Cell.Blood, goreFn: bloodColor },
  // Upgrade port (noita-alchemists-descent.html)
  bat: { hp: 16, halfW: 3, h: 5, bounty: 15, gore: Cell.Blood, goreFn: bloodColor },
  spitter: { hp: 55, halfW: 5, h: 11, bounty: 60, gore: Cell.Toxic, goreFn: toxicColor },
  bomber: { hp: 34, halfW: 5, h: 8, bounty: 45, gore: Cell.Fire, goreFn: fireColor },
  // Eight-legged Fungal/Timber elite: controls space by writing real vine webbing.
  // halfW 9 is the drawn abdomen, NOT the ~12-cell leg span: a 19-wide collision
  // box lets the weaver place and path through normal cave corridors (a 25-wide
  // box wedged in fungal/timber tunnels and froze its AI). Its legs still splay
  // visually onto the walls. Hit detection is query-radius based, so the smaller
  // box doesn't shrink how readily player shots connect.
  weaver: { hp: 260, halfW: 9, h: 18, bounty: 220, gore: Cell.Blood, goreFn: bloodColor },
  // The Kiln Colossus: the run's final door. Water is the strategy.
  colossus: { hp: 520, halfW: 13, h: 26, bounty: 600, gore: Cell.Stone, goreFn: stoneColor },
  // Wave F: slime egg clutch - destroy it now or fight what hatches later.
  eggs: { hp: 14, halfW: 4, h: 5, bounty: 25, gore: Cell.Slime, goreFn: slimeColor },
  // The Sunken Leviathan: d4's mid-boss. Water is its armor - drain the
  // cistern or electrify it (it bleeds CONDUCTOR into its own pool).
  leviathan: { hp: 460, halfW: 9, h: 14, bounty: 450, gore: Cell.Blood, goreFn: bloodColor },
  // Overgrowth predator: moves by planting root-arms into real soft growth.
  rootloper: { hp: 90, halfW: 6, h: 14, bounty: 85, gore: Cell.Vines, goreFn: vineColor },
  // Blind terrain predator: chews limited rock tunnels, never metal.
  stonemaw: { hp: 150, halfW: 8, h: 10, bounty: 130, gore: Cell.Stone, goreFn: stoneColor },
  // Pool ecology eel: dangerous in liquid, clumsy when beached.
  rillback: { hp: 58, halfW: 7, h: 8, bounty: 70, gore: Cell.Blood, goreFn: bloodColor },
};
