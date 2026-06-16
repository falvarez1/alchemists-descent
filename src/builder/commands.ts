import type { EditorDocument, EditorLight, EditorLink, EditorObject } from '@/builder/document';
import type { World } from '@/sim/World';

/**
 * Command-based undo/redo (docs/BUILDER.md): every edit is a do/undo pair
 * over the document — no whole-world snapshots. Object/link/light commands
 * cover the authoring records; paint commands carry sparse cell patches.
 */

export interface Command {
  label: string;
  do(doc: EditorDocument): void;
  undo(doc: EditorDocument): void;
  /** Approximate retained cell count (terrain patches) for stack budgeting. */
  cells?: number;
}

/** Total cells of terrain patches the undo stack may retain (~memory cap). */
const STACK_CELL_BUDGET = 3_000_000;

export class CommandStack {
  private done: Command[] = [];
  private undone: Command[] = [];
  private retainedCells = 0;

  constructor(
    private readonly doc: () => EditorDocument,
    private readonly onChange?: (cmd?: Command) => void,
  ) {}

  run(cmd: Command): void {
    cmd.do(this.doc());
    this.onChange?.(cmd);
    this.done.push(cmd);
    this.retainedCells += cmd.cells ?? 0;
    this.undone.length = 0; // a new edit forks history
    // Budget by command count AND by retained patch cells: a few whole-world
    // replaces must not pin tens of MB of before/after arrays forever.
    while (
      this.done.length > 200 ||
      (this.retainedCells > STACK_CELL_BUDGET && this.done.length > 1)
    ) {
      const evicted = this.done.shift()!;
      this.retainedCells -= evicted.cells ?? 0;
    }
  }

  undo(): string | null {
    const cmd = this.done.pop();
    if (!cmd) return null;
    cmd.undo(this.doc());
    this.onChange?.(cmd);
    this.undone.push(cmd);
    return cmd.label;
  }

  redo(): string | null {
    const cmd = this.undone.pop();
    if (!cmd) return null;
    cmd.do(this.doc());
    this.onChange?.(cmd);
    this.done.push(cmd);
    return cmd.label;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.retainedCells = 0;
  }

  get depth(): number {
    return this.done.length;
  }
}

/* ---------------- object commands ---------------- */

export function addObjectCmd(obj: EditorObject): Command {
  return {
    label: 'add ' + obj.kind,
    do: (doc) => {
      doc.objects.push(obj);
    },
    undo: (doc) => {
      const i = doc.objects.indexOf(obj);
      if (i >= 0) doc.objects.splice(i, 1);
    },
  };
}

/** Deleting an object also severs every link touching it (restored on undo). */
export function deleteObjectCmd(obj: EditorObject): Command {
  let index = -1;
  let severed: Array<{ link: EditorLink; at: number }> = [];
  return {
    label: 'delete ' + obj.kind,
    do: (doc) => {
      index = doc.objects.indexOf(obj);
      if (index >= 0) doc.objects.splice(index, 1);
      severed = [];
      for (let n = doc.links.length - 1; n >= 0; n--) {
        const l = doc.links[n];
        if (l.fromId === obj.id || l.toId === obj.id) {
          severed.push({ link: l, at: n });
          doc.links.splice(n, 1);
        }
      }
    },
    undo: (doc) => {
      if (index >= 0) doc.objects.splice(index, 0, obj);
      else doc.objects.push(obj);
      // severed was collected back-to-front; re-insert front-to-back
      for (let n = severed.length - 1; n >= 0; n--) {
        doc.links.splice(severed[n].at, 0, severed[n].link);
      }
    },
  };
}

export function moveObjectCmd(obj: EditorObject, toX: number, toY: number): Command {
  const fromX = obj.x;
  const fromY = obj.y;
  return {
    label: 'move ' + obj.kind,
    do: () => {
      obj.x = toX;
      obj.y = toY;
    },
    undo: () => {
      obj.x = fromX;
      obj.y = fromY;
    },
  };
}

/* ---------------- terrain paint command ---------------- */

/** Sparse cell patch: parallel arrays over the same index list. */
export interface CellPatch {
  idxs: number[];
  types: number[];
  colors: number[];
  life: number[];
  charge: number[];
}

/**
 * One paint stroke over the LIVE world (the pre-Phase-4 terrain layer).
 * Both patches share the changed-cell index set; do/undo just replay them.
 *
 * IDEMPOTENT-DO CONVENTION (load-bearing): callers apply the cells live
 * FIRST (PatchRecorder diffs them), then run this command — its do() simply
 * replays `after`, so the initial run is a no-op re-stamp. Composite
 * commands (prefab paste, floating-selection moves) depend on this.
 */
export function paintTerrainCmd(world: World, before: CellPatch, after: CellPatch): Command {
  const apply = (p: CellPatch): void => {
    for (let n = 0; n < p.idxs.length; n++) {
      const i = p.idxs[n];
      world.types[i] = p.types[n];
      world.colors[i] = p.colors[n];
      world.life[i] = p.life[n];
      world.charge[i] = p.charge[n];
    }
  };
  return {
    label: 'paint',
    do: () => apply(after),
    undo: () => apply(before),
    cells: before.idxs.length * 2,
  };
}

/** Undoable group assignment (Ctrl+G / Ctrl+Shift+G). */
export function setObjectGroupCmd(obj: EditorObject, group: string | undefined): Command {
  const prev = obj.group;
  return {
    label: group ? 'group' : 'ungroup',
    do: () => {
      if (group === undefined) delete obj.group;
      else obj.group = group;
    },
    undo: () => {
      if (prev === undefined) delete obj.group;
      else obj.group = prev;
    },
  };
}

/** Undoable rotation step (point kinds spin in place; door slabs pair this
 *  with their w/h param swap inside one composite). */
export function setObjectRotationCmd(
  obj: EditorObject,
  rotation: EditorObject['rotation'],
): Command {
  const prev = obj.rotation;
  return {
    label: 'rotate ' + obj.kind,
    do: () => {
      obj.rotation = rotation;
    },
    undo: () => {
      obj.rotation = prev;
    },
  };
}

/** Undoable locked/hidden flips so object flags match the light commands. */
export function setObjectFlagCmd(
  obj: EditorObject,
  key: 'locked' | 'hidden',
  value: boolean,
): Command {
  const prev = obj[key];
  return {
    label: key + ' ' + obj.kind,
    do: () => {
      obj[key] = value;
    },
    undo: () => {
      obj[key] = prev;
    },
  };
}

/* ---------------- link commands ---------------- */

export function addLinkCmd(link: EditorLink): Command {
  return {
    label: 'link',
    do: (doc) => {
      doc.links.push(link);
    },
    undo: (doc) => {
      const i = doc.links.indexOf(link);
      if (i >= 0) doc.links.splice(i, 1);
    },
  };
}

export function deleteLinkCmd(link: EditorLink): Command {
  let index = -1;
  return {
    label: 'unlink',
    do: (doc) => {
      index = doc.links.indexOf(link);
      if (index >= 0) doc.links.splice(index, 1);
    },
    undo: (doc) => {
      if (index >= 0) doc.links.splice(index, 0, link);
      else doc.links.push(link);
    },
  };
}

/* ---------------- light commands ---------------- */

export function addLightCmd(light: EditorLight): Command {
  return {
    label: 'add light',
    do: (doc) => {
      doc.lights.push(light);
    },
    undo: (doc) => {
      const i = doc.lights.indexOf(light);
      if (i >= 0) doc.lights.splice(i, 1);
    },
  };
}

export function deleteLightCmd(light: EditorLight): Command {
  let index = -1;
  return {
    label: 'delete light',
    do: (doc) => {
      index = doc.lights.indexOf(light);
      if (index >= 0) doc.lights.splice(index, 1);
    },
    undo: (doc) => {
      if (index >= 0) doc.lights.splice(index, 0, light);
      else doc.lights.push(light);
    },
  };
}

export function moveLightCmd(light: EditorLight, toX: number, toY: number): Command {
  const fromX = light.x;
  const fromY = light.y;
  return {
    label: 'move light',
    do: () => {
      light.x = toX;
      light.y = toY;
    },
    undo: () => {
      light.x = fromX;
      light.y = fromY;
    },
  };
}

export function editLightCmd(light: EditorLight, patch: Partial<EditorLight>): Command {
  const prev: Partial<EditorLight> = {};
  for (const key of Object.keys(patch) as Array<keyof EditorLight>) {
    (prev as Record<string, unknown>)[key] = light[key];
  }
  return {
    label: 'edit light',
    do: () => {
      Object.assign(light, patch);
    },
    undo: () => {
      Object.assign(light, prev);
    },
  };
}

export function editDocumentMoodCmd(patch: Partial<NonNullable<EditorDocument['mood']>>): Command {
  let prev: EditorDocument['mood'] | undefined;
  let captured = false;
  return {
    label: 'edit document mood',
    do: (doc) => {
      if (!captured) {
        prev = doc.mood ? { ...doc.mood } : undefined;
        captured = true;
      }
      const current = doc.mood ?? { ambient: null, ambience: '' };
      doc.mood = { ...current, ...patch };
    },
    undo: (doc) => {
      if (prev === undefined) delete doc.mood;
      else doc.mood = { ...prev };
    },
  };
}

export function editDocumentCmd<K extends keyof EditorDocument>(
  label: string,
  patch: Pick<EditorDocument, K>,
): Command {
  const prev: Partial<Pick<EditorDocument, K>> = {};
  const keys = Object.keys(patch) as K[];
  return {
    label,
    do: (doc) => {
      for (const key of keys) {
        prev[key] = doc[key];
        doc[key] = patch[key];
      }
    },
    undo: (doc) => {
      for (const key of keys) doc[key] = prev[key] as EditorDocument[K];
    },
  };
}

/* ---------------- composite (procedural population passes) ---------------- */

export function compositeCmd(label: string, cmds: Command[]): Command {
  return {
    label,
    do: (doc) => {
      for (const c of cmds) c.do(doc);
    },
    undo: (doc) => {
      for (let n = cmds.length - 1; n >= 0; n--) cmds[n].undo(doc);
    },
    cells: cmds.reduce((s, c) => s + (c.cells ?? 0), 0),
  };
}

export function editParamCmd(obj: EditorObject, key: string, value: unknown): Command {
  const prev = obj.params[key];
  return {
    label: 'edit ' + obj.kind + '.' + key,
    do: () => {
      obj.params[key] = value;
    },
    undo: () => {
      if (prev === undefined) delete obj.params[key];
      else obj.params[key] = prev;
    },
  };
}
