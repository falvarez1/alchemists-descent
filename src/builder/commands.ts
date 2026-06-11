import type { EditorDocument, EditorObject } from '@/builder/document';

/**
 * Command-based undo/redo (docs/BUILDER.md): every edit is a do/undo pair
 * over the document — no whole-world snapshots. Terrain paint commands
 * arrive with Phase 4; object commands cover Phases 2-3.
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
