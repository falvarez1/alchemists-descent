import { sanitizeWorkspaceLayout } from '@/ui/editor/Workspace';
import type { DockRegion, PanelLayout, WorkspaceLayout, WorkspacePanelRule } from '@/ui/editor/Workspace';

export type PanelClosePolicy = 'hide' | 'required' | 'destroy';

export interface PanelCommandIds {
  open?: string;
  close?: string;
  focus?: string;
  maximize?: string;
  restore?: string;
}

export interface PanelSpec {
  id: string;
  title: string;
  category: string;
  defaultDock: DockRegion;
  defaultSize: number;
  minSize?: number;
  maxSize?: number;
  icon?: string;
  closePolicy?: PanelClosePolicy;
  allowedDocks?: readonly DockRegion[];
  commandIds?: PanelCommandIds;
  handleSelectors?: readonly string[];
  defaultOpen?: boolean;
}

export class PanelRegistry {
  private readonly panels = new Map<string, PanelSpec>();

  register(spec: PanelSpec): void {
    if (this.panels.has(spec.id)) {
      throw new Error(`duplicate panel id: ${spec.id}`);
    }
    this.panels.set(spec.id, normalizePanelSpec(spec));
  }

  get(id: string): PanelSpec | null {
    return this.panels.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.panels.has(id);
  }

  list(): PanelSpec[] {
    return [...this.panels.values()];
  }

  canDock(id: string, dock: DockRegion): boolean {
    const spec = this.get(id);
    if (!spec) return false;
    return spec.allowedDocks?.includes(dock) ?? true;
  }

  layoutRules(): WorkspacePanelRule[] {
    return this.list().map((spec) => ({
      id: spec.id,
      defaultDock: spec.defaultDock,
      minSize: spec.minSize,
      maxSize: spec.maxSize,
      allowedDocks: spec.allowedDocks,
    }));
  }

  defaultLayouts(): PanelLayout[] {
    return this.list().map((spec) => ({
      id: spec.id,
      dock: spec.defaultDock,
      open: spec.defaultOpen === true,
      size: spec.defaultSize,
    }));
  }

  sanitizeLayout(layout: unknown): WorkspaceLayout {
    return sanitizeWorkspaceLayout(layout, {
      defaultPanels: this.defaultLayouts(),
      panelRules: this.layoutRules(),
    });
  }
}

export const BUILDER_PANEL_SPECS = [
  {
    id: 'builder-palette',
    title: 'Palette',
    category: 'Builder',
    defaultDock: 'left',
    defaultOpen: true,
    defaultSize: 214,
    minSize: 188,
    maxSize: 320,
    closePolicy: 'required',
    handleSelectors: [':scope > .builder-panel-title'],
  },
  {
    id: 'builder-inspector',
    title: 'Inspector',
    category: 'Builder',
    defaultDock: 'right',
    defaultOpen: true,
    defaultSize: 252,
    minSize: 220,
    maxSize: 360,
    closePolicy: 'required',
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-world',
    title: 'World Parameters',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 252,
    minSize: 220,
    maxSize: 360,
    closePolicy: 'hide',
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-matparams',
    title: 'Material Parameters',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 252,
    minSize: 220,
    maxSize: 360,
    closePolicy: 'hide',
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-proc',
    title: 'Procedural Pass',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 252,
    minSize: 220,
    maxSize: 360,
    closePolicy: 'hide',
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-issues',
    title: 'Validation Issues',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 252,
    minSize: 220,
    maxSize: 520,
    closePolicy: 'hide',
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'dev-console',
    title: 'Developer Console',
    category: 'Console',
    defaultDock: 'bottom',
    defaultSize: 260,
    minSize: 180,
    maxSize: 620,
    closePolicy: 'hide',
    commandIds: {
      open: 'console.open',
      close: 'console.close',
      maximize: 'console.maximize',
      restore: 'console.restore',
    },
    handleSelectors: ['.dev-console-head'],
  },
] satisfies PanelSpec[];

export function createBuilderPanelRegistry(): PanelRegistry {
  const registry = new PanelRegistry();
  for (const spec of BUILDER_PANEL_SPECS) registry.register(spec);
  return registry;
}

function normalizePanelSpec(spec: PanelSpec): PanelSpec {
  return {
    ...spec,
    closePolicy: spec.closePolicy ?? 'hide',
    allowedDocks: spec.allowedDocks ?? ['left', 'right', 'bottom', 'floating'],
    handleSelectors: spec.handleSelectors ?? [':scope > .bi-head', ':scope > .builder-panel-title'],
    defaultOpen: spec.defaultOpen === true,
  };
}
