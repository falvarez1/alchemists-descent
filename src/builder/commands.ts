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
