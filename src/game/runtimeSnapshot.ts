import type {
  Critter,
  Ctx,
  Enemy,
  EntityStatus,
  Mechanism,
  Pickup,
  Projectile,
} from '@/core/types';
import { VIEW_H, VIEW_W } from '@/config/constants';

export type RuntimeEntityGroup =
  | 'player'
  | 'enemies'
  | 'projectiles'
  | 'critters'
  | 'pickups'
  | 'mechanisms'
  | 'portal'
  | 'particles';

export type RuntimeSnapshotSourceId =
  | 'unavailable'
  | 'build'
  | 'expedition'
  | 'builder-live-preview'
  | 'builder-playtest'
  | 'test-run'
  | 'debug-run';

export interface RuntimeSnapshotSource {
  id: RuntimeSnapshotSourceId;
  label: string;
  detail: string;
}

export interface RuntimeEntityBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface RuntimeEntityRow {
  id: string;
  group: RuntimeEntityGroup;
  kind: string;
  label: string;
  sublabel: string;
  x: number;
  y: number;
  vx?: number;
  vy?: number;
  hp?: number;
  maxHp?: number;
  life?: number;
  state?: number;
  bounds?: RuntimeEntityBounds;
  visible: boolean;
  badges: string[];
  fields: Array<{ label: string; value: string }>;
  searchText: string;
}

export interface RuntimeGroupCount {
  group: RuntimeEntityGroup;
  label: string;
  total: number;
  visible: number;
  sampled: number;
}

export interface RuntimeParticleAggregate {
  total: number;
  visible: number;
  visual: number;
  depositing: number;
  homing: number;
  hostile: number;
  glowing: number;
  byMaterial: Array<{ label: string; count: number }>;
}

export interface RuntimeEntitySnapshot {
  frame: number;
  mode: Ctx['state']['mode'];
  source: RuntimeSnapshotSource;
  level: { id: string; name: string; depth: number } | null;
  rows: RuntimeEntityRow[];
  counts: RuntimeGroupCount[];
  particles: RuntimeParticleAggregate;
  selectedId: string | null;
  selectedRow: RuntimeEntityRow | null;
  selectedMissing: boolean;
  capped: boolean;
}

export interface RuntimeSnapshotOptions {
  source?: RuntimeSnapshotSource;
  selectedId?: string | null;
  maxRowsPerGroup?: Partial<Record<RuntimeEntityGroup, number>>;
  maxParticleMaterials?: number;
  /** Preserve source-array row order instead of reordering visible rows first. */
  preserveRowOrder?: boolean;
}

const GROUP_LABELS: Record<RuntimeEntityGroup, string> = {
  player: 'Player',
  enemies: 'Enemies',
  projectiles: 'Projectiles',
  critters: 'Critters',
  pickups: 'Pickups',
  mechanisms: 'Mechanisms',
  portal: 'Portal',
  particles: 'Particles',
};

const DEFAULT_ROW_LIMITS: Record<RuntimeEntityGroup, number> = {
  player: 1,
  enemies: 160,
  projectiles: 160,
  critters: 120,
  pickups: 160,
  mechanisms: 200,
  portal: 1,
  particles: 0,
};

const objectIds = new WeakMap<object, number>();
let nextObjectId = 1;

export function buildRuntimeEntitySnapshot(ctx: Ctx, options: RuntimeSnapshotOptions = {}): RuntimeEntitySnapshot {
  const limits = { ...DEFAULT_ROW_LIMITS, ...options.maxRowsPerGroup };
  const view = runtimeView(ctx);
  const preserveRowOrder = options.preserveRowOrder === true;
  const rows: RuntimeEntityRow[] = [];
  const counts = new Map<RuntimeEntityGroup, { total: number; visible: number; sampled: number }>();
  const selectedId = options.selectedId ?? null;
  let selectedRow: RuntimeEntityRow | null = null;

  const runtime = ctx.state.mode === 'play' ? ctx.levels.current : null;
  const activeRuntime = ctx.state.mode === 'play' && runtime !== null;
  const levelId = runtime?.def.id ?? 'none';
  const livePickups = runtime?.pickups.filter((pickup) => !pickup.taken) ?? [];

  const pushGroup = <T>(
    group: RuntimeEntityGroup,
    items: readonly T[],
    idOf: (item: T) => string,
    visibleOf: (item: T) => boolean,
    rowOf: (item: T) => RuntimeEntityRow,
  ): void => {
    const limit = limits[group];
    let visible = 0;
    let selectedItem: T | null = null;
    const visibleItems: T[] = [];
    const offscreenItems: T[] = [];
    const groupRows: RuntimeEntityRow[] = [];
    const sampledIds = new Set<string>();

    for (const item of items) {
      const isVisible = visibleOf(item);
      if (isVisible) visible++;
      if (selectedId !== null && idOf(item) === selectedId) selectedItem = item;
      if (limit <= 0) continue;
      if (preserveRowOrder) {
        if (groupRows.length < limit) {
          const id = idOf(item);
          sampledIds.add(id);
          groupRows.push(rowOf(item));
        }
        continue;
      }
      if (isVisible && visibleItems.length < limit) visibleItems.push(item);
      else if (!isVisible && offscreenItems.length < limit) offscreenItems.push(item);
    }

    if (!preserveRowOrder) {
      for (const item of visibleItems) {
        const id = idOf(item);
        sampledIds.add(id);
        groupRows.push(rowOf(item));
      }
      for (const item of offscreenItems) {
        if (groupRows.length >= limit) break;
        const id = idOf(item);
        sampledIds.add(id);
        groupRows.push(rowOf(item));
      }
    }
    if (selectedItem !== null) {
      const id = idOf(selectedItem);
      const selected = rowOf(selectedItem);
      selectedRow = selected;
      if (!sampledIds.has(id)) groupRows.push(selected);
    }

    rows.push(...groupRows);
    counts.set(group, { total: items.length, visible, sampled: groupRows.length });
  };

  pushGroup('player', activeRuntime ? [ctx] : [], () => 'player', (sourceCtx) => inView(view, sourceCtx.player.x, sourceCtx.player.y), (sourceCtx) => playerRow(sourceCtx, view));
  pushGroup('enemies', activeRuntime ? ctx.enemies : [], (enemy) => objectId('enemy', enemy), (enemy) => inView(view, enemy.x, enemy.y), (enemy) => enemyRow(ctx, enemy, view));
  pushGroup('projectiles', activeRuntime ? ctx.projectiles : [], (projectile) => objectId('projectile', projectile), (projectile) => inView(view, projectile.x, projectile.y), (projectile) => projectileRow(projectile, view));
  pushGroup('critters', activeRuntime ? ctx.critters.list : [], (critter) => objectId('critter', critter), (critter) => inView(view, critter.x, critter.y), (critter) => critterRow(critter, view));
  pushGroup('pickups', livePickups, (pickup) => objectId('pickup', pickup), (pickup) => inView(view, pickup.x, pickup.y), (pickup) => pickupRow(pickup, view));
  pushGroup(
    'mechanisms',
    runtime?.mechanisms ?? [],
    (mechanism) => mechanismId(levelId, mechanism),
    (mechanism) => mechanismVisible(view, mechanism),
    (mechanism) => mechanismRow(mechanism, view, levelId),
  );
  pushGroup('portal', runtime?.portal ? [runtime.portal] : [], () => `portal:${levelId}`, (portal) => inView(view, portal.x, portal.y), (portal) => portalRow(portal, view, levelId));

  const particles = activeRuntime ? aggregateParticles(ctx, view, options.maxParticleMaterials ?? 8) : emptyParticleAggregate();
  counts.set('particles', {
    total: particles.total,
    visible: particles.visible,
    sampled: 0,
  });

  const selectedMissing = selectedId !== null && selectedRow === null;
  const countRows = (Object.keys(GROUP_LABELS) as RuntimeEntityGroup[]).map((group) => {
    const count = counts.get(group) ?? { total: 0, visible: 0, sampled: 0 };
    return {
      group,
      label: GROUP_LABELS[group],
      total: count.total,
      visible: count.visible,
      sampled: count.sampled,
    };
  });

  return {
    frame: ctx.state.frameCount,
    mode: ctx.state.mode,
    source: options.source ?? inferRuntimeSource(ctx),
    level: runtime
      ? { id: runtime.def.id, name: runtime.def.name, depth: runtime.def.depth }
      : null,
    rows,
    counts: countRows,
    particles,
    selectedId,
    selectedRow,
    selectedMissing,
    capped: countRows.some((count) => count.group !== 'particles' && count.sampled < count.total),
  };
}

export function inferRuntimeSource(ctx: Ctx): RuntimeSnapshotSource {
  const runtime = ctx.levels.current;
  if (ctx.state.mode !== 'play') {
    return { id: 'build', label: 'Builder Authoring', detail: 'No active play runtime' };
  }
  if (!runtime) {
    return { id: 'unavailable', label: 'Unavailable', detail: 'No current level runtime' };
  }
  if (ctx.state.playtestSource === 'builder') {
    return { id: 'builder-playtest', label: 'Builder Playtest', detail: 'Disposable playtest runtime' };
  }
  if (ctx.state.playtestSource === 'test') {
    return { id: 'test-run', label: 'Test Run', detail: 'Disposable launcher/debug runtime' };
  }
  if (ctx.state.debugGodMode) {
    return { id: 'debug-run', label: 'Debug-Tainted Run', detail: 'Current expedition is debug-tainted' };
  }
  return { id: 'expedition', label: 'Expedition', detail: 'Persistent current expedition runtime' };
}

export function filterRuntimeRows(rows: readonly RuntimeEntityRow[], query: string, groups: ReadonlySet<RuntimeEntityGroup>): RuntimeEntityRow[] {
  const q = normalize(query);
  return rows.filter((row) => {
    if (groups.size > 0 && !groups.has(row.group)) return false;
    return q === '' || row.searchText.includes(q);
  });
}

function playerRow(ctx: Ctx, view: RuntimeView): RuntimeEntityRow {
  const p = ctx.player;
  return row({
    id: 'player',
    group: 'player',
    kind: 'player',
    label: p.dead ? 'Player (dead)' : 'Player',
    sublabel: `${fmt(p.x)}, ${fmt(p.y)} - hp ${fmt(p.hp)}/${fmt(p.maxHp)}`,
    x: p.x,
    y: p.y,
    vx: p.vx,
    vy: p.vy,
    hp: p.hp,
    maxHp: p.maxHp,
    bounds: bodyBounds(p.x, p.y, 5, 12),
    visible: inView(view, p.x, p.y),
    badges: [
      p.dead ? 'dead' : 'alive',
      p.grounded ? 'grounded' : 'airborne',
      p.crawling ? 'crawl' : '',
      statusBadge(p.status),
    ].filter(Boolean),
    fields: [
      field('position', `${fmt(p.x)}, ${fmt(p.y)}`),
      field('velocity', `${fmt(p.vx)}, ${fmt(p.vy)}`),
      field('hp', `${fmt(p.hp)} / ${fmt(p.maxHp)}`),
      field('mana', `${fmt(p.mana)} / ${fmt(p.maxMana)}`),
      field('levitation', `${fmt(p.levit)} / ${fmt(p.maxLevit)}`),
      field('status', statusText(p.status)),
    ],
  });
}

function enemyRow(ctx: Ctx, enemy: Enemy, view: RuntimeView): RuntimeEntityRow {
  const def = (ctx.enemyCtl as Ctx['enemyCtl'] | undefined)?.defs[enemy.kind];
  return row({
    id: objectId('enemy', enemy),
    group: 'enemies',
    kind: enemy.kind,
    label: enemy.kind,
    sublabel: `${fmt(enemy.x)}, ${fmt(enemy.y)} - hp ${fmt(enemy.hp)}/${fmt(enemy.maxHp)}`,
    x: enemy.x,
    y: enemy.y,
    vx: enemy.vx,
    vy: enemy.vy,
    hp: enemy.hp,
    maxHp: enemy.maxHp,
    bounds: def ? bodyBounds(enemy.x, enemy.y, def.halfW, def.h) : bodyBounds(enemy.x, enemy.y, 5, 8),
    visible: inView(view, enemy.x, enemy.y),
    badges: [
      enemy.sleeping ? 'sleeping' : '',
      enemy.grounded ? 'grounded' : 'airborne',
      enemy.alerted ? 'alerted' : '',
      statusBadge(enemy.status),
    ].filter(Boolean),
    fields: [
      field('kind', enemy.kind),
      field('position', `${fmt(enemy.x)}, ${fmt(enemy.y)}`),
      field('velocity', `${fmt(enemy.vx)}, ${fmt(enemy.vy)}`),
      field('hp', `${fmt(enemy.hp)} / ${fmt(enemy.maxHp)}`),
      field('timer', fmt(enemy.timer)),
      field('attack cooldown', fmt(enemy.attackCd)),
      field('status', statusText(enemy.status)),
    ],
  });
}

function projectileRow(projectile: Projectile, view: RuntimeView): RuntimeEntityRow {
  return row({
    id: objectId('projectile', projectile),
    group: 'projectiles',
    kind: projectile.type,
    label: projectile.type,
    sublabel: `${fmt(projectile.x)}, ${fmt(projectile.y)} - life ${projectile.life}`,
    x: projectile.x,
    y: projectile.y,
    vx: projectile.vx,
    vy: projectile.vy,
    life: projectile.life,
    bounds: pointBounds(projectile.x, projectile.y, projectileRadius(projectile)),
    visible: inView(view, projectile.x, projectile.y),
    badges: [
      projectile.hostile ? 'hostile' : 'friendly',
      projectile.charging ? 'charging' : '',
      projectile.mul && projectile.mul !== 1 ? `x${fmt(projectile.mul)}` : '',
    ].filter(Boolean),
    fields: [
      field('type', projectile.type),
      field('position', `${fmt(projectile.x)}, ${fmt(projectile.y)}`),
      field('velocity', `${fmt(projectile.vx)}, ${fmt(projectile.vy)}`),
      field('life', String(projectile.life)),
      field('age', String(projectile.age)),
      field('hostile', projectile.hostile ? 'yes' : 'no'),
    ],
  });
}

function critterRow(critter: Critter, view: RuntimeView): RuntimeEntityRow {
  return row({
    id: objectId('critter', critter),
    group: 'critters',
    kind: critter.kind,
    label: critter.kind,
    sublabel: `${fmt(critter.x)}, ${fmt(critter.y)}`,
    x: critter.x,
    y: critter.y,
    vx: critter.vx,
    vy: critter.vy,
    bounds: pointBounds(critter.x, critter.y, 2),
    visible: inView(view, critter.x, critter.y),
    badges: [critter.gasp > 0 ? `gasp ${critter.gasp}` : '', critter.facing < 0 ? 'left' : 'right'].filter(Boolean),
    fields: [
      field('kind', critter.kind),
      field('position', `${fmt(critter.x)}, ${fmt(critter.y)}`),
      field('velocity', `${fmt(critter.vx)}, ${fmt(critter.vy)}`),
      field('phase', fmt(critter.phase)),
      field('gasp', String(critter.gasp)),
    ],
  });
}

function pickupRow(pickup: Pickup, view: RuntimeView): RuntimeEntityRow {
  const data = pickup.data.card ?? pickup.data.potion ?? pickup.data.amount ?? '';
  return row({
    id: objectId('pickup', pickup),
    group: 'pickups',
    kind: pickup.kind,
    label: pickup.kind,
    sublabel: `${fmt(pickup.x)}, ${fmt(pickup.y)}${data !== '' ? ` - ${data}` : ''}`,
    x: pickup.x,
    y: pickup.y,
    vx: pickup.vx,
    vy: pickup.vy,
    bounds: pointBounds(pickup.x, pickup.y, 3),
    visible: inView(view, pickup.x, pickup.y),
    badges: [pickup.taken ? 'taken' : 'available'].filter(Boolean),
    fields: [
      field('kind', pickup.kind),
      field('position', `${fmt(pickup.x)}, ${fmt(pickup.y)}`),
      field('velocity', `${fmt(pickup.vx)}, ${fmt(pickup.vy)}`),
      field('taken', pickup.taken ? 'yes' : 'no'),
      field('data', data === '' ? '-' : String(data)),
    ],
  });
}

function mechanismRow(mechanism: Mechanism, view: RuntimeView, levelId: string): RuntimeEntityRow {
  const brokenLabel =
    mechanism.broken === undefined ? '' : mechanism.broken > 0 ? `breaking ${mechanism.broken}` : 'broken open';
  return row({
    id: mechanismId(levelId, mechanism),
    group: 'mechanisms',
    kind: mechanism.kind,
    label: `${mechanism.kind} #${mechanism.id}`,
    sublabel: `${fmt(mechanism.x)}, ${fmt(mechanism.y)} - state ${fmt(mechanism.state)}`,
    x: mechanism.x,
    y: mechanism.y,
    state: mechanism.state,
    bounds: mechanismBounds(mechanism),
    visible: mechanismVisible(view, mechanism),
    badges: [
      mechanism.logic ? `logic ${mechanism.logic}` : '',
      mechanism.pressed ? 'pressed' : '',
      brokenLabel,
      mechanism.seqDone ? 'sequence done' : '',
    ].filter(Boolean),
    fields: [
      field('id', String(mechanism.id)),
      field('kind', mechanism.kind),
      field('position', `${fmt(mechanism.x)}, ${fmt(mechanism.y)}`),
      field('size', `${mechanism.w} x ${mechanism.h}`),
      field('state', fmt(mechanism.state)),
      field('target', mechanism.targetId === undefined ? '-' : String(mechanism.targetId)),
      field('logic', mechanism.logic ?? '-'),
      field('broken', brokenLabel || 'no'),
    ],
  });
}

function portalRow(portal: { x: number; y: number; open: boolean }, view: RuntimeView, levelId: string): RuntimeEntityRow {
  return row({
    id: `portal:${levelId}`,
    group: 'portal',
    kind: 'portal',
    label: 'Exit Portal',
    sublabel: `${fmt(portal.x)}, ${fmt(portal.y)} - ${portal.open ? 'open' : 'closed'}`,
    x: portal.x,
    y: portal.y,
    bounds: { x0: portal.x - 5, y0: portal.y - 14, x1: portal.x + 6, y1: portal.y + 1 },
    visible: inView(view, portal.x, portal.y),
    badges: [portal.open ? 'open' : 'closed'],
    fields: [
      field('position', `${fmt(portal.x)}, ${fmt(portal.y)}`),
      field('open', portal.open ? 'yes' : 'no'),
    ],
  });
}

function aggregateParticles(ctx: Ctx, view: RuntimeView, maxMaterials: number): RuntimeParticleAggregate {
  const byMaterial = new Map<string, number>();
  let visible = 0;
  let visual = 0;
  let depositing = 0;
  let homing = 0;
  let hostile = 0;
  let glowing = 0;

  for (const particle of ctx.particles.list) {
    if (inView(view, particle.x, particle.y)) visible++;
    if (particle.type === null) visual++;
    else {
      depositing++;
      const label = materialName(ctx, particle.type);
      byMaterial.set(label, (byMaterial.get(label) ?? 0) + 1);
    }
    if (particle.homing) homing++;
    if (particle.hostileDmg > 0) hostile++;
    if (particle.glow > 0) glowing++;
  }

  return {
    total: ctx.particles.list.length,
    visible,
    visual,
    depositing,
    homing,
    hostile,
    glowing,
    byMaterial: [...byMaterial.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, Math.max(0, maxMaterials))
      .map(([label, count]) => ({ label, count })),
  };
}

function emptyParticleAggregate(): RuntimeParticleAggregate {
  return {
    total: 0,
    visible: 0,
    visual: 0,
    depositing: 0,
    homing: 0,
    hostile: 0,
    glowing: 0,
    byMaterial: [],
  };
}

interface RuntimeView {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function runtimeView(ctx: Ctx): RuntimeView {
  const cam = ctx.camera;
  const zoom = Math.max(0.001, cam.zoom);
  return {
    x0: cam.renderX + VIEW_W * (0.5 - 0.5 / zoom),
    y0: cam.renderY + VIEW_H * (0.5 - 0.5 / zoom),
    x1: cam.renderX + VIEW_W * (0.5 + 0.5 / zoom),
    y1: cam.renderY + VIEW_H * (0.5 + 0.5 / zoom),
  };
}

function inView(view: RuntimeView, x: number, y: number): boolean {
  return x >= view.x0 && x <= view.x1 && y >= view.y0 && y <= view.y1;
}

function mechanismId(levelId: string, mechanism: Mechanism): string {
  return `mechanism:${levelId}:${mechanism.id}`;
}

function mechanismVisible(view: RuntimeView, mechanism: Mechanism): boolean {
  const bounds = mechanismBounds(mechanism);
  return bounds.x1 >= view.x0 && bounds.x0 <= view.x1 && bounds.y1 >= view.y0 && bounds.y0 <= view.y1;
}

function mechanismBounds(mechanism: Mechanism): { x0: number; y0: number; x1: number; y1: number } {
  if (mechanism.body && mechanism.body.length > 0) {
    let x0 = Number.POSITIVE_INFINITY;
    let y0 = Number.POSITIVE_INFINITY;
    let x1 = Number.NEGATIVE_INFINITY;
    let y1 = Number.NEGATIVE_INFINITY;
    for (const [x, y] of mechanism.body) {
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
    return { x0, y0, x1, y1 };
  }
  if (mechanism.zone) {
    return {
      x0: mechanism.zone.x0,
      y0: mechanism.zone.y0,
      x1: mechanism.zone.x1 + 1,
      y1: mechanism.zone.y1 + 1,
    };
  }
  const x0 = Math.min(mechanism.x, mechanism.x + mechanism.w);
  const x1 = Math.max(mechanism.x, mechanism.x + mechanism.w);
  const y0 = Math.min(mechanism.y, mechanism.y + mechanism.h);
  const y1 = Math.max(mechanism.y, mechanism.y + mechanism.h);
  return { x0, y0, x1, y1 };
}

function bodyBounds(x: number, y: number, halfW: number, h: number): RuntimeEntityBounds {
  return {
    x0: x - halfW,
    y0: y - h + 1,
    x1: x + halfW + 1,
    y1: y + 1,
  };
}

function pointBounds(x: number, y: number, radius: number): RuntimeEntityBounds {
  return {
    x0: x - radius,
    y0: y - radius,
    x1: x + radius + 1,
    y1: y + radius + 1,
  };
}

function projectileRadius(projectile: Projectile): number {
  if (projectile.type === 'meteor' || projectile.type === 'blackhole') return 5;
  if (projectile.type === 'bomb' || projectile.type === 'fireball' || projectile.type === 'acidglob') return 3;
  return 2;
}

function objectId(prefix: string, object: object): string {
  let id = objectIds.get(object);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(object, id);
  }
  return `${prefix}:${id}`;
}

function row(input: Omit<RuntimeEntityRow, 'searchText'>): RuntimeEntityRow {
  const searchText = normalize([
    input.id,
    input.group,
    input.kind,
    input.label,
    input.sublabel,
    ...input.badges,
    ...input.fields.map((field) => `${field.label} ${field.value}`),
  ].join(' '));
  return { ...input, searchText };
}

function field(label: string, value: string): { label: string; value: string } {
  return { label, value };
}

function fmt(n: number): string {
  return Number.isFinite(n) ? (Math.round(n * 10) / 10).toString() : String(n);
}

function materialName(ctx: Ctx, type: number): string {
  return ctx.params.materials[type]?.name ?? `material ${type}`;
}

function statusBadge(status: { wet: number; oiled: number; burning: number; frozen: number; electrified: number }): string {
  if (status.electrified > 0) return 'electrified';
  if (status.burning > 0) return 'burning';
  if (status.frozen > 0) return 'frozen';
  if (status.oiled > 0) return 'oiled';
  if (status.wet > 0) return 'wet';
  return '';
}

function statusText(status: EntityStatus): string {
  const active = (Object.entries(status) as Array<[keyof EntityStatus, number]>).filter(([, value]) => value > 0);
  return active.length === 0 ? 'none' : active.map(([key, value]) => `${key} ${value}`).join(', ');
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}
