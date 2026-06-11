import { HEIGHT, WIDTH } from '@/config/constants';
import { blocksEntity, Cell } from '@/sim/CellType';
import { decodeTypes, paramNum } from '@/builder/document';
import type { EditorDocument, EditorObjectKind } from '@/builder/document';
import {
  stampBuoyBasin,
  stampCauldron,
  stampExitWell,
  stampRuneDoor,
  stampRunePedestal,
} from '@/builder/stamps';

/**
 * Document validation service (docs/BUILDER.md Phase 10): visible, fast,
 * specific. Structural checks first (ids, links, params), then the
 * findability doctrine applied to authored content: BFS from spawn over a
 * scratch grid with every compile-time stamp applied — once with all
 * authored doors CLOSED (can you reach the inputs?) and once with them OPEN
 * (can you reach the rewards after solving?). Mechanism-correct is NOT
 * player-findable; this is where authored levels prove both.
 */

export interface DocIssue {
  severity: 'error' | 'warning' | 'info';
  what: string;
  objId?: string;
}

/** Object kinds that compile to door-driving runtime triggers. */
export const TRIGGER_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'plate',
  'lever',
  'brazier',
  'scale',
  'buoy',
  'chargeLatch',
] as EditorObjectKind[]);

/* ---------------- scratch grid: document terrain + compile stamps ---------------- */

/**
 * Decode the document terrain and stamp every structural object the compiler
 * would stamp. `open` controls authored doors: closed = solid (pass 1, the
 * world as the player first finds it), open = cleared (pass 2, post-solve).
 */
export function buildScratchGrid(doc: EditorDocument, open: boolean): Uint8Array {
  const types = decodeTypes(doc.world!);
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
      for (let dy = 0; dy < h; dy++) {
        for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, open ? Cell.Empty : Cell.Metal);
      }
    } else if (o.kind === 'runeDoor') {
      const w = paramNum(o, 'w', 2),
        h = paramNum(o, 'h', 11);
      if (open) {
        for (let dy = 0; dy < h; dy++) {
          for (let dx = 0; dx < w; dx++) set(x + dx, y + dy, Cell.Empty);
        }
      } else {
        stampRuneDoor(set, x, y, w, h);
      }
    } else if (o.kind === 'plate' || o.kind === 'chargeLatch') {
      const w = o.kind === 'plate' ? paramNum(o, 'w', 5) : 5;
      const hw = Math.floor(w / 2);
      for (let dx = 0; dx < w; dx++) set(x - hw + dx, y, Cell.Metal);
    } else if (o.kind === 'scale') {
      const w = paramNum(o, 'w', 7);
      const hw = Math.floor(w / 2);
      for (let dx = 0; dx < w; dx++) set(x - hw + dx, y, Cell.Metal);
    } else if (o.kind === 'brazier') {
      for (let dx = -2; dx <= 2; dx++) set(x + dx, y, Cell.Stone);
      set(x - 2, y - 1, Cell.Stone);
      set(x + 2, y - 1, Cell.Stone);
    }
  }
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

  // ---- link integrity ----
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
      if (to.kind !== 'door')
        push('error', 'trigger linked to ' + to.kind + ' — triggers drive doors', to.id);
    } else if (l.kind === 'runeDoor') {
      if (from.kind !== 'runeGlyph')
        push('error', 'rune link source must be a rune glyph', from.id);
      if (to.kind !== 'runeDoor')
        push('error', 'rune glyph linked to ' + to.kind + ' — glyphs open rune doors', to.id);
    }
  }

  // ---- per-object wiring requirements ----
  for (const o of doc.objects) {
    if (TRIGGER_KINDS.has(o.kind)) {
      const outs = doc.links.filter((l) => l.fromId === o.id && l.kind === 'triggerDoor');
      if (outs.length === 0)
        push('error', o.kind + ' is not linked to any door (use the LINK tool)', o.id);
      if (outs.length > 1)
        push(
          'error',
          o.kind + ' drives several doors — one trigger drives one door (AND = many triggers on ONE door)',
          o.id,
        );
    } else if (o.kind === 'door') {
      if (!doc.links.some((l) => l.toId === o.id && l.kind === 'triggerDoor') && o.params.initialOpen !== true)
        push('warning', 'door has no trigger — it can never open', o.id);
    } else if (o.kind === 'runeGlyph') {
      if (!doc.links.some((l) => l.fromId === o.id && l.kind === 'runeDoor'))
        push('error', 'rune glyph opens nothing — link it to a rune door', o.id);
    } else if (o.kind === 'runeDoor') {
      if (!doc.links.some((l) => l.toId === o.id && l.kind === 'runeDoor'))
        push('error', 'rune door has no glyph — it can never dissolve', o.id);
    }
  }

  // ---- lights sanity ----
  for (const l of doc.lights) {
    if (l.radius < 4 || l.radius > 160)
      push('warning', 'light radius ' + l.radius + ' outside sane range 4-160', l.id);
    if (l.intensity <= 0 || l.intensity > 4)
      push('warning', 'light intensity ' + l.intensity + ' outside sane range 0-4', l.id);
  }

  // ---- win condition ----
  const portal = doc.objects.find((o) => o.kind === 'exitPortal');
  const well = doc.objects.find((o) => o.kind === 'exitWell');
  const key = doc.objects.find((o) => o.kind === 'pickup' && o.params.kind === 'key');
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

  const closed = buildScratchGrid(doc, false);
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

  // embedded enemies/pickups (against the world as compiled, doors closed)
  for (const o of doc.objects) {
    if ((o.kind === 'enemy' || o.kind === 'pickup') && blockedAt(closed, o.x, o.y - 2)) {
      push('warning', o.kind + ' embedded in blocking cells', o.id);
    }
  }

  // ---- findability: pass 1 (doors closed — the inputs must be walkable) ----
  if (spawns.length !== 1) return issues;
  const spawn = spawns[0];
  const maskClosed = bfsMask(closed, spawn.x, spawn.y - 2);
  for (const o of doc.objects) {
    if (o.hidden) continue;
    if (TRIGGER_KINDS.has(o.kind)) {
      if (!near(maskClosed, o.x, o.y - 2, 4))
        push('error', o.kind + ' unreachable from spawn (before its door opens)', o.id);
    } else if (o.kind === 'runeGlyph') {
      if (!near(maskClosed, o.x, o.y - 3, 5))
        push('error', 'rune glyph unreachable from spawn', o.id);
    } else if (o.kind === 'exitWell') {
      if (!near(maskClosed, o.x, o.y - 8, 6))
        push('error', 'exit well mouth unreachable from spawn', o.id);
    } else if (o.kind === 'door') {
      const w = paramNum(o, 'w', 3),
        h = paramNum(o, 'h', 13);
      if (
        !near(maskClosed, o.x - 2, o.y + h / 2, 4) &&
        !near(maskClosed, o.x + w + 1, o.y + h / 2, 4)
      )
        push('warning', 'no side of this door is reachable from spawn', o.id);
    }
  }

  // ---- findability: pass 2 (doors open — rewards must exist behind locks) ----
  const open = buildScratchGrid(doc, true);
  const maskOpen = bfsMask(open, spawn.x, spawn.y - 2);
  for (const o of doc.objects) {
    if (o.hidden) continue;
    if (o.kind === 'pickup') {
      const reachable = near(maskOpen, o.x, o.y - 2, 6);
      if (!reachable) {
        if (o.params.kind === 'key')
          push('error', 'golden key unreachable even with every door open', o.id);
        else
          push('info', String(o.params.kind ?? 'pickup') + ' is buried treasure (unreachable on foot)', o.id);
      }
    } else if (o.kind === 'exitPortal') {
      if (!near(maskOpen, o.x, o.y - 2, 6))
        push('error', 'exit portal unreachable even with every door open', o.id);
    } else if (o.kind === 'waystone') {
      if (!near(maskOpen, o.x, o.y - 3, 6)) push('warning', 'waystone unreachable', o.id);
    } else if (o.kind === 'cauldron') {
      if (!near(maskOpen, o.x, o.y - 3, 6)) push('warning', 'cauldron unreachable', o.id);
    } else if (o.kind === 'bossMarker') {
      if (!near(maskOpen, o.x, o.y - 4, 6)) push('warning', 'boss arena unreachable', o.id);
    } else if (o.kind === 'enemy') {
      if (!near(maskOpen, o.x, o.y - 2, 6)) push('info', 'enemy sealed away from the player', o.id);
    }
  }

  return issues;
}
