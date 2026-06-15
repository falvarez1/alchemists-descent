import { describe, expect, it } from 'vitest';
import {
  drawRuntimeEntityOverlays,
  runtimeOverlayRows,
  runtimeOverlaySummary,
  runtimeOverlaysActive,
  type RuntimeOverlayState,
} from '@/builder/runtimeOverlay';
import type { RuntimeEntityRow, RuntimeEntitySnapshot } from '@/game/runtimeSnapshot';

describe('runtime entity overlays', () => {
  it('summarizes active overlay toggles', () => {
    expect(runtimeOverlaysActive(overlays())).toBe(false);
    expect(runtimeOverlaySummary(overlays())).toBe('OFF');
    expect(runtimeOverlaySummary(overlays({ bounds: true, labels: true }))).toBe('BOUNDS, IDS');
  });

  it('draws only visible non-particle snapshot rows', () => {
    const snapshot = makeSnapshot([
      row({ id: 'enemy:1', group: 'enemies', visible: true, vx: 1, vy: 0 }),
      row({ id: 'enemy:2', group: 'enemies', visible: false }),
      row({ id: 'particle:1', group: 'particles', visible: true }),
    ]);
    const recorder = makeCanvasRecorder();

    expect(runtimeOverlayRows(snapshot).map((entry) => entry.id)).toEqual(['enemy:1']);

    drawRuntimeEntityOverlays(recorder.g, snapshot, overlays({ bounds: true, labels: true, velocity: true }), {
      cellW: 2,
      cellH: 2,
      width: 320,
      height: 200,
      toScreen: (x, y) => ({ x: x * 2, y: y * 2 }),
    });

    expect(recorder.calls).toContain('strokeRect');
    expect(recorder.calls).toContain('lineTo');
    expect(recorder.calls.some((call) => call.startsWith('fillText:RUNTIME:'))).toBe(true);
    expect(recorder.calls.some((call) => call.includes('slime enemy:1'))).toBe(true);
  });

  it('keeps the selected visible row beyond the global overlay draw cap', () => {
    const rows = Array.from({ length: 430 }, (_, index) => row({ id: `enemy:${index}` }));
    const selected = rows[rows.length - 1];
    const snapshot = makeSnapshot(rows);
    snapshot.selectedId = selected.id;
    snapshot.selectedRow = selected;

    const visible = runtimeOverlayRows(snapshot);

    expect(visible).toHaveLength(421);
    expect(visible.at(-1)?.id).toBe(selected.id);
  });

  it('is a no-op when no runtime overlays are active', () => {
    const recorder = makeCanvasRecorder();
    drawRuntimeEntityOverlays(recorder.g, makeSnapshot([row()]), overlays(), {
      cellW: 1,
      cellH: 1,
      width: 100,
      height: 80,
      toScreen: (x, y) => ({ x, y }),
    });

    expect(recorder.calls).toEqual([]);
  });
});

function overlays(patch: Partial<RuntimeOverlayState> = {}): RuntimeOverlayState {
  return { bounds: false, labels: false, velocity: false, ...patch };
}

function makeSnapshot(rows: RuntimeEntityRow[]): RuntimeEntitySnapshot {
  return {
    frame: 1,
    mode: 'play',
    source: { id: 'builder-playtest', label: 'Builder Playtest', detail: 'Disposable playtest runtime' },
    level: { id: 'test', name: 'Test', depth: 1 },
    rows,
    counts: [],
    particles: {
      total: 0,
      visible: 0,
      visual: 0,
      depositing: 0,
      homing: 0,
      hostile: 0,
      glowing: 0,
      byMaterial: [],
    },
    selectedId: 'enemy:1',
    selectedRow: rows[0] ?? null,
    selectedMissing: false,
    capped: false,
  };
}

function row(patch: Partial<RuntimeEntityRow> = {}): RuntimeEntityRow {
  return {
    id: 'enemy:1',
    group: 'enemies',
    kind: 'slime',
    label: 'slime',
    sublabel: '10, 20',
    x: 10,
    y: 20,
    vx: 0,
    vy: 0,
    visible: true,
    bounds: { x0: 5, y0: 12, x1: 16, y1: 21 },
    badges: [],
    fields: [],
    searchText: 'slime enemy',
    ...patch,
  };
}

function makeCanvasRecorder(): { calls: string[]; g: CanvasRenderingContext2D } {
  const calls: string[] = [];
  const g = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    font: '',
    textBaseline: '',
    save: () => calls.push('save'),
    restore: () => calls.push('restore'),
    fillRect: () => calls.push('fillRect'),
    strokeRect: () => calls.push('strokeRect'),
    beginPath: () => calls.push('beginPath'),
    arc: () => calls.push('arc'),
    fill: () => calls.push('fill'),
    stroke: () => calls.push('stroke'),
    moveTo: () => calls.push('moveTo'),
    lineTo: () => calls.push('lineTo'),
    closePath: () => calls.push('closePath'),
    setLineDash: () => calls.push('setLineDash'),
    fillText: (text: string) => calls.push(`fillText:${text}`),
    measureText: (text: string) => ({ width: text.length * 6 }) as TextMetrics,
  } as unknown as CanvasRenderingContext2D;
  return { calls, g };
}
