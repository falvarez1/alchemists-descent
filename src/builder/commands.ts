import type { EditorDocument, EditorObject } from '@/builder/document';
import type { World } from '@/sim/World';

/**
 * Command-based undo/redo (docs/BUILDER.md): every edit is a do/undo pair
 * over the document — no whole-world snapshots. Object commands cover
 * Phases 2-3; paint commands carry sparse before/after cell patches.
 */

export interface Command {
  label: string;
  do(doc: EditorDocument): void;
  undo(doc: EditorDocument): void;
}

export class CommandStack {
  private done: Command[] = [];
  private undone: Command[] = [];

  constructor(private readonly doc: () => EditorDocument) {}

  run(cmd: Command): void {
    cmd.do(this.doc());
    this.done.push(cmd);
    this.undone.length = 0; // a new edit forks history
    if (this.done.length > 200) this.done.shift();
  }

  undo(): string | null {
    const cmd = this.done.pop();
    if (!cmd) return null;
    cmd.undo(this.doc());
    this.undone.push(cmd);
    return cmd.label;
  }

  redo(): string | null {
    const cmd = this.undone.pop();
    if (!cmd) return null;
    cmd.do(this.doc());
    this.done.push(cmd);
    return cmd.label;
  }

  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
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

export function deleteObjectCmd(obj: EditorObject): Command {
  let index = -1;
  return {
    label: 'delete ' + obj.kind,
    do: (doc) => {
      index = doc.objects.indexOf(obj);
      if (index >= 0) doc.objects.splice(index, 1);
    },
    undo: (doc) => {
      if (index >= 0) doc.objects.splice(index, 0, obj);
      else doc.objects.push(obj);
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
  return { label: 'paint', do: () => apply(after), undo: () => apply(before) };
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
