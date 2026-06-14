import type { DockRegion, PanelLayout, WorkspaceLayout } from '@/ui/editor/Workspace';
import {
  closePanel,
  movePanel,
  openPanel,
  panelsInDock,
  raisePanel,
  resizePanel,
} from '@/ui/editor/Workspace';
import type { PanelRegistry } from '@/ui/editor/PanelRegistry';

export interface DockHostSnapshot {
  layout: WorkspaceLayout;
  activePanel: PanelLayout | null;
}

export class DockHost {
  private layout: WorkspaceLayout;

  constructor(
    private readonly registry: PanelRegistry,
    initialLayout: WorkspaceLayout,
  ) {
    this.layout = this.registry.sanitizeLayout(initialLayout);
  }

  snapshot(): DockHostSnapshot {
    const layout = this.registry.sanitizeLayout(this.layout);
    return {
      layout,
      activePanel: layout.panels.find((panel) => panel.id === layout.activePanelId) ?? null,
    };
  }

  replaceLayout(layout: WorkspaceLayout): WorkspaceLayout {
    this.layout = this.registry.sanitizeLayout(layout);
    return this.snapshot().layout;
  }

  focusPanel(id: string): WorkspaceLayout {
    if (!this.registry.has(id)) return this.snapshot().layout;
    this.layout = openPanel(this.layout, id);
    this.layout = raisePanel(this.layout, id);
    return this.snapshot().layout;
  }

  openPanel(id: string): WorkspaceLayout {
    if (!this.registry.has(id)) return this.snapshot().layout;
    this.layout = openPanel(this.layout, id);
    return this.snapshot().layout;
  }

  closePanel(id: string): WorkspaceLayout {
    const spec = this.registry.get(id);
    if (!spec || spec.closePolicy === 'required') return this.snapshot().layout;
    this.layout = closePanel(this.layout, id);
    return this.snapshot().layout;
  }

  movePanel(id: string, dock: DockRegion, options: { beforeId?: string | null; floating?: { x: number; y: number } } = {}): WorkspaceLayout {
    if (!this.registry.canDock(id, dock)) return this.snapshot().layout;
    this.layout = movePanel(this.layout, id, dock, options);
    return this.snapshot().layout;
  }

  raisePanel(id: string): WorkspaceLayout {
    if (!this.registry.has(id)) return this.snapshot().layout;
    this.layout = raisePanel(this.layout, id);
    return this.snapshot().layout;
  }

  resizePanel(id: string, size: number): WorkspaceLayout {
    const spec = this.registry.get(id);
    if (!spec) return this.snapshot().layout;
    this.layout = resizePanel(this.layout, id, Math.max(spec.minSize ?? 120, Math.min(spec.maxSize ?? 720, size)));
    return this.snapshot().layout;
  }

  panelsInDock(dock: DockRegion): PanelLayout[] {
    return panelsInDock(this.layout, dock);
  }
}
