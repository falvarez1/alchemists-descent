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

const ALL_DOCKS = ['left', 'right', 'bottom', 'floating'] as const;
const SIDE_DOCKS = ['left', 'right', 'floating'] as const;

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
    allowedDocks: SIDE_DOCKS,
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
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.inspectorPanel',
      close: 'builder.inspectorPanel',
      focus: 'builder.inspectorPanel',
    },
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-world',
    title: 'World Generation',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 252,
    minSize: 220,
    maxSize: 360,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-virtual-world',
    title: 'World Map',
    category: 'Builder',
    defaultDock: 'bottom',
    defaultSize: 420,
    minSize: 300,
    maxSize: 760,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.virtualWorldPanel',
      close: 'builder.virtualWorldPanel',
      focus: 'builder.virtualWorldPanel',
    },
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-global',
    title: 'Global Controls',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 252,
    minSize: 220,
    maxSize: 380,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.globalControlsPanel',
      close: 'builder.globalControlsPanel',
      focus: 'builder.globalControlsPanel',
    },
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-postfx',
    title: 'Post Processing',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 252,
    minSize: 220,
    maxSize: 380,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.postProcessingPanel',
      close: 'builder.postProcessingPanel',
      focus: 'builder.postProcessingPanel',
    },
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-assets',
    title: 'Asset Browser',
    category: 'Builder',
    defaultDock: 'bottom',
    defaultSize: 360,
    minSize: 260,
    maxSize: 720,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.assetsPanel',
      close: 'builder.assetsPanel',
      focus: 'builder.assetsPanel',
    },
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-asset-details',
    title: 'Asset Details',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 300,
    minSize: 240,
    maxSize: 460,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.assetDetailsPanel',
      close: 'builder.assetDetailsPanel',
      focus: 'builder.assetDetailsPanel',
    },
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-prefab-details',
    title: 'Prefab Details',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 300,
    minSize: 248,
    maxSize: 480,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.prefabDetailsPanel',
      close: 'builder.prefabDetailsPanel',
      focus: 'builder.prefabDetailsPanel',
    },
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
    allowedDocks: ALL_DOCKS,
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
    allowedDocks: ALL_DOCKS,
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
    allowedDocks: ALL_DOCKS,
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-outliner',
    title: 'Object Outliner',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 292,
    minSize: 240,
    maxSize: 440,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.outlinerPanel',
      close: 'builder.outlinerPanel',
      focus: 'builder.outlinerPanel',
    },
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-runtime',
    title: 'Runtime',
    category: 'Builder',
    defaultDock: 'right',
    defaultSize: 320,
    minSize: 260,
    maxSize: 520,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.runtimePanel',
      close: 'builder.runtimePanel',
      focus: 'builder.runtimePanel',
    },
    handleSelectors: [':scope > .bi-head'],
  },
  {
    id: 'builder-link-graph',
    title: 'Link Graph',
    category: 'Builder',
    defaultDock: 'bottom',
    defaultSize: 300,
    minSize: 220,
    maxSize: 620,
    closePolicy: 'hide',
    allowedDocks: ALL_DOCKS,
    commandIds: {
      open: 'builder.linkGraphPanel',
      close: 'builder.linkGraphPanel',
      focus: 'builder.linkGraphPanel',
    },
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
    allowedDocks: ALL_DOCKS,
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

const BUILDER_PANEL_TITLES = new Map(BUILDER_PANEL_SPECS.map((spec) => [spec.id, spec.title]));

/**
 * The single source of truth for a panel's visible title. Panel headers render
 * from this (via `builderPanelHeader`) so hand-rolled header text cannot drift
 * from the registry / command palette / focus commands.
 */
export function builderPanelTitle(id: string): string {
  return BUILDER_PANEL_TITLES.get(id) ?? id;
}

function normalizePanelSpec(spec: PanelSpec): PanelSpec {
  return {
    ...spec,
    closePolicy: spec.closePolicy ?? 'hide',
    allowedDocks: spec.allowedDocks ?? defaultAllowedDocks(spec.defaultDock),
    handleSelectors: spec.handleSelectors ?? [':scope > .bi-head', ':scope > .builder-panel-title'],
    defaultOpen: spec.defaultOpen === true,
  };
}

function defaultAllowedDocks(defaultDock: DockRegion): readonly DockRegion[] {
  return defaultDock === 'floating' ? ['floating'] : [defaultDock, 'floating'];
}
