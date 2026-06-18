import { describe, expect, it } from 'vitest';
import { renderRuntimePanel } from '@/builder/runtimePanel';
import type { RuntimeEntitySnapshot } from '@/game/runtimeSnapshot';

describe('runtime panel renderer', () => {
  it('renders source, counts, particle aggregate, selected detail, and focus actions', () => {
    const html = renderRuntimePanel({
      snapshot: makeSnapshot(),
      query: '',
      filters: new Set(),
      overlays: { bounds: true, labels: false, velocity: true },
    });

    expect(html).toContain('Builder Playtest');
    expect(html).toContain('Enemies');
    expect(html).toContain('Particle Aggregate');
    expect(html).toContain('Viewport Overlays');
    expect(html).toContain('data-runtime-overlay="bounds"');
    expect(html).toContain('data-runtime-overlay="velocity"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('data-runtime-id="enemy:1"');
    expect(html).toContain('data-runtime-focus="enemy:1"');
    expect(html).toContain('role="option"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('hp');
  });

  it('filters rows from the cached snapshot model', () => {
    const html = renderRuntimePanel({
      snapshot: makeSnapshot(),
      query: 'projectile',
      filters: new Set(['projectiles']),
      overlays: { bounds: false, labels: false, velocity: false },
    });

    expect(html).toContain('data-runtime-id="projectile:1"');
    expect(html).not.toContain('data-runtime-id="enemy:1"');
  });

  it('can hide Builder-only overlay controls for the top-level runtime inspector', () => {
    const html = renderRuntimePanel({
      snapshot: makeSnapshot(),
      query: '',
      filters: new Set(),
      showOverlayControls: false,
      showFocusActions: false,
    });

    expect(html).toContain('Builder Playtest');
    expect(html).not.toContain('Viewport Overlays');
    expect(html).not.toContain('data-runtime-overlay="bounds"');
    expect(html).not.toContain('data-runtime-focus=');
    expect(html).not.toContain('brt-follow-selected');
  });

  it('renders optional Play camera follow controls for the top-level runtime inspector', () => {
    const html = renderRuntimePanel({
      snapshot: makeSnapshot(),
      query: '',
      filters: new Set(),
      showOverlayControls: false,
      showFocusActions: false,
      showCameraControls: true,
      cameraFollowEnabled: true,
    });

    expect(html).toContain('id="brt-follow-selected"');
    expect(html).toContain('Follow Entity');
    expect(html).toContain('checked');
  });

  it('points author-mode empty runtime panels at Logic Preview', () => {
    const snapshot = makeSnapshot();
    snapshot.source = { id: 'build', label: 'Builder Authoring', detail: 'No active play runtime' };
    snapshot.rows = [];
    snapshot.counts = snapshot.counts.map((count) => ({ ...count, total: 0, visible: 0, sampled: 0 }));

    const html = renderRuntimePanel({
      snapshot,
      query: '',
      filters: new Set(),
      overlays: { bounds: false, labels: false, velocity: false },
    });

    expect(html).toContain('Switch to LOGIC PREVIEW to inspect authored preview rows');
  });

  it('explains empty Builder Logic Preview snapshots', () => {
    const snapshot = makeSnapshot();
    snapshot.source = {
      id: 'builder-live-preview',
      label: 'Builder Logic Preview',
      detail: 'Logic Preview running from disposable runtime',
    };
    snapshot.level = { id: 'builder-live-preview', name: 'Logic Preview', depth: 0 };
    snapshot.rows = [];
    snapshot.counts = snapshot.counts.map((count) => ({ ...count, total: 0, visible: 0, sampled: 0 }));
    snapshot.particles = {
      total: 0,
      visible: 0,
      visual: 0,
      depositing: 0,
      homing: 0,
      hostile: 0,
      glowing: 0,
      byMaterial: [],
    };

    const html = renderRuntimePanel({
      snapshot,
      query: '',
      filters: new Set(),
      overlays: { bounds: false, labels: false, velocity: false },
    });

    expect(html).toContain('No authored preview runtime rows');
    expect(html).toContain('Logic Preview is running, but this document has no authored preview entities');
    expect(html).toContain('Full player and material simulation appears during Builder Playtest');
  });

  it('marks non-empty Builder Logic Preview rows as authored preview rows', () => {
    const snapshot = makeSnapshot();
    snapshot.source = {
      id: 'builder-live-preview',
      label: 'Builder Logic Preview',
      detail: 'Logic Preview running from disposable runtime',
    };
    snapshot.level = { id: 'builder-live-preview', name: 'Logic Preview', depth: 0 };

    const html = renderRuntimePanel({
      snapshot,
      query: '',
      filters: new Set(),
      overlays: { bounds: false, labels: false, velocity: false },
    });

    expect(html).toContain('Logic Preview is showing authored preview rows only');
    expect(html).toContain('data-runtime-id="enemy:1"');
  });
});

function makeSnapshot(): RuntimeEntitySnapshot {
  return {
    frame: 12,
    mode: 'play',
    source: { id: 'builder-playtest', label: 'Builder Playtest', detail: 'Disposable playtest runtime' },
    level: { id: 'test', name: 'Test Level', depth: 1 },
    selectedId: 'enemy:1',
    selectedMissing: false,
    capped: false,
    particles: {
      total: 4,
      visible: 3,
      visual: 1,
      depositing: 3,
      homing: 1,
      hostile: 0,
      glowing: 2,
      byMaterial: [{ label: 'Sand', count: 2 }],
    },
    counts: [
      { group: 'player', label: 'Player', total: 1, visible: 1, sampled: 1 },
      { group: 'enemies', label: 'Enemies', total: 1, visible: 1, sampled: 1 },
      { group: 'projectiles', label: 'Projectiles', total: 1, visible: 1, sampled: 1 },
      { group: 'critters', label: 'Critters', total: 0, visible: 0, sampled: 0 },
      { group: 'pickups', label: 'Pickups', total: 0, visible: 0, sampled: 0 },
      { group: 'mechanisms', label: 'Mechanisms', total: 0, visible: 0, sampled: 0 },
      { group: 'portal', label: 'Portal', total: 0, visible: 0, sampled: 0 },
      { group: 'particles', label: 'Particles', total: 4, visible: 3, sampled: 0 },
    ],
    rows: [
      {
        id: 'enemy:1',
        group: 'enemies',
        kind: 'slime',
        label: 'slime',
        sublabel: '10, 20 - hp 4/10',
        x: 10,
        y: 20,
        hp: 4,
        maxHp: 10,
        visible: true,
        badges: ['grounded'],
        fields: [{ label: 'hp', value: '4 / 10' }],
        searchText: 'enemy slime grounded hp',
      },
      {
        id: 'projectile:1',
        group: 'projectiles',
        kind: 'bolt',
        label: 'bolt',
        sublabel: '12, 20 - life 30',
        x: 12,
        y: 20,
        life: 30,
        visible: true,
        badges: ['friendly'],
        fields: [{ label: 'type', value: 'projectile bolt' }],
        searchText: 'projectile bolt friendly',
      },
    ],
    selectedRow: {
      id: 'enemy:1',
      group: 'enemies',
      kind: 'slime',
      label: 'slime',
      sublabel: '10, 20 - hp 4/10',
      x: 10,
      y: 20,
      hp: 4,
      maxHp: 10,
      visible: true,
      badges: ['grounded'],
      fields: [{ label: 'hp', value: '4 / 10' }],
      searchText: 'enemy slime grounded hp',
    },
  };
}
