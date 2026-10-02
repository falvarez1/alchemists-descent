import { FIGHTER_ORDER } from '@/content/fighters';
import type { FighterId } from '@/content/fighters';
import type { FighterKitDef } from '@/fighters/kit';
import { kitFor } from '@/fighters/kits';
import { fighterParamRange, inRange } from '@/fighters/paramRanges';
import type { ParamRange } from '@/fighters/paramRanges';
import { FIGHTER_TUNING } from '@/fighters/tuning';

/**
 * THE PARAM OVERRIDE (docs/arena/TELEMETRY-AND-BALANCE.md 3.5): dev-only access to every number that defines a
 * fighter, so a balance run can turn one knob, fight, and put it back. The knobs are the plain mutable objects
 * the kits already read (`FIGHTER_TUNING`, each kit's exported `TUNING`); this registry only names them by a
 * dotted path, bounds them (`fighters/paramRanges`), remembers their shipped defaults and restores them.
 *
 *   fighter.<name>                      the shared ultimate-charge dials (`fighters/tuning`)
 *   kit.<id>.<group>.<name>             one kit's TUNING (`kit.rusk-emberjaw.ram.damage`)
 *   body.<id>.<attribute>, player.<x>   roots other packages register with `addRoot` (bodies: P1; player feel: main.ts)
 *
 * Contracts:
 * - `set` on an unknown path, a wrong type or an out-of-range value returns false and changes nothing.
 * - `apply` is all-or-nothing and THROWS on an invalid entry (a typo'd path in a batch must fail loudly, not run
 *   un-overridden fights that look overridden); it returns a restore function that puts back what was there
 *   before THIS call. Always restore in a `finally`.
 * - Apply BEFORE `equip`: a kit's cooldown and an ultimate's duration are read when the fighter is equipped.
 *   `def.tacticalCooldown` / `def.ultimateDuration` are numbers captured at module load, so the registry also
 *   patches the kit defs (DEF_LINKS); a few module-level derived constants (Mara's WAVE_SHOWN) are NOT
 *   overridable. Changing a number in the middle of a fight is unsupported.
 * - Fighter paths are NOT in `config/tuningRanges` / `net/tuningPatch.listTuningPaths`: they would break
 *   `verify:tuning-ranges --check` and the hosted relay's table.
 * - Nothing here ships in a player build: it is reached only through the dev block in `main.ts` and the
 *   authoring console.
 */

export interface ParamSpec {
  path: string;
  default: number | boolean;
  min: number;
  max: number;
  step?: number;
  integer?: boolean;
}

export type ParamValue = number | boolean;

export interface ParamOverrideApi {
  /** Every registered knob (optionally under a path prefix), sorted by path. */
  list(prefix?: string): ParamSpec[];
  get(path: string): ParamValue | undefined;
  /** False (and nothing changes) for an unknown path, a value of the wrong type, or one out of range. */
  set(path: string, value: ParamValue): boolean;
  /** Set several at once, all or nothing (throws on an invalid entry); returns the function that restores them. */
  apply(overrides: Record<string, ParamValue>): () => void;
  /** Every knob back to its captured default. */
  reset(): void;
  /** The sparse diff against the defaults: what a fight header records as `overrides`. */
  snapshot(): Record<string, ParamValue>;
  /** Load every kit's TUNING and def (one chunk each, on demand); the registry is empty until this resolves. */
  ready(): Promise<void>;
  /** Register another root of knobs (`body.<id>` bodies, `player`) with its own range rule. */
  addRoot(prefix: string, root: object, options?: ParamRootOptions): void;
}

export interface ParamRootOptions {
  /** The range of a knob (default: the fighter table). null = no range declared: the knob is not registered. */
  range?: (path: string, dflt: number) => ParamRange | null;
  /** Called after a knob under this root changes (a set, an apply, a restore, a reset). */
  after?: (path: string, value: ParamValue) => void;
}

/** The tuning paths (below `kit.<id>.`) that a kit's def captured at module load: its tactical cooldown and ultimate duration. */
export const DEF_LINKS: Readonly<Record<FighterId, { tactical: string; ultimate: string }>> = {
  'ilyra-voss': { tactical: 'tacticalCooldown', ultimate: 'phoenixTicks' },
  'brann-rook': { tactical: 'guard.cooldown', ultimate: 'redline.duration' },
  'sable-fen': { tactical: 'bogline.cooldown', ultimate: 'bloodsense.duration' },
  'mara-quell': { tactical: 'bell.cooldown', ultimate: 'chime.duration' },
  'kest-rel': { tactical: 'step.cooldown', ultimate: 'updraft.duration' },
  'nox-calder': { tactical: 'glass.cooldown', ultimate: 'night.duration' },
  'edda-morrow': { tactical: 'shard.cooldown', ultimate: 'window.duration' },
  'selene-wraith': { tactical: 'echo.cooldown', ultimate: 'mirror.duration' },
  'rusk-emberjaw': { tactical: 'ram.cooldown', ultimate: 'kiln.duration' },
  'father-thorne': { tactical: 'vine.cooldown', ultimate: 'over.duration' },
};

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface Leaf {
  path: string;
  owner: Record<string, unknown>;
  key: string;
  dflt: ParamValue;
  range: ParamRange | null;
  after?: (path: string, value: ParamValue) => void;
}

/** The kit modules that export a TUNING: `<id>-logic`, `<id>-math`, `<id>-grow`, or the kit itself (Kest). */
const TUNING_MODULES = import.meta.glob<{ TUNING?: object }>(['./kits/*-logic.ts', './kits/*-math.ts', './kits/*-grow.ts', './kits/kest-rel.ts']);

function fighterIdOfModule(file: string): FighterId | null {
  const m = /\/kits\/(.+?)(?:-(?:logic|math|grow))?\.ts$/.exec(file);
  const id = m?.[1];
  return id && (FIGHTER_ORDER as readonly string[]).includes(id) ? (id as FighterId) : null;
}

export class ParamRegistry implements ParamOverrideApi {
  private readonly leaves = new Map<string, Leaf>();
  private readonly defs = new Map<FighterId, FighterKitDef>();
  private loading: Promise<void> | null = null;

  addRoot(prefix: string, root: object, options: ParamRootOptions = {}): void {
    const rangeOf = options.range ?? ((path: string, dflt: number): ParamRange | null => fighterParamRange(path, dflt));
    const walk = (node: Record<string, unknown>, path: string, depth: number): void => {
      if (depth > 6) return;
      for (const key of Object.keys(node)) {
        const value = node[key];
        const here = `${path}.${key}`;
        if (typeof value === 'number' && Number.isFinite(value)) {
          const range = rangeOf(here, value);
          if (range === null) continue;
          this.leaves.set(here, { path: here, owner: node, key, dflt: value, range, after: options.after });
        } else if (typeof value === 'boolean') {
          this.leaves.set(here, { path: here, owner: node, key, dflt: value, range: null, after: options.after });
        } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          walk(value as Record<string, unknown>, here, depth + 1);
        }
      }
    };
    walk(root as Record<string, unknown>, prefix, 0);
  }

  ready(): Promise<void> {
    this.loading ??= this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    this.addRoot('fighter', FIGHTER_TUNING);
    const kitDefs = await Promise.all(FIGHTER_ORDER.map(async (id) => [id, await kitFor(id)] as const));
    for (const [id, def] of kitDefs) if (def) this.defs.set(id, def);
    for (const [file, load] of Object.entries(TUNING_MODULES)) {
      const id = fighterIdOfModule(file);
      if (id === null) continue;
      const mod = await load();
      if (mod.TUNING) this.addRoot(`kit.${id}`, mod.TUNING, { after: (path, value) => this.patchDef(id, path, value) });
    }
  }

  /** A kit's def captured its cooldown and duration at module load: write the new value through to it. */
  private patchDef(id: FighterId, path: string, value: ParamValue): void {
    const def = this.defs.get(id) as Mutable<FighterKitDef> | undefined;
    if (!def || typeof value !== 'number') return;
    const sub = path.slice(`kit.${id}.`.length);
    const links = DEF_LINKS[id];
    if (sub === links.tactical) def.tacticalCooldown = value;
    else if (sub === links.ultimate) def.ultimateDuration = value;
  }

  list(prefix = ''): ParamSpec[] {
    const out: ParamSpec[] = [];
    for (const leaf of this.leaves.values()) {
      if (prefix !== '' && !leaf.path.startsWith(prefix)) continue;
      const r = leaf.range;
      out.push({
        path: leaf.path,
        default: leaf.dflt,
        min: r?.min ?? 0,
        max: r?.max ?? 1,
        ...(r?.step !== undefined ? { step: r.step } : {}),
        ...(r?.integer ? { integer: true } : {}),
      });
    }
    return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  get(path: string): ParamValue | undefined {
    const leaf = this.leaves.get(path);
    return leaf ? (leaf.owner[leaf.key] as ParamValue) : undefined;
  }

  private valid(leaf: Leaf, value: ParamValue): boolean {
    if (typeof leaf.dflt === 'boolean') return typeof value === 'boolean';
    return typeof value === 'number' && leaf.range !== null && inRange(leaf.range, value);
  }

  private write(leaf: Leaf, value: ParamValue): void {
    leaf.owner[leaf.key] = value;
    leaf.after?.(leaf.path, value);
  }

  set(path: string, value: ParamValue): boolean {
    const leaf = this.leaves.get(path);
    if (!leaf || !this.valid(leaf, value)) return false;
    this.write(leaf, value);
    return true;
  }

  apply(overrides: Record<string, ParamValue>): () => void {
    const entries = Object.entries(overrides);
    const bad: string[] = [];
    for (const [path, value] of entries) {
      const leaf = this.leaves.get(path);
      if (!leaf) bad.push(`${path} (unknown path)`);
      else if (!this.valid(leaf, value)) bad.push(`${path}=${String(value)} (out of range or the wrong type)`);
    }
    if (bad.length > 0) throw new Error(`paramOverride.apply refused, nothing changed: ${bad.join('; ')}`);
    const before: Array<[Leaf, ParamValue]> = [];
    for (const [path, value] of entries) {
      const leaf = this.leaves.get(path) as Leaf;
      before.push([leaf, leaf.owner[leaf.key] as ParamValue]);
      this.write(leaf, value);
    }
    let restored = false;
    return () => {
      if (restored) return;
      restored = true;
      for (let i = before.length - 1; i >= 0; i--) this.write(before[i][0], before[i][1]);
    };
  }

  reset(): void {
    for (const leaf of this.leaves.values()) {
      if (leaf.owner[leaf.key] !== leaf.dflt) this.write(leaf, leaf.dflt);
    }
  }

  snapshot(): Record<string, ParamValue> {
    const out: Record<string, ParamValue> = {};
    for (const leaf of this.leaves.values()) {
      const now = leaf.owner[leaf.key] as ParamValue;
      if (now !== leaf.dflt) out[leaf.path] = now;
    }
    return out;
  }
}

let shared: ParamRegistry | null = null;

/** The page's one registry (the dev block's `window.__paramOverride`, the console's `ftune`). */
export function getParamOverride(): ParamRegistry {
  shared ??= new ParamRegistry();
  return shared;
}
