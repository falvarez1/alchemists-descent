import { describe, expect, it } from 'vitest';
import { CommandRegistry } from '@/ui/editor/CommandRegistry';
import { DockHost } from '@/ui/editor/DockHost';
import { FocusRouter } from '@/ui/editor/FocusRouter';
import { commandMenuItems } from '@/ui/editor/MenuHost';
import { overlayLabel, sanitizeOverlayVisibility } from '@/builder/render/OverlayRegistry';
import { checkboxField, numberField, selectField, vec2Field } from '@/ui/editor/Fields';
import { MIXED_VALUE, renderInspectorItems, sharedValue } from '@/ui/editor/InspectorSchema';
import { Keymap, normalizeShortcut, shortcutFromEvent } from '@/ui/editor/Keymap';
import { normalizePanelChromeHandles, panelChromeHtml } from '@/ui/editor/PanelChrome';
import { BUILDER_PANEL_SPECS, createBuilderPanelRegistry, PanelRegistry } from '@/ui/editor/PanelRegistry';
import { placePopover } from '@/ui/editor/PopoverHost';
import {
  documentInspectorSchema,
  LIGHT_PRESETS,
  lightInspectorSchema,
  multiSelectionInspectorSchema,
  objectInspectorSchema,
} from '@/builder/inspectorSchemas';
import { createEmptyDocument } from '@/builder/document';
import type { EditorLight, EditorObject } from '@/builder/document';
import {
  BUILDER_WORKSPACE_KEY,
  cloneDefaultBuilderLayout,
  closePanel,
  loadWorkspaceLayout,
  movePanel,
  panelsInDock,
  raisePanel,
  resizePanel,
  sanitizeWorkspaceLayout,
  saveWorkspaceLayout,
  setPanelOpen,
  workspacePresetLayout,
} from '@/ui/editor/Workspace';

function storageStub(initial: Record<string, string> = {}): Storage {
  const items = new Map(Object.entries(initial));
  return {
    get length() {
      return items.size;
    },
    clear() {
      items.clear();
    },
    getItem(key: string) {
      return items.get(key) ?? null;
    },
    key(index: number) {
      return [...items.keys()][index] ?? null;
    },
    removeItem(key: string) {
      items.delete(key);
    },
    setItem(key: string, value: string) {
      items.set(key, value);
    },
  };
}

function keyboard(code: string, init: Partial<KeyboardEventInit> = {}): KeyboardEvent {
  const event = {
    code,
    key: init.key ?? code,
    ctrlKey: init.ctrlKey ?? false,
    altKey: init.altKey ?? false,
    shiftKey: init.shiftKey ?? false,
    metaKey: init.metaKey ?? false,
    defaultPrevented: false,
    target: null,
    preventDefault() {
      this.defaultPrevented = true;
    },
    stopPropagation() {
      /* test shim */
    },
  };
  return event as unknown as KeyboardEvent;
}

describe('editor command registry', () => {
  it('runs enabled commands and returns disabled reasons', () => {
    const registry = new CommandRegistry();
    let ran = 0;
    registry.register({
      id: 'builder.enabled',
      label: 'Enabled',
      category: 'test',
      run: () => {
        ran++;
      },
    });
    registry.register({
      id: 'builder.disabled',
      label: 'Disabled',
      category: 'test',
      enabled: () => false,
      disabledReason: () => 'No selection',
      run: () => {
        ran++;
      },
    });

    expect(registry.run('builder.enabled')).toEqual({ ok: true });
    expect(registry.run('builder.disabled')).toEqual({ ok: false, reason: 'No selection' });
    expect(ran).toBe(1);
  });

  it('hides invisible commands from normal lists', () => {
    let ran = false;
    const registry = new CommandRegistry();
    registry.register({ id: 'a', label: 'A', category: 'test', run: () => undefined });
    registry.register({
      id: 'b',
      label: 'B',
      category: 'test',
      visible: () => false,
      run: () => {
        ran = true;
      },
    });

    expect(registry.list().map((cmd) => cmd.id)).toEqual(['a']);
    expect(registry.list(true).map((cmd) => cmd.id).sort()).toEqual(['a', 'b']);
    expect(registry.run('b')).toEqual({ ok: true });
    expect(ran).toBe(true);
  });

  it('reports async command starts and failures without throwing through callers', async () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'async', label: 'Async', category: 'test', run: async () => undefined });
    registry.register({
      id: 'throws',
      label: 'Throws',
      category: 'test',
      run: () => {
        throw new Error('boom');
      },
    });

    expect(registry.run('async')).toEqual({ ok: true, pending: true });
    expect(await registry.runAsync('async')).toEqual({ ok: true });
    expect(registry.run('throws')).toEqual({ ok: false, reason: 'boom' });
    expect(await registry.runAsync('throws')).toEqual({ ok: false, reason: 'boom' });
  });
});

describe('editor keymap', () => {
  it('normalizes shortcuts and detects conflicts', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'one', label: 'One', category: 'test', shortcut: 'control+k', run: () => undefined });
    registry.register({ id: 'two', label: 'Two', category: 'test', shortcut: 'Ctrl+K', run: () => undefined });
    const keymap = new Keymap(registry);

    expect(normalizeShortcut('control+k')).toBe('Ctrl+K');
    expect(keymap.conflicts()).toEqual([{ shortcut: 'Ctrl+K', commandIds: ['one', 'two'] }]);
  });

  it('runs a shortcut and blocks browser/default propagation', () => {
    const registry = new CommandRegistry();
    let ran = false;
    registry.register({
      id: 'builder.commandPalette',
      label: 'Command Palette',
      category: 'builder',
      shortcut: 'Ctrl+K',
      run: () => {
        ran = true;
      },
    });
    const event = keyboard('KeyK', { key: 'k', ctrlKey: true });
    const result = new Keymap(registry).handleKeyDown(event);

    expect(shortcutFromEvent(event)).toBe('Ctrl+K');
    expect(result).toEqual({ handled: true, ok: true, commandId: 'builder.commandPalette', reason: undefined });
    expect(ran).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it('returns disabled reasons and includes hidden shortcut commands', () => {
    const registry = new CommandRegistry();
    const ran: string[] = [];
    registry.register({
      id: 'builder.copyParams',
      label: 'Copy Parameters',
      category: 'builder',
      shortcut: 'Ctrl+C',
      enabled: () => false,
      disabledReason: () => 'Select an object first',
      run: () => ran.push('copy'),
    });
    registry.register({
      id: 'builder.redoAlt',
      label: 'Redo',
      category: 'builder',
      shortcut: 'Ctrl+Shift+Z',
      visible: () => false,
      run: () => ran.push('redoAlt'),
    });
    const keymap = new Keymap(registry);

    expect(keymap.handleKeyDown(keyboard('KeyC', { key: 'c', ctrlKey: true }))).toEqual({
      handled: true,
      ok: false,
      commandId: 'builder.copyParams',
      reason: 'Select an object first',
    });
    expect(keymap.handleKeyDown(keyboard('KeyZ', { key: 'z', ctrlKey: true, shiftKey: true }))).toEqual({
      handled: true,
      ok: true,
      commandId: 'builder.redoAlt',
      reason: undefined,
    });
    expect(ran).toEqual(['redoAlt']);
  });

  it('does not capture text input typing', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'tool.paint', label: 'Paint', category: 'tool', shortcut: 'B', run: () => undefined });
    const input = { tagName: 'INPUT', isContentEditable: false };
    const event = keyboard('KeyB', { key: 'b' });
    Object.defineProperty(event, 'target', { value: input });

    expect(new Keymap(registry).handleKeyDown(event)).toEqual({ handled: false });
  });

  it('respects command scopes and priority when shortcuts overlap', () => {
    const registry = new CommandRegistry();
    const ran: string[] = [];
    registry.register({
      id: 'global',
      label: 'Global',
      category: 'test',
      shortcut: 'H',
      scopes: ['global'],
      run: () => ran.push('global'),
    });
    registry.register({
      id: 'builder',
      label: 'Builder',
      category: 'test',
      shortcut: 'H',
      scopes: ['builder.author'],
      priority: 10,
      run: () => ran.push('builder'),
    });
    const keymap = new Keymap(registry);

    expect(keymap.handleKeyDown(keyboard('KeyH', { key: 'h' }), { scope: 'builder.author' })).toMatchObject({
      handled: true,
      commandId: 'builder',
    });
    expect(keymap.handleKeyDown(keyboard('KeyH', { key: 'h' }), { scope: 'play' })).toMatchObject({
      handled: true,
      commandId: 'global',
    });
    expect(ran).toEqual(['builder', 'global']);
  });
});

describe('editor focus router', () => {
  it('applies the priority order for modal, help, palette, menus, console, text, Builder, and game surfaces', () => {
    const router = new FocusRouter();
    const event = keyboard('KeyH', { key: 'h' });
    const input = { tagName: 'INPUT', isContentEditable: false, getAttribute: () => 'text' } as unknown as EventTarget;

    expect(router.claimKeyDown(event, { builderOpen: true })).toEqual({
      claimed: false,
      surface: 'builder-workspace',
      reason: 'builder-workspace owns unclaimed input',
    });
    expect(router.claimKeyDown(event, {})).toMatchObject({ claimed: false, surface: 'game' });
    expect(router.claimKeyDown(event, { builderOpen: true, target: input })).toMatchObject({
      claimed: true,
      surface: 'text-entry',
    });
    expect(router.claimKeyDown(event, { builderOpen: true, consoleOpen: true })).toMatchObject({
      claimed: false,
      surface: 'builder-workspace',
    });
    expect(router.claimKeyDown(keyboard('KeyB', { key: 'b' }), { builderOpen: true, consoleOpen: true })).toMatchObject({
      claimed: true,
      surface: 'console-open',
    });
    expect(router.claimKeyDown(event, { consoleOpen: true, consoleInputFocused: true })).toMatchObject({
      claimed: true,
      surface: 'console-input',
    });
    expect(router.claimKeyDown(event, { commandPaletteOpen: true, consoleInputFocused: true })).toMatchObject({
      claimed: true,
      surface: 'command-palette',
    });
    expect(router.claimKeyDown(event, { menuOpen: true, consoleInputFocused: true })).toMatchObject({
      claimed: true,
      surface: 'menu',
    });
    expect(router.claimKeyDown(event, { interactivePopoverOpen: true, consoleOpen: true, builderOpen: true })).toMatchObject({
      claimed: true,
      surface: 'interactive-popover',
    });
    expect(router.claimKeyDown(event, { builderHelpOpen: true, commandPaletteOpen: true })).toMatchObject({
      claimed: true,
      surface: 'builder-help',
    });
    expect(router.claimKeyDown(event, { appDialogOpen: true, builderHelpOpen: true })).toMatchObject({
      claimed: true,
      surface: 'app-dialog',
    });
  });

  it('uses the same priority for keyup and ignores non-text input controls as text entry', () => {
    const router = new FocusRouter();
    const checkbox = { tagName: 'INPUT', isContentEditable: false, getAttribute: () => 'checkbox' } as unknown as EventTarget;

    expect(router.claimKeyUp(keyboard('KeyW'), { commandPaletteOpen: true })).toMatchObject({
      claimed: true,
      surface: 'command-palette',
    });
    expect(router.isTextEntryTarget(checkbox)).toBe(false);
  });
});

describe('editor popover and menu hosts', () => {
  it('places popovers beside anchors, flips at edges, and clamps to the viewport', () => {
    const viewport = { width: 800, height: 600 };
    const size = { width: 190, height: 120 };

    expect(placePopover({ left: 20, top: 40, right: 60, bottom: 70, width: 40, height: 30 }, size, viewport)).toEqual({
      left: 70,
      top: 40,
      side: 'right',
    });
    expect(placePopover({ left: 760, top: 540, right: 800, bottom: 570, width: 40, height: 30 }, size, viewport)).toEqual({
      left: 560,
      top: 472,
      side: 'left',
    });
  });

  it('builds command-backed menu items with disabled reasons and visibility filtering', () => {
    const registry = new CommandRegistry();
    registry.register({ id: 'builder.a', label: 'A', category: 'test', run: () => undefined });
    registry.register({
      id: 'builder.b',
      label: 'B',
      category: 'test',
      enabled: () => false,
      disabledReason: () => 'Select something first',
      run: () => undefined,
    });
    registry.register({ id: 'builder.hidden', label: 'Hidden', category: 'test', visible: () => false, run: () => undefined });

    expect(commandMenuItems(registry, ['builder.a', 'builder.b', 'builder.hidden', 'missing'])).toEqual([
      { id: 'builder.a', label: 'A', enabled: true },
      { id: 'builder.b', label: 'B', enabled: false, reason: 'Select something first' },
    ]);
  });
});

describe('editor field controls', () => {
  it('renders stable field metadata and escapes labels/options', () => {
    const html = selectField({
      id: 'param.logic',
      label: 'logic <mode>',
      value: 'and',
      options: [
        { value: 'and', label: 'AND' },
        { value: 'or', label: 'OR' },
      ],
      dataset: { p: 'logic' },
    });

    expect(html).toContain('data-field-id="param.logic"');
    expect(html).toContain('logic &lt;mode&gt;');
    expect(html).toContain('data-p="logic"');
    expect(html).toContain('<option value="and" selected>AND</option>');
  });

  it('renders disabled reasons and typed inputs for inspector rows', () => {
    expect(
      numberField({
        id: 'light.radius',
        label: 'radius',
        value: 24,
        min: 4,
        max: 160,
        disabled: true,
        disabledReason: 'Select a light first',
        dataset: { lf: 'radius' },
      }),
    ).toContain('disabled aria-disabled="true"');
    expect(checkboxField({ id: 'param.oneShot', label: 'one shot', checked: true, dataset: { p: 'oneShot' } })).toContain(
      'checked',
    );
    expect(
      vec2Field({
        id: 'light.position',
        label: 'position',
        x: 10,
        y: 20,
        xDataset: { lf: 'x' },
        yDataset: { lf: 'y' },
      }),
    ).toContain('class="editor-field-vec2"');
  });

  it('renders control ids, placeholders, command metadata, and mixed checkboxes', () => {
    const html = numberField({
      id: 'document.mood.ambient',
      label: 'ambient',
      value: '',
      controlId: 'bi-mood-ambient',
      placeholder: 'default',
      dataset: { docField: 'mood.ambient' },
    });

    expect(html).toContain('id="bi-mood-ambient"');
    expect(html).toContain('placeholder="default"');
    expect(html).toContain('data-doc-field="mood.ambient"');
    expect(
      checkboxField({
        id: 'selection.locked',
        label: 'locked',
        checked: false,
        mixed: true,
        dataset: { mf: 'locked' },
      }),
    ).toContain('aria-checked="mixed"');
  });
});

describe('inspector schema rendering', () => {
  const light = (): EditorLight => ({
    id: 'light-1',
    x: 10,
    y: 20,
    color: '#ffaa00',
    intensity: 1,
    radius: 32,
    bloom: 0.25,
    flicker: 0,
    falloff: 'soft',
    occluded: true,
    locked: false,
    hidden: false,
  });

  const object = (patch: Partial<EditorObject> = {}): EditorObject => ({
    id: 'obj-1',
    kind: 'decor',
    x: 5,
    y: 6,
    rotation: 0,
    locked: false,
    hidden: false,
    params: { text: 'note', color: '#d6e6f5', ...patch.params },
    ...patch,
  });

  it('renders light fields from schema with command ownership metadata', () => {
    const html = renderInspectorItems(
      lightInspectorSchema(light(), { presetIds: Object.keys(LIGHT_PRESETS), solo: false, muted: true }),
    );

    expect(html).toContain('data-field-id="light.position"');
    expect(html).toContain('data-lf="x"');
    expect(html).toContain('data-command-id="builder.inspector.light.move"');
    expect(html).toContain('data-command-target="builder-document"');
    expect(html).toContain('data-command-owner="document-command"');
    expect(html).toContain('data-command-id="builder.inspector.light.mute"');
    expect(html).toContain('data-command-owner="view-session"');
  });

  it('escapes schema-rendered object values and sprite option labels', () => {
    const html = renderInspectorItems(
      objectInspectorSchema(
        object({
          params: {
            text: `"><img src=x onerror=alert(1)>`,
            color: '#d6e6f5',
            spriteId: 'sprite-1',
          },
        }),
        {
          objects: [],
          links: [],
          patrolEditId: null,
          sprites: [
            {
              v: 1,
              kind: 'sprite',
              id: 'sprite-1',
              name: '<bad sprite>',
              w: 4,
              h: 4,
              frames: [{ px: '', durationMs: 100 }],
              tags: [{ name: '<loop>', from: 0, to: 0, dir: 'forward' }],
              emissive: false,
            },
          ],
          documentSprites: [],
        },
      ),
    );

    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
    expect(html).toContain('&lt;bad sprite&gt;');
    expect(html).toContain('&lt;loop&gt;');
    expect(html).toContain('data-command-owner="asset-library"');
  });

  it('models mixed multi-select shared flags with composite-command metadata', () => {
    const a = object({ id: 'a', locked: true, hidden: false });
    const b = object({ id: 'b', locked: false, hidden: false });
    const html = renderInspectorItems(multiSelectionInspectorSchema([a, b], [light()]));

    expect(sharedValue([true, false])).toBe(MIXED_VALUE);
    expect(html).toContain('data-field-id="selection.locked"');
    expect(html).toContain('data-mf="locked"');
    expect(html).toContain('data-mixed="true"');
    expect(html).toContain('data-command-id="builder.inspector.selection.locked"');
    expect(html).toContain('data-command-target="builder-document"');
  });

  it('renders document mood as undoable document metadata fields', () => {
    const doc = createEmptyDocument('schema', 'earthen');
    doc.mood = { ambient: 0.24, ambience: `drips "deep"` };
    const html = renderInspectorItems(documentInspectorSchema(doc, 3));

    expect(html).toContain('data-field-id="document.mood.ambient"');
    expect(html).toContain('id="bi-mood-ambient"');
    expect(html).toContain('value="0.24"');
    expect(html).toContain('drips &quot;deep&quot;');
    expect(html).toContain('data-command-owner="document-metadata-command"');
    expect(html).toContain('data-command-undoable="true"');
  });
});

describe('editor workspace layout', () => {
  it('sanitizes corrupt layouts back to known Builder panels', () => {
    const layout = sanitizeWorkspaceLayout({
      panels: [
        { id: 'builder-palette', dock: 'floating', open: true, size: 9999 },
        { id: 'unknown', dock: 'left', open: true, size: 200 },
        { id: 'builder-inspector', dock: 'left', open: true, size: 180, floating: { x: -10, y: 20 } },
        { id: 'builder-world', dock: 'floating', open: true, size: 240, floating: { x: 120, y: 80 } },
      ],
      collapsedSections: { 'palette.materials': true },
      snapStep: 7,
      lastTool: '',
    });

    expect(layout.panels.some((panel) => panel.id === 'unknown')).toBe(false);
    expect(layout.panels.find((panel) => panel.id === 'builder-palette')).toMatchObject({
      dock: 'floating',
      open: true,
      size: 520,
    });
    expect(layout.panels.map((panel) => panel.id).slice(0, 3)).toEqual([
      'builder-palette',
      'builder-inspector',
      'builder-world',
    ]);
    expect(layout.panels.find((panel) => panel.id === 'builder-inspector')?.floating).toBeUndefined();
    expect(layout.panels.find((panel) => panel.id === 'builder-world')?.floating).toEqual({ x: 120, y: 80 });
    expect(layout.panels.find((panel) => panel.id === 'dev-console')).toMatchObject({
      dock: 'bottom',
      open: false,
      size: 260,
    });
    expect(layout.activePanelId).toBe('builder-palette');
    expect(layout.snapStep).toBe(0);
    expect(layout.lastTool).toBe('select');
    expect(layout.collapsedSections).toEqual({ 'palette.materials': true });
  });

  it('moves and opens panels without mutating the input layout', () => {
    const original = cloneDefaultBuilderLayout();
    const moved = movePanel(original, 'builder-inspector', 'bottom', { beforeId: 'dev-console' });
    const closed = setPanelOpen(moved, 'builder-inspector', false);

    expect(original.panels.find((panel) => panel.id === 'builder-inspector')?.dock).toBe('right');
    expect(moved.panels.find((panel) => panel.id === 'builder-inspector')).toMatchObject({
      dock: 'bottom',
      open: true,
      z: 1,
    });
    expect(moved.panels.findIndex((panel) => panel.id === 'builder-inspector')).toBeLessThan(
      moved.panels.findIndex((panel) => panel.id === 'dev-console'),
    );
    expect(moved.activePanelId).toBe('builder-inspector');
    expect(closed.panels.find((panel) => panel.id === 'builder-inspector')?.open).toBe(false);
  });

  it('persists floating panel coordinates', () => {
    const original = cloneDefaultBuilderLayout();
    const moved = movePanel(original, 'builder-palette', 'floating', { floating: { x: 180, y: 96 } });

    expect(moved.panels.find((panel) => panel.id === 'builder-palette')).toMatchObject({
      dock: 'floating',
      open: true,
      floating: { x: 180, y: 96 },
      z: 1,
    });
    expect(original.panels.find((panel) => panel.id === 'builder-palette')?.floating).toBeUndefined();
  });

  it('tracks active panels, z-order, and panel sizing separately from document state', () => {
    const opened = setPanelOpen(cloneDefaultBuilderLayout(), 'builder-world', true);
    const raised = raisePanel(opened, 'builder-palette');
    const resized = resizePanel(raised, 'builder-world', 9999);
    const closed = closePanel(resized, 'builder-palette');

    expect(opened.activePanelId).toBe('builder-world');
    expect(raised.panels.at(-1)?.id).toBe('builder-palette');
    expect(raised.activePanelId).toBe('builder-palette');
    expect(resized.panels.find((panel) => panel.id === 'builder-world')?.size).toBe(720);
    expect(panelsInDock(resized, 'right').map((panel) => panel.id)).toContain('builder-world');
    expect(closed.activePanelId).toBe('builder-inspector');
  });

  it('loads and saves workspace preferences through injected storage', () => {
    const storage = storageStub();
    const layout = movePanel(cloneDefaultBuilderLayout(), 'builder-palette', 'floating', {
      floating: { x: 180, y: 96 },
    });
    layout.collapsedSections['palette.materials'] = true;

    expect(saveWorkspaceLayout(layout, storage)).toBe(true);
    expect(storage.getItem(BUILDER_WORKSPACE_KEY)).toContain('palette.materials');
    expect(loadWorkspaceLayout(storage).panels.find((panel) => panel.id === 'builder-palette')).toMatchObject({
      dock: 'floating',
      open: true,
      floating: { x: 180, y: 96 },
    });
    expect(loadWorkspaceLayout(storage).collapsedSections).toEqual({ 'palette.materials': true });
  });

  it('handles missing browser storage without throwing', () => {
    const globals = globalThis as typeof globalThis & { localStorage?: Storage };
    const previous = globals.localStorage;
    delete globals.localStorage;
    try {
      expect(loadWorkspaceLayout()).toEqual(cloneDefaultBuilderLayout());
      expect(saveWorkspaceLayout(cloneDefaultBuilderLayout())).toBe(false);
    } finally {
      if (previous) globals.localStorage = previous;
    }
  });

  it('builds named workspace presets for focused workflows', () => {
    const validation = workspacePresetLayout('validation');
    const lighting = workspacePresetLayout('lighting');

    expect(validation.panels.find((panel) => panel.id === 'builder-issues')).toMatchObject({
      dock: 'bottom',
      open: true,
    });
    expect(validation.overlayVisibility.validation).toBe(true);
    expect(validation.overlayVisibility.clearance).toBe(true);
    expect(lighting.panels.find((panel) => panel.id === 'builder-world')?.open).toBe(true);
    expect(lighting.overlayVisibility.light).toBe(true);
  });

  it('treats the Dev Console as a dockable workspace panel', () => {
    const original = cloneDefaultBuilderLayout();
    const moved = movePanel(original, 'dev-console', 'right');

    expect(original.panels.find((panel) => panel.id === 'dev-console')).toMatchObject({
      dock: 'bottom',
      open: false,
    });
    expect(moved.panels.find((panel) => panel.id === 'dev-console')).toMatchObject({
      dock: 'right',
      open: true,
    });
  });
});

describe('editor panel registry and chrome', () => {
  it('registers Builder panels and rejects duplicate ids', () => {
    const registry = createBuilderPanelRegistry();
    const expectedIds = BUILDER_PANEL_SPECS.map((spec) => spec.id);

    expect(registry.list().map((spec) => spec.id)).toEqual(expectedIds);
    expect(registry.get('builder-palette')).toMatchObject({
      title: 'Palette',
      defaultDock: 'left',
      closePolicy: 'required',
    });
    expect(registry.get('dev-console')?.commandIds).toMatchObject({
      open: 'console.open',
      close: 'console.close',
    });
    expect(registry.canDock('dev-console', 'floating')).toBe(true);
    expect(registry.defaultLayouts()).toEqual(
      BUILDER_PANEL_SPECS.map((spec) => ({
        id: spec.id,
        dock: spec.defaultDock,
        open: spec.defaultOpen === true,
        size: spec.defaultSize,
      })),
    );
    expect(() => registry.register(registry.get('builder-palette')!)).toThrow(/duplicate panel id/);
  });

  it('uses panel registry rules to sanitize workspace layout', () => {
    const registry = new PanelRegistry();
    registry.register({
      id: 'fixed-left',
      title: 'Fixed Left',
      category: 'test',
      defaultDock: 'left',
      defaultOpen: true,
      defaultSize: 220,
      minSize: 200,
      maxSize: 260,
      allowedDocks: ['left'],
    });
    registry.register({
      id: 'floatable',
      title: 'Floatable',
      category: 'test',
      defaultDock: 'bottom',
      defaultSize: 280,
      minSize: 180,
      maxSize: 320,
      allowedDocks: ['bottom', 'floating'],
    });

    const layout = registry.sanitizeLayout({
      panels: [
        { id: 'fixed-left', dock: 'floating', open: true, size: 999, floating: { x: 18, y: 22 } },
        { id: 'floatable', dock: 'floating', open: true, size: 100, floating: { x: 18, y: 22 } },
      ],
      snapStep: 16,
      lastTool: 'paint',
    });

    expect(layout.panels.find((panel) => panel.id === 'fixed-left')).toMatchObject({
      dock: 'left',
      open: true,
      size: 260,
    });
    expect(layout.panels.find((panel) => panel.id === 'fixed-left')?.floating).toBeUndefined();
    expect(layout.panels.find((panel) => panel.id === 'floatable')).toMatchObject({
      dock: 'floating',
      open: true,
      size: 180,
      floating: { x: 18, y: 22 },
    });
  });

  it('respects allowed docks, close policy, focus, and snapshot isolation in DockHost', () => {
    const registry = new PanelRegistry();
    registry.register({
      id: 'locked',
      title: 'Locked',
      category: 'test',
      defaultDock: 'left',
      defaultOpen: true,
      defaultSize: 200,
      allowedDocks: ['left'],
      closePolicy: 'required',
    });
    registry.register({
      id: 'optional',
      title: 'Optional',
      category: 'test',
      defaultDock: 'bottom',
      defaultSize: 260,
      minSize: 180,
      maxSize: 320,
    });
    const host = new DockHost(registry, {
      ...cloneDefaultBuilderLayout(),
      panels: registry.defaultLayouts(),
      activePanelId: 'locked',
    });

    expect(host.movePanel('locked', 'right').panels.find((panel) => panel.id === 'locked')?.dock).toBe('left');
    expect(host.closePanel('locked').panels.find((panel) => panel.id === 'locked')?.open).toBe(true);
    expect(host.focusPanel('optional').activePanelId).toBe('optional');
    expect(host.snapshot().layout.panels.at(-1)?.id).toBe('optional');
    expect(host.resizePanel('optional', 9999).panels.find((panel) => panel.id === 'optional')?.size).toBe(320);
    expect(host.closePanel('optional').panels.find((panel) => panel.id === 'optional')?.open).toBe(false);

    const snapshot = host.snapshot();
    snapshot.layout.panels[0].dock = 'right';
    expect(host.snapshot().layout.panels[0].dock).toBe('left');
  });

  it('renders panel chrome and normalizes handle elements', () => {
    const html = panelChromeHtml({
      title: 'Danger <Panel>',
      dock: 'right',
      actions: [{ id: 'close', label: 'Close <panel>', icon: 'x' }],
    });

    expect(html).toContain('Danger &lt;Panel&gt;');
    expect(html).toContain('data-panel-dock="right"');
    expect(html).toContain('aria-label="Close &lt;panel&gt;"');

    if (typeof document !== 'undefined') {
      const panel = document.createElement('div');
      panel.innerHTML = '<div class="bi-head">Inspector</div>';
      const handles = normalizePanelChromeHandles(panel);
      expect(handles).toHaveLength(1);
      expect(handles[0].dataset.panelHandle).toBe('true');
      expect(handles[0].classList.contains('builder-panel-handle')).toBe(true);
    }
  });
});

describe('builder overlay registry', () => {
  it('sanitizes overlay preferences to known overlay ids', () => {
    const visibility = sanitizeOverlayVisibility({ light: true, unknown: true });

    expect(visibility.light).toBe(true);
    expect(visibility.unknown).toBeUndefined();
    expect(visibility.validation).toBe(false);
    expect(overlayLabel('validation')).toBe('Validation Badges');
  });
});
