import { HEIGHT, WIDTH } from '@/config/constants';
import { blocksEntity, Cell } from '@/sim/CellType';
import { decodeTypes, paramNum } from '@/builder/document';
import type { EditorDocument, EditorObject, EditorObjectKind } from '@/builder/document';
import { getStoredSprite } from '@/builder/assets/spritelib';
import { PLUG_CELLS, SENSOR_FILTER_CELLS, VALVE_CELLS } from '@/game/instantiate';
import {
  stampBuoyBasin,
  stampCauldron,
  stampExitWell,
  stampRuneDoor,
  stampRunePedestal,
} from '@/builder/stamps';

/**
 * Document validation service (docs/BUILDER.md Phase 10): visible, fast,
 * specific. Structural checks first (ids, links, params), then findability
 * as a FIXPOINT progression simulation: BFS from spawn, open every door
 * whose full visible trigger set became reachable (the runtime AND gate)
 * and every rune door whose glyph became reachable, repeat until stable.
 * The final mask is "everything a player can earn" — sequenced puzzles
 * (lever behind door A opens door B) validate correctly, and a door that
 * can never open (no compiled trigger) correctly seals its rewards.
 *
 * Hidden objects mirror the compiler exactly: they do not stamp, do not
 * compile, and their links are dead — so hiding a linked trigger flags the
 * door it strands instead of validating a sealed-forever vault.
 */

export interface DocIssue {
  severity: 'error' | 'warning' | 'info';
  what: string;
  objId?: string;
}

/** Animated-decor volume thresholds (warnings, never errors — decor is
 *  visual-only; the worst it can do is cost frame time). */
export const DECOR_COUNT_WARN = 48;
export const DECOR_FRAME_WARN = 96;

/** Object kinds that compile to actuator-driving runtime triggers (valid
 *  LINK sources). A relay is both: it receives links AND emits one. */
export const TRIGGER_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'plate',
  'lever',
  'brazier',
  'scale',
  'buoy',
  'chargeLatch',
  // machine primitives
  'sensor',
  'counterweight',
  'plug',
  'relay',
] as EditorObjectKind[]);

/** Hands-on triggers the player must physically reach to operate (plugs,
 *  sensors, and relays earn differently in the fixpoint). */
const POSITIONAL_TRIGGER_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'plate',
  'lever',
  'brazier',
  'scale',
  'buoy',
  'chargeLatch',
  'counterweight',
] as EditorObjectKind[]);

/** Valid LINK receivers (plugs only from relays — the detonator pattern). */
export const ACTUATOR_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'door',
  'valve',
  'relay',
] as EditorObjectKind[]);

/* ---------------- scratch grid: document terrain + compile stamps ---------------- */

/**
 * Stamp every structural object the compiler would stamp onto a types grid.
 * Doors/rune doors in `openIds` stamp open (cleared); the rest stamp solid.
 * Trigger furniture mirrors the game/Mechanisms.ts factories cell for cell
 * (plate sill, scale pan + lips, brazier bowl, latch pedestal) so the
 * reachability audit walks the same world the compiler builds.
 */
function stampObjects(types: Uint8Array, doc: EditorDocument, openIds: ReadonlySet<string>): void {
  const set = (x: number, y: number, t: number): void => {
    if (x >= 0 && y >= 0 && x < WIDTH && y < HEIGHT) types[x + y * WIDTH] = t;
  };
  for (const o of doc.objects) {
    if (o.hidden) continue;
    const x = Math.floor(o.x),
      y = Math.floor(o.y);
    if (o.kind === 'exitWell') {
      stampExitWell(set, x, y, paramNum(o, 'halfW', 14), HEIGHT);
    } else if (o.kind === 'cauldron') {
      stampCauldron(set, x, y);
    } else if (o.kind === 'buoy') {
      stampBuoyBasin(set, x, y, paramNum(o, 'w', 13), paramNum(o, 'depth', 4));
    } else if (o.kind === 'runeGlyph') {
      stampRunePedestal(set, x, y);
    } else if (o.kind === 'door') {
      const w = paramNum(o, 'w', 3),
        h = paramNum(o, 'h', 13);
      const open = openIds.has(o.id);
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, open ? Cell.Empty : Cell.Metal);
      }
    } else if (o.kind === 'runeDoor') {
      const w = paramNum(o, 'w', 2),
        h = paramNum(o, 'h', 11);
      if (openIds.has(o.id)) {
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, Cell.Empty);
        }
      } else {
        stampRuneDoor(set, x, y, w, h);
      }
    } else if (o.kind === 'plate') {
      // mirror makePlate: a 1-row metal sill, w wide (left edge at x - w/2)
      const w = paramNum(o, 'w', 5);
      const hw = Math.floor(w / 2);
      for (let dx = 0; dx < w; dx++) set(x - hw + dx, y, Cell.Metal);
    } else if (o.kind === 'scale') {
      // mirror makeScale: pan row + 3-tall lip columns at both ends
      const w = paramNum(o, 'w', 7);
      const hw = Math.floor(w / 2);
      const left = x - hw;
      for (let dx = 0; dx < w; dx++) set(left + dx, y, Cell.Metal);
      for (const dx of [-1, w]) {
        for (let dy = 0; dy <= 2; dy++) set(left + dx, y - dy, Cell.Metal);
      }
    } else if (o.kind === 'valve') {
      // mirror makeValve: a material slab, cleared when earned open
      const w = paramNum(o, 'w', 5),
        h = paramNum(o, 'h', 2);
      const mat = VALVE_CELLS[String(o.params.material ?? 'metal')] ?? Cell.Metal;
      const open = openIds.has(o.id);
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, open ? Cell.Empty : mat);
      }
    } else if (o.kind === 'plug') {
      // mirror makePlug: a material block, cleared once breakable/earned
      const w = paramNum(o, 'w', 3),
        h = paramNum(o, 'h', 3);
      const mat = PLUG_CELLS[String(o.params.material ?? 'wood')] ?? Cell.Wood;
      const open = openIds.has(o.id);
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, open ? Cell.Empty : mat);
      }
    } else if (o.kind === 'counterweight') {
      // mirror makeCounterweight: pan row + 4-tall lip columns at both ends
      const w = paramNum(o, 'w', 7);
      const left = x - Math.floor(w / 2);
      for (let dx = 0; dx < w; dx++) set(left + dx, y, Cell.Metal);
      for (const dx of [-1, w]) {
        for (let dy = 0; dy <= 3; dy++) set(left + dx, y - dy, Cell.Metal);
      }
    } else if (o.kind === 'chargeLatch') {
      // mirror makeChargeLatch: a 5-wide conductive pedestal
      for (let dx = -2; dx <= 2; dx++) set(x + dx, y, Cell.Metal);
    } else if (o.kind === 'brazier') {
      // mirror makeBrazier: stone bowl with raised tips
      for (let dx = -2; dx <= 2; dx++) set(x + dx, y, Cell.Stone);
      set(x - 2, y - 1, Cell.Stone);
      set(x + 2, y - 1, Cell.Stone);
    }
    // lever: no stamp — its footing is whatever terrain is already there
  }
}

/** Decode the document terrain and stamp it as compiled (for tests/tools). */
export function buildScratchGrid(doc: EditorDocument, openIds: ReadonlySet<string>): Uint8Array {
  const types = decodeTypes(doc.world!);
  stampObjects(types, doc, openIds);
  return types;
}

/* ---------------- reachability ---------------- */

function bfsMask(types: Uint8Array, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(WIDTH * HEIGHT);
  const qx = new Int32Array(WIDTH * HEIGHT);
  const qy = new Int32Array(WIDTH * HEIGHT);
  let head = 0,
    tail = 0;
  const push = (x: number, y: number): void => {
    if (x < 1 || y < 1 || x >= WIDTH - 1 || y >= HEIGHT - 1) return;
    const i = x + y * WIDTH;
    if (seen[i] || blocksEntity(types[i])) return;
    seen[i] = 1;
    qx[tail] = x;
    qy[tail] = y;
    tail++;
  };
  push(Math.floor(sx), Math.floor(sy));
  while (head < tail) {
    const x = qx[head],
      y = qy[head];
    head++;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return seen;
}

/**
 * Player-clearance erosion: marks feet positions where a 5-wide x 9-tall
 * clear box fits (half the wizard's 9x17 — forgiving on purpose; this feeds
 * WARNINGS for chokepoints, not errors). Two separable sliding-window
 * passes, O(cells).
 */
function erodePassable(types: Uint8Array): Uint8Array {
  const pass = new Uint8Array(WIDTH * HEIGHT);
  for (let i = 0; i < pass.length; i++) pass[i] = blocksEntity(types[i]) ? 0 : 1;
  const h = new Uint8Array(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y++) {
    const row = y * WIDTH;
    let run = 0;
    for (let x = 0; x < WIDTH; x++) {
      run = pass[row + x] ? run + 1 : 0;
      if (run >= 5) h[row + x - 2] = 1;
    }
  }
  const eroded = new Uint8Array(WIDTH * HEIGHT);
  for (let x = 0; x < WIDTH; x++) {
    let run = 0;
    for (let y = 0; y < HEIGHT; y++) {
      run = h[x + y * WIDTH] ? run + 1 : 0;
      if (run >= 9) eroded[x + y * WIDTH] = 1; // feet row of a clear column
    }
  }
  return eroded;
}

/** BFS over a precomputed passability mask (1 = passable). */
function bfsOverMask(passable: Uint8Array, sx: number, sy: number): Uint8Array {
  const seen = new Uint8Array(WIDTH * HEIGHT);
  const qx = new Int32Array(WIDTH * HEIGHT);
  const qy = new Int32Array(WIDTH * HEIGHT);
  let head = 0,
    tail = 0;
  const push = (x: number, y: number): void => {
    if (x < 1 || y < 1 || x >= WIDTH - 1 || y >= HEIGHT - 1) return;
    const i = x + y * WIDTH;
    if (seen[i] || !passable[i]) return;
    seen[i] = 1;
    qx[tail] = x;
    qy[tail] = y;
    tail++;
  };
  push(sx, sy);
  while (head < tail) {
    const x = qx[head],
      y = qy[head];
    head++;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return seen;
}

function near(mask: Uint8Array, x: number, y: number, r: number): boolean {
  for (let dy = -r; dy <= r; dy++) {
    for (let dx = -r; dx <= r; dx++) {
      const X = Math.floor(x) + dx,
        Y = Math.floor(y) + dy;
      if (X > 0 && Y > 0 && X < WIDTH && Y < HEIGHT && mask[X + Y * WIDTH]) return true;
    }
  }
  return false;
}

/** Where a player must stand to operate a trigger (matches the error checks). */
function triggerReachable(mask: Uint8Array, o: EditorObject): boolean {
  return near(mask, o.x, o.y - 2, 4);
}

function glyphReachable(mask: Uint8Array, o: EditorObject): boolean {
  return near(mask, o.x, o.y - 3, 5);
}

/* ---------------- the validation pass ---------------- */

export function validateDocument(doc: EditorDocument): DocIssue[] {
  const issues: DocIssue[] = [];
  const push = (severity: DocIssue['severity'], what: string, objId?: string): void => {
    issues.push({ severity, what, objId });
  };

  // ---- ids must be unique across every record family ----
  const ids = new Set<string>();
  const allIds = [
    ...doc.objects.map((o) => o.id),
    ...doc.lights.map((l) => l.id),
    ...doc.links.map((l) => l.id),
  ];
  for (const id of allIds) {
    if (ids.has(id)) push('error', 'duplicate id: ' + id);
    ids.add(id);
  }

  // ---- spawn ----
  const spawns = doc.objects.filter((o) => o.kind === 'spawn');
  if (spawns.length === 0) push('error', 'No player spawn placed');
  if (spawns.length > 1) push('error', 'Multiple spawns placed');

  // ---- bounds ----
  for (const o of doc.objects) {
    if (o.x < 4 || o.x >= WIDTH - 4 || o.y < 4 || o.y >= HEIGHT - 4) {
      push('error', o.kind + ' outside world bounds', o.id);
    }
  }
  for (const l of doc.lights) {
    if (l.x < 0 || l.x >= WIDTH || l.y < 0 || l.y >= HEIGHT) {
      push('error', 'light outside world bounds', l.id);
    }
  }

  // ---- link integrity (hidden endpoints are dead links: the compiler skips them) ----
  const byId = new Map(doc.objects.map((o) => [o.id, o] as const));
  for (const l of doc.links) {
    const from = byId.get(l.fromId);
    const to = byId.get(l.toId);
    if (!from || !to) {
      push('error', 'link endpoint missing (' + (from ? l.toId : l.fromId) + ')');
      continue;
    }
    if (l.kind === 'triggerDoor') {
      if (!TRIGGER_KINDS.has(from.kind))
        push('error', 'link source ' + from.kind + ' is not a trigger', from.id);
      const toOk =
        ACTUATOR_KINDS.has(to.kind) || (to.kind === 'plug' && from.kind === 'relay');
      if (!toOk) {
        push(
          'error',
          from.kind === 'relay'
            ? 'relay linked to ' + to.kind + ' — relays drive doors, valves, relays, or plugs'
            : 'trigger linked to ' + to.kind + ' — triggers drive doors, valves, or relays',
          to.id,
        );
      }
      if (l.fromId === l.toId) push('error', 'mechanism linked to itself', from.id);
    } else if (l.kind === 'runeDoor') {
      if (from.kind !== 'runeGlyph')
        push('error', 'rune link source must be a rune glyph', from.id);
      if (to.kind !== 'runeDoor')
        push('error', 'rune glyph linked to ' + to.kind + ' — glyphs open rune doors', to.id);
    }
    if (l.logic !== undefined && l.logic !== 'and') {
      push('info', "link-level logic is ignored — set AND/OR/SEQUENCE on the door's logic field", from.id);
    }
    if (from.hidden || to.hidden) {
      push(
        'warning',
        'link touches a hidden object — it will not compile (the door loses this trigger)',
        from.hidden ? from.id : to.id,
      );
    }
  }

  /** Links the compiler will actually wire: both endpoints visible. */
  const liveLinks = doc.links.filter((l) => {
    const from = byId.get(l.fromId);
    const to = byId.get(l.toId);
    return from && to && !from.hidden && !to.hidden;
  });

  // sequence chains advance on rising edges — a trigger that can never
  // un-fire jams the chain forever after one wrong order (doors, valves,
  // and relays can all carry sequence logic)
  const checkSequenceChain = (o: EditorObject): void => {
    if (o.params.logic !== 'sequence') return;
    const chain = liveLinks
      .filter((l) => l.kind === 'triggerDoor' && l.toId === o.id)
      .map((l) => byId.get(l.fromId)!)
      .filter((t) => !t.hidden);
    const oneWay = chain.find(
      (t) =>
        t.kind === 'brazier' ||
        t.kind === 'chargeLatch' ||
        t.kind === 'plug' ||
        t.kind === 'counterweight' ||
        t.kind === 'relay' ||
        (t.kind === 'sensor' && t.params.latch === 'permanent'),
    );
    if (oneWay)
      push(
        'error',
        `sequence chain contains a ${oneWay.kind} — it can never un-fire, so one wrong order jams the chain forever (use plates/levers/scales/buoys/timed sensors, or AND)`,
        o.id,
      );
    if (chain.some((t) => t.kind === 'scale' || t.kind === 'buoy'))
      push(
        'warning',
        'sequence chain contains a scale/buoy — retrying a broken order means physically removing the poured material',
        o.id,
      );
  };

  // ---- per-object wiring requirements (hidden objects don't compile: skip) ----
  for (const o of doc.objects) {
    if (o.hidden) continue;
    if (o.kind === 'relay') {
      // a relay is both receiver and trigger: it needs inputs to ever fire,
      // and at most one output (its fire is a single handoff)
      const outs = liveLinks.filter((l) => l.fromId === o.id && l.kind === 'triggerDoor');
      const ins = liveLinks.filter((l) => l.toId === o.id && l.kind === 'triggerDoor');
      if (ins.length === 0) push('error', 'relay has no inputs — it can never fire', o.id);
      if (outs.length === 0)
        push('warning', 'relay drives nothing — its fire has no effect', o.id);
      if (outs.length > 1)
        push('error', 'relay drives several targets — one relay fires one output', o.id);
      checkSequenceChain(o);
    } else if (TRIGGER_KINDS.has(o.kind)) {
      const outs = liveLinks.filter((l) => l.fromId === o.id && l.kind === 'triggerDoor');
      if (outs.length === 0) {
        if (o.kind === 'plug')
          push('info', 'plug signals nothing — a pure breakable seal (that is fine)', o.id);
        else
          push('error', o.kind + ' is not linked to any door/valve/relay (use the LINK tool)', o.id);
      }
      if (outs.length > 1)
        push(
          'error',
          o.kind + ' drives several targets — one trigger drives one (AND = many triggers on ONE actuator)',
          o.id,
        );
    } else if (o.kind === 'door') {
      const hasTrigger = liveLinks.some((l) => l.toId === o.id && l.kind === 'triggerDoor');
      if (!hasTrigger && o.params.initialOpen !== true)
        push('warning', 'door has no trigger — it can never open', o.id);
      if (hasTrigger && o.params.initialOpen === true)
        push(
          'warning',
          'initialOpen is overridden by trigger logic — the runtime slams this door shut at playtest start',
          o.id,
        );
      const lg = o.params.logic;
      if (lg !== undefined && lg !== 'and' && lg !== 'or' && lg !== 'sequence')
        push('warning', `unknown door logic '${String(lg)}' — it will compile as AND`, o.id);
      checkSequenceChain(o);
    } else if (o.kind === 'valve') {
      const hasTrigger = liveLinks.some((l) => l.toId === o.id && l.kind === 'triggerDoor');
      if (!hasTrigger) push('warning', 'valve has no trigger — it can never open', o.id);
      checkSequenceChain(o);
    } else if (o.kind === 'runeGlyph') {
      if (!liveLinks.some((l) => l.fromId === o.id && l.kind === 'runeDoor'))
        push('error', 'rune glyph opens nothing — link it to a rune door', o.id);
    } else if (o.kind === 'runeDoor') {
      if (!liveLinks.some((l) => l.toId === o.id && l.kind === 'runeDoor'))
        push('error', 'rune door has no glyph — it can never dissolve', o.id);
    }
  }

  // ---- relays that can never fire even if every hands-on trigger were
  //      earned: pure relay cycles (empty inputs already errored above) ----
  {
    const relayObjs = doc.objects.filter((o) => !o.hidden && o.kind === 'relay');
    const fired = new Set<string>();
    let grew = true;
    while (grew) {
      grew = false;
      for (const r of relayObjs) {
        if (fired.has(r.id)) continue;
        const ins = liveLinks
          .filter((l) => l.kind === 'triggerDoor' && l.toId === r.id)
          .map((l) => byId.get(l.fromId)!)
          .filter((t) => !t.hidden);
        const ok =
          ins.length > 0 &&
          (r.params.logic === 'or'
            ? ins.some((t) => t.kind !== 'relay' || fired.has(t.id))
            : ins.every((t) => t.kind !== 'relay' || fired.has(t.id)));
        if (ok) {
          fired.add(r.id);
          grew = true;
        }
      }
    }
    for (const r of relayObjs) {
      const hasIns = liveLinks.some((l) => l.kind === 'triggerDoor' && l.toId === r.id);
      if (hasIns && !fired.has(r.id))
        push('error', 'relay can never fire — its inputs form a relay cycle', r.id);
    }
  }

  // ---- sensor capacity: a threshold its zone cannot physically hold ----
  for (const o of doc.objects) {
    if (o.hidden) continue;
    if (o.kind === 'sensor') {
      const area = paramNum(o, 'zoneW', 9) * paramNum(o, 'zoneH', 7);
      if (area > 200)
        push(
          'warning',
          `sensor zone ~${area} cells — keep zones under ~200 (sense a drain channel, not the whole reservoir)`,
          o.id,
        );
      if (
        String(o.params.type ?? 'heat') === 'material' &&
        SENSOR_FILTER_CELLS[String(o.params.filter ?? '')] === undefined
      )
        push('error', 'material sensor needs a filter material', o.id);
      const cap = Math.max(1, area);
      if (paramNum(o, 'threshold', 6) > cap)
        push('warning', `sensor threshold ${paramNum(o, 'threshold', 6)} exceeds its zone area (~${cap} cells)`, o.id);
    } else if (o.kind === 'counterweight') {
      const capacity = paramNum(o, 'w', 7) * 7; // zone is w wide x 7 rows tall
      if (paramNum(o, 'threshold', 30) > capacity)
        push(
          'warning',
          `counterweight threshold ${paramNum(o, 'threshold', 30)} exceeds its pan capacity (~${capacity} cells)`,
          o.id,
        );
    } else if (o.kind === 'scale') {
      const capacity = paramNum(o, 'w', 7) * 7; // zone is w wide x 7 rows tall
      if (paramNum(o, 'threshold', 24) > capacity)
        push(
          'warning',
          `scale threshold ${paramNum(o, 'threshold', 24)} exceeds its pan capacity (~${capacity} cells)`,
          o.id,
        );
    } else if (o.kind === 'buoy') {
      // the basin interior is 2*half-1 wide (see stampBuoyBasin)
      const half = Math.max(2, Math.floor(paramNum(o, 'w', 13) / 2));
      const capacity = (2 * half - 1) * paramNum(o, 'depth', 4);
      if (paramNum(o, 'threshold', 26) > capacity)
        push(
          'warning',
          `buoy threshold ${paramNum(o, 'threshold', 26)} exceeds its basin capacity (~${capacity} cells)`,
          o.id,
        );
    }
  }

  // ---- lights sanity ----
  for (const l of doc.lights) {
    if (l.radius < 4 || l.radius > 160)
      push('warning', 'light radius ' + l.radius + ' outside sane range 4-160', l.id);
    if (l.intensity <= 0 || l.intensity > 4)
      push('warning', 'light intensity ' + l.intensity + ' outside sane range 0-4', l.id);
  }

  // ---- animated decor volume (visual-only by invariant, but not free to draw) ----
  const spriteDecors = doc.objects.filter(
    (o) =>
      !o.hidden &&
      o.kind === 'decor' &&
      typeof o.params.spriteId === 'string' &&
      o.params.spriteId !== '',
  );
  if (spriteDecors.length > DECOR_COUNT_WARN) {
    push(
      'warning',
      `${spriteDecors.length} animated decors — above ~${DECOR_COUNT_WARN} the sprite pass costs real frame time`,
    );
  }
  {
    const seen = new Set<string>();
    for (const o of spriteDecors) {
      const id = o.params.spriteId as string;
      if (seen.has(id)) continue;
      seen.add(id);
      const asset =
        doc.assets?.sprites.find((s) => s.id === id) ?? getStoredSprite(id);
      if (asset && (asset.w > DECOR_FRAME_WARN || asset.h > DECOR_FRAME_WARN)) {
        push(
          'warning',
          `sprite "${asset.name}" is ${asset.w}x${asset.h} — frames above ${DECOR_FRAME_WARN}px are a lot of setPx per instance`,
          o.id,
        );
      }
    }
  }

  // ---- win condition ----
  const portal = doc.objects.find((o) => o.kind === 'exitPortal' && !o.hidden);
  const well = doc.objects.find((o) => o.kind === 'exitWell' && !o.hidden);
  const key = doc.objects.find((o) => o.kind === 'pickup' && o.params.kind === 'key' && !o.hidden);
  if (portal && !key && portal.params.alwaysOpen !== true) {
    push(
      'warning',
      'Portal has no golden key and is not marked always-open — it can never open',
      portal.id,
    );
  }
  if (!portal && !well) push('info', 'No exit portal or exit well: custom level has no win exit');

  // ---- terrain-dependent checks ----
  if (!doc.world) {
    push('warning', 'No terrain captured — playtest will use the live sandbox world');
    return issues;
  }

  const baseTypes = decodeTypes(doc.world);
  // Round-0 open set mirrors the runtime at t=0: a door with ANY live
  // trigger gets slammed shut on the first update tick even if initialOpen,
  // so only trigger-less initialOpen doors start the fixpoint open.
  const initialOpen = new Set(
    doc.objects
      .filter(
        (o) =>
          o.kind === 'door' &&
          !o.hidden &&
          o.params.initialOpen === true &&
          !liveLinks.some((l) => l.kind === 'triggerDoor' && l.toId === o.id),
      )
      .map((o) => o.id),
  );
  const closed = baseTypes.slice();
  stampObjects(closed, doc, initialOpen);
  const blockedAt = (g: Uint8Array, x: number, y: number): boolean =>
    blocksEntity(g[Math.floor(x) + Math.floor(y) * WIDTH]);

  // spawn embedded (the wizard is 9x17)
  if (spawns.length === 1) {
    const s = spawns[0];
    let blocked = false;
    for (let dy = 0; dy < 17 && !blocked; dy += 4) {
      for (let dx = -4; dx <= 4 && !blocked; dx += 4) {
        if (blockedAt(closed, s.x + dx, s.y - dy)) blocked = true;
      }
    }
    if (blocked) push('error', 'Spawn is embedded in blocking cells', s.id);
  }

  // embedded enemies/pickups/emitters (against the world as first compiled)
  for (const o of doc.objects) {
    if (o.hidden) continue;
    if ((o.kind === 'enemy' || o.kind === 'pickup') && blockedAt(closed, o.x, o.y - 2)) {
      push('warning', o.kind + ' embedded in blocking cells', o.id);
    }
    if (o.kind === 'hazardEmitter') {
      if (blockedAt(closed, o.x, o.y))
        push('warning', 'hazard emitter buried in blocking cells — it will never drip', o.id);
      if (
        spawns.length === 1 &&
        Math.abs(o.x - spawns[0].x) < 18 &&
        o.y <= spawns[0].y &&
        spawns[0].y - o.y < 120
      )
        push('warning', 'hazard emitter drips onto the spawn point', o.id);
    }
  }

  // lever footing: the only trigger whose body is bare terrain — no footing
  // means it breaks on its own and the gate fail-opens unprompted
  for (const o of doc.objects) {
    if (o.hidden || o.kind !== 'lever') continue;
    let footing = 0;
    for (let dx = -1; dx <= 1; dx++) {
      if (blockedAt(closed, o.x + dx, o.y + 1)) footing++;
    }
    if (footing < 2)
      push('warning', 'lever has almost no footing — it will shake loose and fail open', o.id);
  }

  // ---- findability: fixpoint progression simulation ----
  if (spawns.length !== 1) return issues;
  const spawn = spawns[0];

  const visible = doc.objects.filter((o) => !o.hidden);
  const gates = visible.filter((o) => o.kind === 'door' || o.kind === 'valve');
  const plugObjs = visible.filter((o) => o.kind === 'plug');
  const relayObjs2 = visible.filter((o) => o.kind === 'relay');
  const runeDoors = visible.filter((o) => o.kind === 'runeDoor');
  const openIds = new Set(initialOpen);
  const earnedRelays = new Set<string>();

  let mask = bfsMask(closed, spawn.x, spawn.y - 2);
  /** How a trigger becomes earnable: hands-on kinds need the player beside
   *  them; a plug is earnable once breakable/detonated (openIds); a relay
   *  once its own inputs chained through. */
  const trigEarnable = (t: EditorObject): boolean =>
    t.kind === 'plug'
      ? openIds.has(t.id)
      : t.kind === 'relay'
        ? earnedRelays.has(t.id)
        : triggerReachable(mask, t);

  const maxRounds = gates.length + runeDoors.length + plugObjs.length + relayObjs2.length + 1;
  for (let round = 0; round < maxRounds; round++) {
    let opened = false;
    // relays chain: inputs earnable per logic -> the relay counts as fired
    for (const r of relayObjs2) {
      if (earnedRelays.has(r.id)) continue;
      const ins = liveLinks
        .filter((l) => l.kind === 'triggerDoor' && l.toId === r.id)
        .map((l) => byId.get(l.fromId)!)
        .filter((t) => !t.hidden);
      const ok =
        ins.length > 0 &&
        (r.params.logic === 'or' ? ins.some(trigEarnable) : ins.every(trigEarnable));
      if (ok) {
        earnedRelays.add(r.id);
        opened = true;
      }
    }
    // plugs are breakable real cells: earnable when the player can reach the
    // seal face, or when an earned relay detonates them
    for (const p of plugObjs) {
      if (openIds.has(p.id)) continue;
      const w = paramNum(p, 'w', 3),
        h = paramNum(p, 'h', 3);
      const faceable = near(mask, p.x + w / 2, p.y + h / 2, Math.ceil(Math.max(w, h) / 2) + 4);
      const detonated = liveLinks.some(
        (l) => l.kind === 'triggerDoor' && l.toId === p.id && earnedRelays.has(l.fromId),
      );
      if (faceable || detonated) {
        openIds.add(p.id);
        opened = true;
      }
    }
    for (const d of gates) {
      if (openIds.has(d.id)) continue;
      const triggers = liveLinks
        .filter((l) => l.kind === 'triggerDoor' && l.toId === d.id)
        .map((l) => byId.get(l.fromId)!)
        .filter((t) => !t.hidden);
      // OR gates open from ANY earnable trigger; AND and SEQUENCE need the
      // full set (a sequence completes only if every step can be fired).
      const earnable =
        triggers.length > 0 &&
        (d.params.logic === 'or' ? triggers.some(trigEarnable) : triggers.every(trigEarnable));
      if (earnable) {
        openIds.add(d.id);
        opened = true;
      }
    }
    for (const rd of runeDoors) {
      if (openIds.has(rd.id)) continue;
      const glyphs = liveLinks
        .filter((l) => l.kind === 'runeDoor' && l.toId === rd.id)
        .map((l) => byId.get(l.fromId)!)
        .filter((g) => !g.hidden);
      if (glyphs.length > 0 && glyphs.some((g) => glyphReachable(mask, g))) {
        openIds.add(rd.id);
        opened = true;
      }
    }
    if (!opened) break;
    const grid = baseTypes.slice();
    stampObjects(grid, doc, openIds);
    mask = bfsMask(grid, spawn.x, spawn.y - 2);
  }

  // The final mask is everything a player can EARN. A door that never made
  // it into openIds stays closed forever in this document — its rewards are
  // genuinely sealed, and the checks below say so.
  for (const o of visible) {
    if (POSITIONAL_TRIGGER_KINDS.has(o.kind)) {
      if (!triggerReachable(mask, o))
        push('error', o.kind + ' unreachable from spawn (even after opening every earnable door)', o.id);
    } else if (o.kind === 'sensor') {
      // a sensor zone can legitimately be fed by world flows the player
      // never touches (lava reaching a heat sensor) — warn, don't error
      if (!triggerReachable(mask, o))
        push(
          'warning',
          'sensor unreachable from spawn — only world flows (floods, lava, charge) can feed its zone',
          o.id,
        );
    } else if (o.kind === 'plug') {
      if (!openIds.has(o.id))
        push('warning', 'plug can never be reached or detonated — the seal will never break', o.id);
    } else if (o.kind === 'relay') {
      if (
        !earnedRelays.has(o.id) &&
        liveLinks.some((l) => l.kind === 'triggerDoor' && l.toId === o.id)
      )
        push('warning', 'relay never fires in this document (its inputs are unreachable)', o.id);
    } else if (o.kind === 'runeGlyph') {
      if (!glyphReachable(mask, o)) push('error', 'rune glyph unreachable from spawn', o.id);
    } else if (o.kind === 'exitWell') {
      if (!near(mask, o.x, o.y - 8, 6))
        push('error', 'exit well mouth unreachable from spawn', o.id);
    } else if (o.kind === 'door' || o.kind === 'valve') {
      const w = paramNum(o, 'w', o.kind === 'door' ? 3 : 5),
        h = paramNum(o, 'h', o.kind === 'door' ? 13 : 2);
      if (!near(mask, o.x - 2, o.y + h / 2, 4) && !near(mask, o.x + w + 1, o.y + h / 2, 4))
        push('warning', `no side of this ${o.kind} is reachable from spawn`, o.id);
    } else if (o.kind === 'pickup') {
      if (!near(mask, o.x, o.y - 2, 6)) {
        if (o.params.kind === 'key')
          push('error', 'golden key unreachable (no earnable path opens the way)', o.id);
        else
          push('info', String(o.params.kind ?? 'pickup') + ' is buried treasure (unreachable on foot)', o.id);
      }
    } else if (o.kind === 'exitPortal') {
      if (!near(mask, o.x, o.y - 2, 6))
        push('error', 'exit portal unreachable (no earnable path opens the way)', o.id);
    } else if (o.kind === 'waystone') {
      if (!near(mask, o.x, o.y - 3, 6)) push('warning', 'waystone unreachable', o.id);
    } else if (o.kind === 'cauldron') {
      if (!near(mask, o.x, o.y - 3, 6)) push('warning', 'cauldron unreachable', o.id);
    } else if (o.kind === 'bossMarker') {
      if (!near(mask, o.x, o.y - 4, 6)) push('warning', 'boss arena unreachable', o.id);
    } else if (o.kind === 'enemy') {
      if (!near(mask, o.x, o.y - 2, 6)) push('info', 'enemy sealed away from the player', o.id);
    }
  }

  // ---- clearance: cell-reachable is not wizard-walkable (he is 9x17). ----
  // Re-walk the earned world with an eroded mask; anything reachable by
  // cells but not by the eroded box gets a "too tight" WARNING.
  const finalGrid = baseTypes.slice();
  stampObjects(finalGrid, doc, openIds);
  const eroded = erodePassable(finalGrid);
  let seedX = -1,
    seedY = -1;
  for (let dy = 0; dy >= -6 && seedX < 0; dy--) {
    for (let dx = -2; dx <= 2 && seedX < 0; dx++) {
      const X = Math.floor(spawn.x) + dx,
        Y = Math.floor(spawn.y) + dy;
      if (X > 0 && Y > 0 && X < WIDTH && Y < HEIGHT && eroded[X + Y * WIDTH]) {
        seedX = X;
        seedY = Y;
      }
    }
  }
  if (seedX < 0) {
    push('info', 'spawn chamber too tight to evaluate player clearance', spawn.id);
    return issues;
  }
  const tight = bfsOverMask(eroded, seedX, seedY);
  const tightWarn = (o: { id: string }, x: number, y: number, r: number, label: string): void => {
    if (near(mask, x, y, r) && !near(tight, x, y, r + 3))
      push('warning', label + ' is cell-reachable, but the path looks too tight for the alchemist (9x17)', o.id);
  };
  for (const o of visible) {
    if (POSITIONAL_TRIGGER_KINDS.has(o.kind)) tightWarn(o, o.x, o.y - 2, 4, o.kind);
    else if (o.kind === 'runeGlyph') tightWarn(o, o.x, o.y - 3, 5, 'rune glyph');
    else if (o.kind === 'pickup' && o.params.kind === 'key') tightWarn(o, o.x, o.y - 2, 6, 'golden key');
    else if (o.kind === 'exitPortal') tightWarn(o, o.x, o.y - 2, 6, 'exit portal');
    else if (o.kind === 'exitWell') tightWarn(o, o.x, o.y - 8, 6, 'exit well mouth');
    else if (o.kind === 'waystone') tightWarn(o, o.x, o.y - 3, 6, 'waystone');
    else if (o.kind === 'cauldron') tightWarn(o, o.x, o.y - 3, 6, 'cauldron');
  }

  return issues;
}
