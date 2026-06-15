export type DockRegion = 'left' | 'right' | 'bottom' | 'floating';

export interface PanelLayout {
  id: string;
  dock: DockRegion;
  open: boolean;
  size: number;
  width?: number;
  height?: number;
  z?: number;
  tabGroupId?: string;
  floating?: {
    x: number;
    y: number;
  };
}

export interface WorkspaceLayout {
  panels: PanelLayout[];
  overlayVisibility: Record<string, boolean>;
  collapsedSections: Record<string, boolean>;
  layerState: Record<string, { hidden: boolean; locked: boolean }>;
  snapStep: number;
  lastTool: string;
  activePanelId?: string | null;
}

export interface WorkspacePanelRule {
  id: string;
  defaultDock?: DockRegion;
  minSize?: number;
  maxSize?: number;
  allowedDocks?: readonly DockRegion[];
}

export interface WorkspaceSanitizeOptions {
  defaultPanels?: readonly PanelLayout[];
  panelRules?: readonly WorkspacePanelRule[];
}

export type WorkspacePreset = 'compact' | 'wide' | 'validation' | 'lighting' | 'prefab';

export const BUILDER_WORKSPACE_KEY = 'noita-builder-workspace-v1';

export const DEFAULT_BUILDER_LAYOUT: WorkspaceLayout = {
  panels: [
    { id: 'builder-palette', dock: 'left', open: true, size: 214 },
    { id: 'builder-inspector', dock: 'right', open: true, size: 252 },
    { id: 'builder-world', dock: 'right', open: false, size: 252 },
    { id: 'builder-virtual-world', dock: 'bottom', open: false, size: 420 },
    { id: 'builder-global', dock: 'right', open: false, size: 252 },
    { id: 'builder-postfx', dock: 'right', open: false, size: 252 },
    { id: 'builder-assets', dock: 'bottom', open: false, size: 360 },
    { id: 'builder-asset-details', dock: 'right', open: false, size: 300 },
    { id: 'builder-prefab-details', dock: 'right', open: false, size: 300 },
    { id: 'builder-matparams', dock: 'right', open: false, size: 252 },
    { id: 'builder-proc', dock: 'right', open: false, size: 252 },
    { id: 'builder-issues', dock: 'right', open: false, size: 252 },
    { id: 'builder-outliner', dock: 'right', open: false, size: 292 },
    { id: 'builder-link-graph', dock: 'bottom', open: false, size: 300 },
    { id: 'dev-console', dock: 'bottom', open: false, size: 260 },
  ],
  overlayVisibility: {},
  collapsedSections: {},
  layerState: {},
  snapStep: 0,
  lastTool: 'select',
  activePanelId: 'builder-palette',
};

export function cloneDefaultBuilderLayout(): WorkspaceLayout {
  return structuredClone(DEFAULT_BUILDER_LAYOUT);
}

export function sanitizeWorkspaceLayout(
  value: unknown,
  optionsOrPanels: WorkspaceSanitizeOptions | readonly PanelLayout[] = DEFAULT_BUILDER_LAYOUT.panels,
): WorkspaceLayout {
  const options: WorkspaceSanitizeOptions = isPanelLayoutArray(optionsOrPanels)
    ? { defaultPanels: optionsOrPanels }
    : optionsOrPanels;
  const defaultPanels = options.defaultPanels ?? DEFAULT_BUILDER_LAYOUT.panels;
  const panelRules = options.panelRules ?? [];
  if (!value || typeof value !== 'object') return cloneWorkspaceLayoutFromPanels(defaultPanels);
  const raw = value as Partial<WorkspaceLayout>;
  const known = new Map(defaultPanels.map((panel) => [panel.id, panel]));
  const rules = new Map(panelRules.map((rule) => [rule.id, rule]));
  const incoming = new Map(
    Array.isArray(raw.panels)
      ? raw.panels
          .filter((panel): panel is PanelLayout => isPanelLayout(panel))
          .map((panel) => [panel.id, panel])
      : [],
  );
  const orderedIds: string[] = [];
  if (Array.isArray(raw.panels)) {
    for (const panel of raw.panels) {
      if (!isPanelLayout(panel) || !known.has(panel.id) || orderedIds.includes(panel.id)) continue;
      orderedIds.push(panel.id);
    }
  }
  for (const fallback of known.values()) {
    if (!orderedIds.includes(fallback.id)) orderedIds.push(fallback.id);
  }
  const panels = orderedIds.map((id) => {
    const fallback = known.get(id)!;
    const panel = incoming.get(fallback.id);
    if (!panel) return { ...fallback };
    const rule = rules.get(fallback.id);
    const dock =
      rule?.allowedDocks && !rule.allowedDocks.includes(panel.dock)
        ? (rule.defaultDock ?? fallback.dock)
        : panel.dock;
    const minSize = rule?.minSize ?? 120;
    const maxSize = rule?.maxSize ?? 520;
    const next: PanelLayout = {
      id: fallback.id,
      dock,
      open: panel.open,
      size: Math.max(minSize, Math.min(maxSize, panel.size)),
    };
    if (isFiniteNumber(panel.width)) next.width = Math.max(120, Math.min(1200, panel.width));
    if (isFiniteNumber(panel.height)) next.height = Math.max(120, Math.min(900, panel.height));
    if (isFiniteNumber(panel.z)) next.z = Math.max(0, Math.min(1_000_000, Math.floor(panel.z)));
    const tabGroupId = dock === 'bottom' ? normalizeBottomTabGroupId(panel.tabGroupId) : null;
    if (tabGroupId) next.tabGroupId = tabGroupId;
    if (dock === 'floating' && panel.floating) {
      next.floating = {
        x: Math.max(0, Math.min(4096, panel.floating.x)),
        y: Math.max(0, Math.min(4096, panel.floating.y)),
      };
    }
    return next;
  });
  const activePanelId =
    typeof raw.activePanelId === 'string' && known.has(raw.activePanelId)
      ? raw.activePanelId
      : panels.find((panel) => panel.open)?.id ?? null;
  return {
    panels,
    overlayVisibility:
      raw.overlayVisibility && typeof raw.overlayVisibility === 'object'
        ? { ...(raw.overlayVisibility as Record<string, boolean>) }
        : {},
    collapsedSections:
      raw.collapsedSections && typeof raw.collapsedSections === 'object'
        ? { ...(raw.collapsedSections as Record<string, boolean>) }
        : {},
    layerState: sanitizeLayerState(raw.layerState),
    snapStep: raw.snapStep === 4 || raw.snapStep === 8 || raw.snapStep === 16 ? raw.snapStep : 0,
    lastTool: typeof raw.lastTool === 'string' && raw.lastTool ? raw.lastTool : 'select',
    activePanelId,
  };
}

function cloneWorkspaceLayoutFromPanels(defaultPanels: readonly PanelLayout[]): WorkspaceLayout {
  return {
    ...cloneDefaultBuilderLayout(),
    panels: defaultPanels.map((panel) => ({ ...panel })),
    activePanelId: defaultPanels.find((panel) => panel.open)?.id ?? null,
  };
}

export function movePanel(
  layout: WorkspaceLayout,
  panelId: string,
  dock: DockRegion,
  options: { beforeId?: string | null; floating?: { x: number; y: number }; tabGroupId?: string | null } = {},
): WorkspaceLayout {
  const next = structuredClone(layout);
  const index = next.panels.findIndex((p) => p.id === panelId);
  if (index < 0) return next;
  const [panel] = next.panels.splice(index, 1);
  panel.dock = dock;
  panel.open = true;
  panel.z = nextZ(next.panels);
  if (dock === 'floating') {
    panel.floating = options.floating ?? panel.floating ?? { x: 24, y: 64 };
  } else {
    delete panel.floating;
  }
  if (dock === 'bottom') {
    const tabGroupId = normalizeBottomTabGroupId(options.tabGroupId);
    if (tabGroupId) panel.tabGroupId = tabGroupId;
    else delete panel.tabGroupId;
  } else {
    delete panel.tabGroupId;
  }
  const beforeIndex =
    options.beforeId === undefined || options.beforeId === null
      ? -1
      : next.panels.findIndex((p) => p.id === options.beforeId);
  if (beforeIndex >= 0) next.panels.splice(beforeIndex, 0, panel);
  else next.panels.push(panel);
  next.activePanelId = panel.id;
  return next;
}

export function setPanelOpen(layout: WorkspaceLayout, panelId: string, open: boolean): WorkspaceLayout {
  return open ? openPanel(layout, panelId) : closePanel(layout, panelId);
}

export function openPanel(layout: WorkspaceLayout, panelId: string): WorkspaceLayout {
  const next = structuredClone(layout);
  const panel = next.panels.find((p) => p.id === panelId);
  if (panel) {
    panel.open = true;
    panel.z = nextZ(next.panels);
    next.activePanelId = panel.id;
  }
  return next;
}

export function closePanel(layout: WorkspaceLayout, panelId: string): WorkspaceLayout {
  const next = structuredClone(layout);
  const panel = next.panels.find((p) => p.id === panelId);
  if (panel) panel.open = false;
  if (next.activePanelId === panelId) next.activePanelId = next.panels.find((p) => p.open)?.id ?? null;
  return next;
}

export function resizePanel(layout: WorkspaceLayout, panelId: string, size: number): WorkspaceLayout {
  const next = structuredClone(layout);
  const panel = next.panels.find((p) => p.id === panelId);
  if (panel && Number.isFinite(size)) panel.size = Math.max(120, Math.min(720, size));
  return next;
}

export function raisePanel(layout: WorkspaceLayout, panelId: string): WorkspaceLayout {
  const next = structuredClone(layout);
  const index = next.panels.findIndex((panel) => panel.id === panelId);
  if (index < 0) return next;
  const [panel] = next.panels.splice(index, 1);
  panel.z = nextZ(next.panels);
  next.panels.push(panel);
  next.activePanelId = panel.id;
  return next;
}

export function panelsInDock(layout: WorkspaceLayout, dock: DockRegion): PanelLayout[] {
  return layout.panels.filter((panel) => panel.dock === dock && panel.open);
}

export function workspacePresetLayout(preset: WorkspacePreset): WorkspaceLayout {
  const layout = cloneDefaultBuilderLayout();
  if (preset === 'compact') {
    layout.panels = layout.panels.map((panel) => ({
      ...panel,
      open: panel.id === 'builder-palette' || panel.id === 'builder-inspector',
      size: panel.dock === 'left' ? 188 : panel.dock === 'right' ? 220 : panel.size,
    }));
  } else if (preset === 'wide') {
    layout.panels = layout.panels.map((panel) => ({
      ...panel,
      open: panel.id === 'builder-palette' || panel.id === 'builder-inspector',
      size: panel.dock === 'left' ? 240 : panel.dock === 'right' ? 292 : panel.size,
    }));
  } else if (preset === 'validation') {
    layout.panels = layout.panels.map((panel) => ({
      ...panel,
      dock: panel.id === 'builder-issues' || panel.id === 'builder-link-graph' ? 'bottom' : panel.dock,
      open:
        panel.id === 'builder-palette' ||
        panel.id === 'builder-inspector' ||
        panel.id === 'builder-issues' ||
        panel.id === 'builder-outliner' ||
        panel.id === 'builder-link-graph',
      size: panel.id === 'builder-issues' ? 520 : panel.id === 'builder-link-graph' ? 360 : panel.size,
    }));
    layout.overlayVisibility.validation = true;
    layout.overlayVisibility.clearance = true;
  } else if (preset === 'lighting') {
    layout.panels = layout.panels.map((panel) => ({
      ...panel,
      open:
        panel.id === 'builder-palette' ||
        panel.id === 'builder-inspector' ||
        panel.id === 'builder-world' ||
        panel.id === 'builder-virtual-world' ||
        panel.id === 'builder-global',
      size: panel.id === 'builder-virtual-world' ? 420 : panel.id === 'builder-world' || panel.id === 'builder-global' ? 292 : panel.size,
    }));
    layout.overlayVisibility.light = true;
  } else if (preset === 'prefab') {
    layout.panels = layout.panels.map((panel) => ({
      ...panel,
      open:
        panel.id === 'builder-palette' ||
        panel.id === 'builder-inspector' ||
        panel.id === 'builder-proc' ||
        panel.id === 'builder-assets' ||
        panel.id === 'builder-asset-details' ||
        panel.id === 'builder-prefab-details',
      size: panel.id === 'builder-palette' ? 260 : panel.size,
    }));
  }
  return sanitizeWorkspaceLayout(layout);
}

function resolveWorkspaceStorage(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadWorkspaceLayout(storage?: Storage): WorkspaceLayout {
  try {
    const resolved = resolveWorkspaceStorage(storage);
    if (!resolved) return cloneDefaultBuilderLayout();
    const raw = resolved.getItem(BUILDER_WORKSPACE_KEY);
    return sanitizeWorkspaceLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return cloneDefaultBuilderLayout();
  }
}

export function saveWorkspaceLayout(layout: WorkspaceLayout, storage?: Storage): boolean {
  try {
    const resolved = resolveWorkspaceStorage(storage);
    if (!resolved) return false;
    resolved.setItem(BUILDER_WORKSPACE_KEY, JSON.stringify(sanitizeWorkspaceLayout(layout)));
    return true;
  } catch {
    return false;
  }
}

function isPanelLayout(value: unknown): value is PanelLayout {
  if (!value || typeof value !== 'object') return false;
  const panel = value as Partial<PanelLayout>;
  return (
    typeof panel.id === 'string' &&
    (panel.dock === 'left' || panel.dock === 'right' || panel.dock === 'bottom' || panel.dock === 'floating') &&
    typeof panel.open === 'boolean' &&
    typeof panel.size === 'number' &&
    Number.isFinite(panel.size) &&
    (panel.floating === undefined ||
      (typeof panel.floating === 'object' &&
        panel.floating !== null &&
        typeof panel.floating.x === 'number' &&
        typeof panel.floating.y === 'number' &&
        Number.isFinite(panel.floating.x) &&
        Number.isFinite(panel.floating.y)))
  );
}

function isPanelLayoutArray(value: WorkspaceSanitizeOptions | readonly PanelLayout[]): value is readonly PanelLayout[] {
  return Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function normalizeBottomTabGroupId(value: unknown): string | null {
  return value === 'bottom-left' || value === 'bottom-main' || value === 'bottom-right' ? value : null;
}

function sanitizeLayerState(value: unknown): Record<string, { hidden: boolean; locked: boolean }> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, { hidden: boolean; locked: boolean }> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!raw || typeof raw !== 'object') continue;
    const state = raw as { hidden?: unknown; locked?: unknown };
    out[key] = {
      hidden: state.hidden === true,
      locked: state.locked === true,
    };
  }
  return out;
}

function nextZ(panels: readonly PanelLayout[]): number {
  return panels.reduce((max, panel) => Math.max(max, panel.z ?? 0), 0) + 1;
}
