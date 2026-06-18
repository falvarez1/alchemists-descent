import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/builder/document';
import { rleEncode } from '@/core/rle';
import { buildAssetDatabase } from '@/builder/assets/AssetDatabase';
import { createBuiltInContentAssetRecords } from '@/builder/assets/ContentAssetProvider';
import { previewJsonImport, previewReimport } from '@/builder/assets/AssetImportPipeline';
import { LocalStorageAssetStore } from '@/builder/assets/AssetStore';
import { MATERIAL_PARAMS } from '@/config/params';
import type { PrefabDef } from '@/builder/prefablib';
import { loadPrefabs } from '@/builder/prefablib';
import { loadSprites, saveSprite } from '@/builder/assets/spritelib';
import { encodeFramePx } from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';
import { renderAssetDetailPanel } from '@/builder/assetDetailPanel';
import { renderAssetBrowserPanel, renderAssetPlacementPanel } from '@/builder/assetBrowserPanel';

class StorageStub implements Storage {
  private readonly data = new Map<string, string>();
  private readonly failingSetPrefixes = new Set<string>();
  private readonly failingValueFragments = new Set<string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
    this.failingSetPrefixes.clear();
    this.failingValueFragments.clear();
  }

  getItem(key: string): string | null {
    return this.data.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    if ([...this.failingSetPrefixes].some((prefix) => key.startsWith(prefix))) {
      throw new Error(`forced storage failure for ${key}`);
    }
    if ([...this.failingValueFragments].some((fragment) => value.includes(fragment))) {
      throw new Error(`forced storage failure for value containing ${[...this.failingValueFragments].join(',')}`);
    }
    this.data.set(key, value);
  }

  failSetItemForPrefix(prefix: string): void {
    this.failingSetPrefixes.add(prefix);
  }

  failSetItemForValueContaining(fragment: string): void {
    this.failingValueFragments.add(fragment);
  }
}

(globalThis as typeof globalThis & { localStorage: Storage }).localStorage = new StorageStub();

beforeEach(() => {
  (globalThis.localStorage as StorageStub).clear();
});

describe('asset database', () => {
  it('indexes documents, prefabs, sprites, built-ins, dependencies, and usages with stable ids', () => {
    const sprite = spriteAsset('sprite-torch', 'Torch');
    const doc = createEmptyDocument('asset-doc', 'earthen');
    doc.objects.push({
      id: 'decor-1',
      kind: 'decor',
      x: 10,
      y: 20,
      rotation: 0,
      locked: false,
      hidden: false,
      params: { spriteId: sprite.id },
    });
    const prefab = prefabAsset('prefab-room', 'Room', sprite.id);
    const builtin = prefabAsset('builtin-room', 'Built Room', sprite.id);

    const db = buildAssetDatabase({
      currentDocument: doc,
      prefabs: [prefab],
      builtinPrefabs: [builtin],
      sprites: [sprite],
    });

    const spriteRecord = db.get('sprite:library:sprite-torch');
    expect(spriteRecord?.usages.map((usage) => usage.kind).sort()).toEqual(['document', 'prefab', 'prefab']);
    expect(db.get('document:project:' + doc.id)?.dependencies.refs).toHaveLength(1);
    expect(db.get('prefab:built-in:builtin-room')?.immutable).toBe(true);
    expect(db.deletePlan('sprite:library:sprite-torch')).toMatchObject({
      allowed: false,
      options: ['reassign', 'embed', 'cancel'],
    });
  });

  it('creates missing dependency records and supports smart collection queries', () => {
    const doc = createEmptyDocument('missing-doc', 'earthen');
    doc.objects.push({
      id: 'decor-1',
      kind: 'decor',
      x: 4,
      y: 5,
      rotation: 0,
      locked: false,
      hidden: false,
      params: { spriteId: 'sprite-missing' },
    });

    const db = buildAssetDatabase({ currentDocument: doc });
    const missing = db.get('sprite:missing:sprite-missing');

    expect(missing).toMatchObject({ origin: 'missing', validation: { state: 'error' } });
    expect(missing?.usages).toHaveLength(1);
    expect(missing?.usages[0]).toMatchObject({ assetId: `document:project:${doc.id}`, label: 'Current missing-doc' });
    expect(db.query({ collection: 'missing' }).map((record) => record.assetId)).toContain('sprite:missing:sprite-missing');
    expect(db.get('document:project:' + doc.id)?.dependencies.state).toBe('missing');
  });

  it('indexes embedded sprites from saved documents and does not report them missing', () => {
    const sprite = spriteAsset('embedded-torch', 'Embedded Torch');
    const doc = createEmptyDocument('saved-doc', 'earthen');
    doc.assets = { sprites: [sprite] };
    doc.objects.push({
      id: 'decor-1',
      kind: 'decor',
      x: 4,
      y: 5,
      rotation: 0,
      locked: false,
      hidden: false,
      params: { spriteId: sprite.id },
    });

    const db = buildAssetDatabase({ documents: { [doc.id]: doc } });

    expect(db.get(`document:project:${doc.id}`)?.dependencies.state).toBe('ok');
    expect(db.get(`sprite:document-embedded:${doc.id}:embedded-torch`)?.usages).toMatchObject([
      { assetId: `document:project:${doc.id}`, label: 'saved-doc' },
    ]);
    expect(db.query({ collection: 'missing' }).map((record) => record.assetId)).not.toContain('sprite:missing:embedded-torch');
  });

  it('scopes embedded sprite asset ids by owning document', () => {
    const first = createEmptyDocument('first-doc', 'earthen');
    const second = createEmptyDocument('second-doc', 'earthen');
    first.assets = { sprites: [spriteAsset('shared-embedded', 'First Embedded')] };
    second.assets = { sprites: [spriteAsset('shared-embedded', 'Second Embedded', [20, 30, 40, 255])] };

    const db = buildAssetDatabase({ documents: { [first.id]: first, [second.id]: second } });

    expect(db.get(`sprite:document-embedded:${first.id}:shared-embedded`)?.name).toBe('First Embedded');
    expect(db.get(`sprite:document-embedded:${second.id}:shared-embedded`)?.name).toBe('Second Embedded');
    expect(db.query({ kinds: ['sprite'], origins: ['document-embedded'] })).toHaveLength(2);
  });

  it('filters and sorts by kind, origin, text, usage, and validation', () => {
    const sprite = spriteAsset('sprite-a', 'Blue Torch');
    const db = buildAssetDatabase({
      currentDocument: createEmptyDocument('filter-doc', 'earthen'),
      sprites: [sprite],
      builtinPrefabs: [prefabAsset('builtin-a', 'Stock Shrine')],
    });

    expect(db.query({ kinds: ['sprite'], text: 'blue' }).map((record) => record.assetId)).toEqual([
      'sprite:library:sprite-a',
    ]);
    expect(db.query({ origins: ['built-in'], text: 'stock' }).map((record) => record.assetId)).toEqual([
      'prefab:built-in:builtin-a',
    ]);
    expect(db.query({ sort: 'validation' })[0].validation.state).toMatch(/valid|warning|error/);
  });

  it('surfaces sanitizer warnings from accepted prefab imports', () => {
    const prefab = prefabAsset('lossy-prefab', 'Lossy Prefab');
    const db = buildAssetDatabase({
      prefabs: [prefab],
      importReports: [
        {
          id: 'report-lossy',
          name: 'lossy report',
          sourceFile: 'lossy.prefab.json',
          importedAt: '2026-06-15T00:00:00.000Z',
          decision: 'accepted',
          importedKind: 'prefab',
          importedSourceId: prefab.id,
          finalSourceId: prefab.id,
          importedAssetId: `prefab:library:${prefab.id}`,
          replacedAssetId: undefined,
          warnings: ['dropped a link with a missing endpoint'],
          errors: [],
          diff: [],
          contentSignature: 'sig',
        },
      ],
    });

    expect(db.get(`prefab:library:${prefab.id}`)?.validation).toMatchObject({
      state: 'warning',
      warnings: 1,
      messages: ['dropped a link with a missing endpoint'],
    });
  });

  it('blocks built-in deletion and allows unused library asset deletion', () => {
    const sprite = spriteAsset('sprite-free', 'Free Sprite');
    const db = buildAssetDatabase({
      sprites: [sprite],
      builtinPrefabs: [prefabAsset('builtin-a', 'Stock Shrine')],
    });

    expect(db.deletePlan('prefab:built-in:builtin-a')).toMatchObject({ allowed: false });
    expect(db.deletePlan('sprite:library:sprite-free')).toMatchObject({ allowed: true, options: ['remove', 'cancel'] });
  });

  it('blocks current document asset mutations while keeping export visible', () => {
    const doc = createEmptyDocument('current-doc', 'earthen');
    const db = buildAssetDatabase({ currentDocument: doc });
    const record = db.get(`document:project:${doc.id}`)!;
    const html = renderAssetDetailPanel({ asset: record, deletePlan: db.deletePlan(record.assetId) });

    expect(db.deletePlan(record.assetId)).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([expect.stringContaining('Current Builder document')]),
    });
    expect(html).toContain('data-asset-action="rename"');
    expect(html).toContain('data-asset-action="duplicate"');
    expect(html).toContain('data-asset-action="export"');
    expect(html).toMatch(/data-asset-action="rename"[^>]+disabled/);
    expect(html).toMatch(/data-asset-action="duplicate"[^>]+disabled/);
    expect(html).toMatch(/data-asset-action="delete"[^>]+disabled/);
  });

  it('indexes built-in gameplay content as immutable Asset Database records', () => {
    const db = buildAssetDatabase({
      materials: MATERIAL_PARAMS,
      contentAssets: createBuiltInContentAssetRecords({ materials: MATERIAL_PARAMS }),
    });

    expect(db.get('card:built-in:spark')).toMatchObject({
      kind: 'card',
      origin: 'built-in',
      immutable: true,
      source: { storage: 'content-registry' },
    });
    expect(db.get('modifier:built-in:infuser')).toMatchObject({ kind: 'modifier', immutable: true });
    expect(db.get('potion:built-in:vigor')).toMatchObject({ kind: 'potion', immutable: true });
    expect(db.get('recipe:built-in:life')?.dependencies.state).toBe('ok');
    expect(db.get('elixir:built-in:cell-21')?.dependencies.state).toBe('ok');
    expect(db.get('material:built-in:cell-2')).toMatchObject({ name: 'Water', immutable: true });
    expect(db.get('enemy:built-in:slime')).toMatchObject({ kind: 'enemy', immutable: true });
    expect(db.get('encounterScenario:built-in:d1')).toMatchObject({ kind: 'encounterScenario' });
    expect(db.get('encounterScenario:built-in:d1')?.dependencies.refs.map((ref) => `${ref.kind}:${ref.sourceId}`)).toEqual(expect.arrayContaining([
      'enemy:bat',
      'enemy:eggs',
    ]));
    expect(db.get('spellLabScenario:built-in:review-brass-injector-spell-lab')).toMatchObject({ kind: 'spellLabScenario' });
    expect(db.get('cookReport:built-in:builtin-content-cook')).toMatchObject({ kind: 'cookReport', validation: { state: 'warning' } });
    expect(db.deletePlan('card:built-in:spark')).toMatchObject({
      allowed: false,
      reasons: expect.arrayContaining([expect.stringContaining('read-only')]),
    });
    expect(db.query({ collection: 'unused' }).every((record) => record.source.storage !== 'content-registry')).toBe(true);
    expect(new LocalStorageAssetStore().export(db.get('card:built-in:spark')!)).toMatchObject({
      filename: 'spark.card.content-metadata.json',
      text: expect.stringContaining('"metadataOnly":true'),
    });
  });

  it('tracks content dependencies and document usages without mutating runtime definitions', () => {
    const doc = createEmptyDocument('content-doc', 'earthen');
    doc.objects.push(
      {
        id: 'enemy-1',
        kind: 'enemy',
        x: 10,
        y: 10,
        rotation: 0,
        locked: false,
        hidden: false,
        params: { kind: 'imp' },
      },
      {
        id: 'tome-1',
        kind: 'pickup',
        x: 12,
        y: 10,
        rotation: 0,
        locked: false,
        hidden: false,
        params: { kind: 'tome', card: 'spark' },
      },
      {
        id: 'potion-1',
        kind: 'pickup',
        x: 14,
        y: 10,
        rotation: 0,
        locked: false,
        hidden: false,
        params: { kind: 'potion', potion: 'swift' },
      },
    );
    const db = buildAssetDatabase({
      currentDocument: doc,
      materials: MATERIAL_PARAMS,
      contentAssets: createBuiltInContentAssetRecords({ materials: MATERIAL_PARAMS }),
    });

    expect(db.get(`document:project:${doc.id}`)?.dependencies.refs.map((ref) => `${ref.kind}:${ref.sourceId}`).sort()).toEqual([
      'card:spark',
      'enemy:imp',
      'potion:swift',
    ]);
    expect(db.usageFor('enemy:built-in:imp')).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: `document:project:${doc.id}`, label: 'Current content-doc' }),
    ]));
    expect(db.usageFor('card:built-in:spark').some((usage) => usage.assetId === `document:project:${doc.id}`)).toBe(true);
    expect(db.usageFor('potion:built-in:swift')).toEqual(expect.arrayContaining([
      expect.objectContaining({ assetId: `document:project:${doc.id}` }),
    ]));
    expect(db.get('wandLoadout:built-in:review-brass-injector')?.dependencies.refs.map((ref) => `${ref.kind}:${ref.sourceId}`)).toEqual([
      'wandFrame:brass',
      'modifier:watertrail',
      'modifier:electriccharge',
      'modifier:critwet',
      'modifier:shorthoming',
      'card:spark',
    ]);
  });

  it('keeps editor material profiles distinct from runtime material content', () => {
    const db = buildAssetDatabase({
      materials: MATERIAL_PARAMS,
      contentAssets: createBuiltInContentAssetRecords({ materials: MATERIAL_PARAMS }),
    });

    expect(db.get('materialProfile:built-in:cell-2')).toMatchObject({ kind: 'materialProfile', name: 'Water' });
    expect(db.get('material:built-in:cell-2')).toMatchObject({ kind: 'material', name: 'Water' });
  });

  it('renders Asset Browser multi-select controls without changing single-selection detail state', () => {
    const sprite = spriteAsset('sprite-batch-a', 'Batch A');
    const prefab = prefabAsset('prefab-batch-b', 'Batch B');
    const db = buildAssetDatabase({ sprites: [sprite], prefabs: [prefab] });
    const selectedIds = new Set(['sprite:library:sprite-batch-a', 'prefab:library:prefab-batch-b']);

    const html = renderAssetBrowserPanel({
      query: '',
      view: 'grid',
      sort: 'name',
      collection: 'all',
      kindFilters: new Set(),
      originFilters: new Set(),
      records: db.query({ kinds: ['sprite', 'prefab'] }),
      selectedId: 'sprite:library:sprite-batch-a',
      selectedIds,
      hiddenSelectedCount: 0,
      batchDeleteBlockedReason: undefined,
      stats: db.stats(),
      collapsedSections: {},
    });

    expect(html).toContain('id="ba-select-visible"');
    expect(html).toContain('id="ba-batch-export"');
    expect(html).toContain('id="ba-batch-delete"');
    expect(html).toContain('2 selected');
    expect(html.match(/data-asset-select="/g)).toHaveLength(2);
    expect(html).toContain('ba-card selected multi-selected');
  });

  it('renders compact placement views from Asset Database records', () => {
    const prefab = prefabAsset('prefab-palette', 'Palette Room');
    const sprite = spriteAsset('sprite-palette', 'Palette Torch');
    const db = buildAssetDatabase({ prefabs: [prefab], sprites: [sprite] });
    const prefabId = 'prefab:library:prefab-palette';
    const spriteId = 'sprite:library:sprite-palette';

    const html = renderAssetPlacementPanel({
      title: 'Prefab Assets',
      query: 'palette',
      searchPlaceholder: 'Search prefabs',
      emptyMessage: 'No prefabs',
      records: db.query({ kinds: ['prefab', 'sprite'], text: 'palette' }),
      selectedId: prefabId,
      armedId: spriteId,
      actions: [
        { id: 'capture', label: 'Capture', title: 'Capture prefab' },
        { id: 'import', label: 'Import', title: 'Import assets' },
      ],
    });

    expect(html).toContain('class="ba-placement-browser"');
    expect(html).toContain('data-asset-placement-action="capture"');
    expect(html).toContain('data-asset-placement-search');
    expect(html).toMatch(new RegExp(`data-asset-id="${prefabId}"[^>]+draggable="true"`));
    expect(html).toMatch(new RegExp(`data-asset-id="${spriteId}"[^>]+draggable="true"`));
    expect(html).toMatch(new RegExp(`class="ba-placement-row selected"[^>]+data-asset-id="${prefabId}"`));
    expect(html).toMatch(new RegExp(`class="ba-placement-row armed"[^>]+data-asset-id="${spriteId}"`));
    expect(html).toContain(`data-asset-placement-details="${prefabId}"`);
    expect(html).not.toContain('role="tree"');
    expect(html).not.toContain('ba-chip');
  });

  it('marks non-prefab stage action assets as draggable while documents use explicit open actions', () => {
    const doc = createEmptyDocument('drop-doc', 'earthen');
    const db = buildAssetDatabase({
      currentDocument: doc,
      templates: { 'template-drop-doc': { ...doc, id: 'template-drop-doc', name: 'Drop Template' } },
      materials: MATERIAL_PARAMS,
      procPresets: [{ id: 'crowns', label: 'Surface crowns', usesMaterial: true }],
      lightPresets: [{ id: 'torch', label: 'Torch' }],
    });

    const html = renderAssetBrowserPanel({
      query: '',
      view: 'grid',
      sort: 'name',
      collection: 'all',
      kindFilters: new Set(),
      originFilters: new Set(),
      records: db.query({ kinds: ['document', 'template', 'materialProfile', 'lightPreset', 'procPreset'] }),
      selectedId: null,
      selectedIds: new Set(),
      hiddenSelectedCount: 0,
      batchDeleteBlockedReason: undefined,
      stats: db.stats(),
      collapsedSections: {},
    });

    expect(html).toMatch(new RegExp(`data-asset-id="document:project:${doc.id}"[^>]+draggable="false"`));
    expect(html).toMatch(/data-asset-id="template:built-in:template-drop-doc"[^>]+draggable="false"/);
    for (const assetId of [
      'materialProfile:built-in:cell-2',
      'lightPreset:built-in:torch',
      'procPreset:built-in:crowns',
    ]) {
      expect(html).toMatch(new RegExp(`data-asset-id="${assetId}"[^>]+draggable="true"`));
    }

    const savedDoc = createEmptyDocument('saved-drop-doc', 'earthen');
    const savedDb = buildAssetDatabase({ documents: { [savedDoc.id]: savedDoc } });
    const savedRecord = savedDb.get(`document:project:${savedDoc.id}`)!;
    const detailHtml = renderAssetDetailPanel({ asset: savedRecord, deletePlan: savedDb.deletePlan(savedRecord.assetId) });
    expect(detailHtml).toMatch(/data-asset-action="open"[^>]*>Open<\/button>/);

    const templateRecord = db.get('template:built-in:template-drop-doc')!;
    const templateDetailHtml = renderAssetDetailPanel({ asset: templateRecord, deletePlan: db.deletePlan(templateRecord.assetId) });
    expect(templateRecord).toMatchObject({ kind: 'template', immutable: true, source: { storage: 'builtin' } });
    expect(templateDetailHtml).toMatch(/data-asset-action="open"[^>]*>Open<\/button>/);
    expect(templateDetailHtml).toMatch(/data-asset-action="duplicate"[^>]+disabled/);
  });
});

describe('localStorage asset store', () => {
  it('renames without changing stable ids', () => {
    const store = new LocalStorageAssetStore();
    const sprite = spriteAsset('sprite-stable', 'Old Name');
    expect(saveSprite(sprite)).toBe(true);
    const db = buildAssetDatabase({ sprites: loadSprites() });
    const record = db.get('sprite:library:sprite-stable')!;

    expect(store.rename(record, 'New Name')).toMatchObject({ ok: true });

    expect(loadSprites()).toMatchObject([{ id: 'sprite-stable', name: 'New Name' }]);
  });

  it('imports duplicates as reports and re-ids same-id different-content collisions', () => {
    const store = new LocalStorageAssetStore();
    const original = spriteAsset('sprite-collision', 'Torch', [255, 0, 0, 255]);
    expect(saveSprite(original)).toBe(true);

    const duplicate = store.importJson(
      { fileName: 'torch.sprite.json', text: JSON.stringify(original), acceptedAt: '2026-06-14T00:00:00.000Z' },
      buildAssetDatabase({ sprites: loadSprites() }),
    );
    expect(duplicate.report.decision).toBe('duplicate');
    expect(duplicate.report.importedAssetId).toBe('sprite:library:sprite-collision');
    expect(duplicate.report.duplicateOf).toBe('sprite:library:sprite-collision');

    const changed = spriteAsset('sprite-collision', 'Torch Blue', [0, 0, 255, 255]);
    const collision = store.importJson(
      { fileName: 'torch-blue.sprite.json', text: JSON.stringify(changed), acceptedAt: '2026-06-14T00:01:00.000Z' },
      buildAssetDatabase({ sprites: loadSprites(), importReports: store.listImportReports() }),
    );

    const sprites = loadSprites();
    expect(collision.ok).toBe(true);
    expect(collision.report.decision).toBe('collision-reid');
    expect(collision.report.importedAssetId).toMatch(/^sprite:library:/);
    expect(collision.report.collisionWith).toBe('sprite:library:sprite-collision');
    expect(sprites).toHaveLength(2);
    expect(sprites.some((sprite) => sprite.id === 'sprite-collision')).toBe(true);
    expect(sprites.some((sprite) => sprite.id !== 'sprite-collision' && sprite.name === 'Torch Blue')).toBe(true);
    expect(store.listImportReports().map((report) => report.decision).sort()).toEqual(['collision-reid', 'duplicate']);
  });

  it('canonicalizes imported source ids before collision checks', () => {
    const store = new LocalStorageAssetStore();
    expect(saveSprite(spriteAsset('sprite-canonical-id', 'Canonical', [255, 0, 0, 255]))).toBe(true);

    const imported = spriteAsset('sprite canonical id', 'Canonical Blue', [0, 0, 255, 255]);
    const preview = previewJsonImport(
      { fileName: 'canonical-blue.sprite.json', text: JSON.stringify(imported) },
      buildAssetDatabase({ sprites: loadSprites() }),
    );
    const result = store.importJson(
      { fileName: 'canonical-blue.sprite.json', text: JSON.stringify(imported), acceptedAt: '2026-06-14T00:01:00.000Z' },
      buildAssetDatabase({ sprites: loadSprites() }),
    );

    expect(preview).toMatchObject({
      ok: true,
      sourceId: 'sprite-canonical-id',
      collisionWith: 'sprite:library:sprite-canonical-id',
    });
    expect(result.ok).toBe(true);
    expect(result.report).toMatchObject({
      decision: 'collision-reid',
      originalSourceId: 'sprite-canonical-id',
      collisionWith: 'sprite:library:sprite-canonical-id',
    });
    expect(loadSprites().some((sprite) => sprite.id === 'sprite canonical id')).toBe(false);
    expect(loadSprites()).toHaveLength(2);
    expect(loadSprites().some((sprite) => sprite.id !== 'sprite-canonical-id' && sprite.name === 'Canonical Blue')).toBe(true);
  });

  it('stores invalid import reports and duplicates built-ins into the project library', () => {
    const store = new LocalStorageAssetStore();
    const invalid = store.importJson(
      { fileName: 'bad.json', text: '{nope', acceptedAt: '2026-06-14T00:00:00.000Z' },
      buildAssetDatabase(),
    );
    const builtinDb = buildAssetDatabase({ builtinPrefabs: [prefabAsset('builtin-copy', 'Copy Source')] });
    const duplicate = store.duplicate(builtinDb.get('prefab:built-in:builtin-copy')!);

    expect(invalid.ok).toBe(false);
    expect(store.listImportReports()[0]).toMatchObject({ decision: 'invalid', sourceFile: 'bad.json' });
    expect(duplicate.ok).toBe(true);
    expect(loadPrefabs()).toHaveLength(1);
    expect(loadPrefabs()[0].id).not.toBe('builtin-copy');
  });

  it('does not treat missing placeholders as import id collisions in preview', () => {
    const doc = createEmptyDocument('missing-import-doc', 'earthen');
    doc.objects.push({
      id: 'decor-1',
      kind: 'decor',
      x: 1,
      y: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      params: { spriteId: 'sprite-missing' },
    });
    const db = buildAssetDatabase({ currentDocument: doc });
    const sprite = spriteAsset('sprite-missing', 'Recovered Sprite');

    const preview = previewJsonImport(
      { fileName: 'recovered.sprite.json', text: JSON.stringify(sprite) },
      db,
    );

    expect(preview.ok).toBe(true);
    expect(preview.collisionWith).toBeUndefined();
    expect(preview.diff).toEqual(['New sprite sprite-missing']);
  });

  it('rolls back accepted imports when the durable import report cannot be saved', () => {
    const store = new LocalStorageAssetStore();
    (globalThis.localStorage as StorageStub).failSetItemForPrefix('noita-builder-import-report:');
    const sprite = spriteAsset('sprite-report-fail', 'Report Fail');

    const result = store.importJson(
      { fileName: 'report-fail.sprite.json', text: JSON.stringify(sprite), acceptedAt: '2026-06-14T00:00:00.000Z' },
      buildAssetDatabase(),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('rolled back');
    expect(loadSprites()).toHaveLength(0);
    expect(store.listImportReports()).toHaveLength(0);
  });

  it('previews reimport no-ops, changed content, kind mismatches, and source-id mismatches', () => {
    const store = new LocalStorageAssetStore();
    const original = spriteAsset('sprite-reimport', 'Original', [255, 0, 0, 255]);
    expect(saveSprite(original)).toBe(true);
    const record = buildAssetDatabase({ sprites: loadSprites() }).get('sprite:library:sprite-reimport')!;

    expect(previewReimport(record, { fileName: 'same.sprite.json', text: JSON.stringify(original) })).toMatchObject({
      ok: true,
      sameContent: true,
      changes: ['No content changes detected'],
    });
    expect(previewReimport(record, { fileName: 'changed.sprite.json', text: JSON.stringify(spriteAsset('sprite-reimport', 'Changed', [0, 0, 255, 255])) })).toMatchObject({
      ok: true,
      sameContent: false,
      kind: 'sprite',
      sourceId: 'sprite-reimport',
    });
    expect(previewReimport(record, { fileName: 'wrong-kind.prefab.json', text: JSON.stringify(prefabAsset('sprite-reimport', 'Wrong Kind')) })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining('Kind changes')]),
    });
    expect(previewReimport(record, { fileName: 'wrong-id.sprite.json', text: JSON.stringify(spriteAsset('sprite-other', 'Other')) })).toMatchObject({
      ok: false,
      errors: expect.arrayContaining([expect.stringContaining('Source id changes')]),
    });
    expect(store.listImportReports()).toHaveLength(0);
  });

  it('reimports local sprite content while preserving stable id and recording a replacement report', () => {
    const store = new LocalStorageAssetStore();
    const original = spriteAsset('sprite-replace', 'Original', [255, 0, 0, 255]);
    expect(saveSprite(original)).toBe(true);
    const record = buildAssetDatabase({ sprites: loadSprites() }).get('sprite:library:sprite-replace')!;
    const changed = spriteAsset('sprite-replace', 'Changed', [0, 0, 255, 255]);

    const result = store.reimportJson(
      record,
      { fileName: 'changed.sprite.json', text: JSON.stringify(changed), acceptedAt: '2026-06-14T00:02:00.000Z' },
    );

    expect(result.ok).toBe(true);
    expect(result.report).toMatchObject({
      decision: 'collision-replace',
      importedAssetId: 'sprite:library:sprite-replace',
      importedKind: 'sprite',
      originalSourceId: 'sprite-replace',
      finalSourceId: 'sprite-replace',
      collisionWith: 'sprite:library:sprite-replace',
    });
    expect(loadSprites()).toMatchObject([{ id: 'sprite-replace', name: 'Changed' }]);
    const db = buildAssetDatabase({ sprites: loadSprites(), importReports: store.listImportReports() });
    expect(db.get('sprite:library:sprite-replace')?.assetId).toBe('sprite:library:sprite-replace');
    expect(db.query({ collection: 'recent' }).map((asset) => asset.assetId)).toContain('sprite:library:sprite-replace');
  });

  it('imports batch export bundles through per-entry import reports', () => {
    const sourceStore = new LocalStorageAssetStore();
    const sourceSpriteA = spriteAsset('sprite-bundle-a', 'Bundle A', [10, 20, 30, 255]);
    const sourceSpriteB = spriteAsset('sprite-bundle-b', 'Bundle B', [40, 50, 60, 255]);
    expect(saveSprite(sourceSpriteA)).toBe(true);
    expect(saveSprite(sourceSpriteB)).toBe(true);
    const sourceDb = buildAssetDatabase({ sprites: loadSprites() });
    const exports = ['sprite:library:sprite-bundle-a', 'sprite:library:sprite-bundle-b'].map((assetId) => {
      const record = sourceDb.get(assetId)!;
      const exported = sourceStore.export(record)!;
      return {
        assetId: record.assetId,
        kind: record.kind,
        origin: record.origin,
        sourceId: record.sourceId,
        filename: exported.filename,
        mime: exported.mime,
        text: exported.text,
      };
    });
    (globalThis.localStorage as StorageStub).clear();
    const targetStore = new LocalStorageAssetStore();

    const result = targetStore.importJson(
      {
        fileName: 'bundle.assets.json',
        text: JSON.stringify({ v: 1, kind: 'assetExportBundle', exportedAt: '2026-06-14T00:20:00.000Z', assets: exports }),
        acceptedAt: '2026-06-14T00:20:00.000Z',
      },
      buildAssetDatabase(),
    );

    expect(result.ok).toBe(true);
    expect(result.report.diff[0]).toBe('Bundle entries: 2');
    expect(loadSprites().map((sprite) => sprite.id).sort()).toEqual(['sprite-bundle-a', 'sprite-bundle-b']);
    expect(targetStore.listImportReports().map((report) => report.sourceFile).sort()).toEqual([
      'Bundle A.sprite.json',
      'Bundle B.sprite.json',
      'bundle.assets.json',
    ]);
  });

  it('imports supported bundle entries while rejecting unsupported metadata entries', () => {
    const sourceStore = new LocalStorageAssetStore();
    const sourceSprite = spriteAsset('sprite-mixed-bundle', 'Mixed Bundle Sprite', [10, 20, 30, 255]);
    expect(saveSprite(sourceSprite)).toBe(true);
    const sourceDb = buildAssetDatabase({ sprites: loadSprites() });
    const spriteRecord = sourceDb.get('sprite:library:sprite-mixed-bundle')!;
    const exported = sourceStore.export(spriteRecord)!;
    (globalThis.localStorage as StorageStub).clear();
    const targetStore = new LocalStorageAssetStore();

    const result = targetStore.importJson(
      {
        fileName: 'mixed.assets.json',
        text: JSON.stringify({
          v: 1,
          kind: 'assetExportBundle',
          exportedAt: '2026-06-14T00:25:00.000Z',
          assets: [
            {
              assetId: spriteRecord.assetId,
              kind: spriteRecord.kind,
              origin: spriteRecord.origin,
              sourceId: spriteRecord.sourceId,
              filename: exported.filename,
              mime: exported.mime,
              text: exported.text,
            },
            {
              assetId: 'card:built-in:spark',
              kind: 'card',
              origin: 'built-in',
              sourceId: 'spark',
              filename: 'spark.card.content-metadata.json',
              mime: 'application/json',
              text: JSON.stringify({ metadataOnly: true, kind: 'card', id: 'spark' }),
            },
          ],
        }),
        acceptedAt: '2026-06-14T00:25:00.000Z',
      },
      buildAssetDatabase(),
    );

    const reports = targetStore.listImportReports();
    expect(result.ok).toBe(false);
    expect(result.report).toMatchObject({ sourceFile: 'mixed.assets.json', decision: 'rejected' });
    expect(loadSprites().map((sprite) => sprite.id)).toEqual(['sprite-mixed-bundle']);
    expect(reports.some((report) => report.sourceFile === 'Mixed Bundle Sprite.sprite.json' && report.decision === 'accepted')).toBe(true);
    expect(reports.some((report) => report.sourceFile === 'spark.card.content-metadata.json' && report.decision === 'invalid')).toBe(true);
  });

  it('bundle imports keep current document embedded sprite ids authoritative across entries', () => {
    const store = new LocalStorageAssetStore();
    const doc = createEmptyDocument('embedded-bundle-doc', 'earthen');
    doc.assets = { sprites: [spriteAsset('embedded-bundle-sprite', 'Embedded Bundle Sprite', [1, 2, 3, 255])] };
    const first = spriteAsset('bundle-first', 'Bundle First', [10, 20, 30, 255]);
    const colliding = spriteAsset('embedded-bundle-sprite', 'Colliding Library Sprite', [90, 100, 110, 255]);

    const result = store.importJson(
      {
        fileName: 'embedded-collision.assets.json',
        text: JSON.stringify({
          v: 1,
          kind: 'assetExportBundle',
          exportedAt: '2026-06-14T00:30:00.000Z',
          assets: [
            bundleEntry('sprite:library:bundle-first', first),
            bundleEntry('sprite:library:embedded-bundle-sprite', colliding),
          ],
        }),
        acceptedAt: '2026-06-14T00:30:00.000Z',
      },
      buildAssetDatabase({ currentDocument: doc }),
    );

    const sprites = loadSprites();
    const reports = store.listImportReports();
    expect(result.ok).toBe(true);
    expect(sprites.some((sprite) => sprite.id === 'bundle-first')).toBe(true);
    expect(sprites.some((sprite) => sprite.id === 'embedded-bundle-sprite')).toBe(false);
    expect(sprites.some((sprite) => sprite.id !== 'embedded-bundle-sprite' && sprite.name === 'Colliding Library Sprite')).toBe(true);
    expect(reports.some((report) =>
      report.sourceFile === 'Colliding Library Sprite.sprite.json' &&
      report.decision === 'collision-reid' &&
      report.collisionWith === `sprite:document-embedded:${doc.id}:embedded-bundle-sprite`
    )).toBe(true);
  });

  it('rejects invalid bundles during preflight before writing any entries', () => {
    const store = new LocalStorageAssetStore();
    const valid = spriteAsset('bundle-preflight-valid', 'Bundle Preflight Valid', [10, 20, 30, 255]);

    const result = store.importJson(
      {
        fileName: 'preflight.assets.json',
        text: JSON.stringify({
          v: 1,
          kind: 'assetExportBundle',
          exportedAt: '2026-06-14T00:30:00.000Z',
          assets: [
            bundleEntry('sprite:library:bundle-preflight-valid', valid),
            {
              assetId: 'sprite:library:bundle-preflight-bad',
              kind: 'sprite',
              origin: 'library',
              sourceId: 'bundle-preflight-bad',
              filename: 'bad.sprite.json',
              mime: 'application/json',
              text: '{bad',
            },
          ],
        }),
        acceptedAt: '2026-06-14T00:30:00.000Z',
      },
      buildAssetDatabase(),
    );

    expect(result.ok).toBe(false);
    expect(result.report).toMatchObject({
      decision: 'invalid',
      diff: ['Bundle rejected before writing any assets'],
    });
    expect(result.report.errors).toEqual(['bad.sprite.json: invalid JSON']);
    expect(loadSprites()).toHaveLength(0);
    expect(store.listImportReports()).toMatchObject([{ sourceFile: 'preflight.assets.json', decision: 'invalid' }]);
  });

  it('rolls back accepted bundle entries when the final bundle report cannot be saved', () => {
    const store = new LocalStorageAssetStore();
    (globalThis.localStorage as StorageStub).failSetItemForValueContaining('bundle-final-report-fail.assets.json');
    const sprite = spriteAsset('bundle-final-report-sprite', 'Bundle Final Report Sprite', [10, 20, 30, 255]);

    const result = store.importJson(
      {
        fileName: 'bundle-final-report-fail.assets.json',
        text: JSON.stringify({
          v: 1,
          kind: 'assetExportBundle',
          exportedAt: '2026-06-14T00:30:00.000Z',
          assets: [bundleEntry('sprite:library:bundle-final-report-sprite', sprite)],
        }),
        acceptedAt: '2026-06-14T00:30:00.000Z',
      },
      buildAssetDatabase(),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('bundle rollback removed 1 asset(s) and 1 report(s)');
    expect(loadSprites()).toHaveLength(0);
    expect(store.listImportReports()).toHaveLength(0);
  });

  it('rejects reimport mismatches without replacing existing local assets', () => {
    const store = new LocalStorageAssetStore();
    const original = spriteAsset('sprite-guarded', 'Original', [255, 0, 0, 255]);
    expect(saveSprite(original)).toBe(true);
    const record = buildAssetDatabase({ sprites: loadSprites() }).get('sprite:library:sprite-guarded')!;

    const wrongId = store.reimportJson(
      record,
      { fileName: 'wrong-id.sprite.json', text: JSON.stringify(spriteAsset('sprite-other', 'Other')), acceptedAt: '2026-06-14T00:03:00.000Z' },
    );
    const wrongKind = store.reimportJson(
      record,
      { fileName: 'wrong-kind.prefab.json', text: JSON.stringify(prefabAsset('sprite-guarded', 'Wrong Kind')), acceptedAt: '2026-06-14T00:04:00.000Z' },
    );

    expect(wrongId.ok).toBe(false);
    expect(wrongKind.ok).toBe(false);
    expect(loadSprites()).toMatchObject([{ id: 'sprite-guarded', name: 'Original' }]);
    expect(store.listImportReports().map((report) => report.decision)).toEqual(['rejected', 'rejected']);
  });

  it('restores previous content when a reimport replacement report cannot be saved', () => {
    const store = new LocalStorageAssetStore();
    const original = spriteAsset('sprite-rollback-reimport', 'Original', [255, 0, 0, 255]);
    expect(saveSprite(original)).toBe(true);
    const record = buildAssetDatabase({ sprites: loadSprites() }).get('sprite:library:sprite-rollback-reimport')!;
    (globalThis.localStorage as StorageStub).failSetItemForPrefix('noita-builder-import-report:');

    const result = store.reimportJson(
      record,
      { fileName: 'changed.sprite.json', text: JSON.stringify(spriteAsset('sprite-rollback-reimport', 'Changed', [0, 0, 255, 255])), acceptedAt: '2026-06-14T00:05:00.000Z' },
    );

    expect(result.ok).toBe(false);
    expect(result.message).toContain('previous asset restored');
    expect(loadSprites()).toMatchObject([{ id: 'sprite-rollback-reimport', name: 'Original' }]);
    expect(store.listImportReports()).toHaveLength(0);
  });

  it('refuses to delete document-owned asset records even when a local asset shares the source id', () => {
    const store = new LocalStorageAssetStore();
    const local = spriteAsset('shared-sprite', 'Library Sprite');
    const embedded = spriteAsset('shared-sprite', 'Embedded Sprite');
    expect(saveSprite(local)).toBe(true);
    const doc = createEmptyDocument('embedded-doc', 'earthen');
    doc.assets = { sprites: [embedded] };
    const record = buildAssetDatabase({ currentDocument: doc, sprites: loadSprites() }).get(`sprite:document-embedded:${doc.id}:shared-sprite`)!;

    const result = store.delete(record);

    expect(result.ok).toBe(false);
    expect(loadSprites()).toMatchObject([{ id: 'shared-sprite', name: 'Library Sprite' }]);
  });

  it('refuses to delete local assets that are still referenced', () => {
    const store = new LocalStorageAssetStore();
    const sprite = spriteAsset('used-sprite', 'Used Sprite');
    expect(saveSprite(sprite)).toBe(true);
    const doc = createEmptyDocument('using-doc', 'earthen');
    doc.objects.push({
      id: 'decor-1',
      kind: 'decor',
      x: 1,
      y: 1,
      rotation: 0,
      locked: false,
      hidden: false,
      params: { spriteId: sprite.id },
    });
    const record = buildAssetDatabase({ currentDocument: doc, sprites: loadSprites() }).get('sprite:library:used-sprite')!;

    const result = store.delete(record);

    expect(record.usages).toHaveLength(1);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('reference(s) still exist');
    expect(loadSprites()).toMatchObject([{ id: 'used-sprite', name: 'Used Sprite' }]);
  });

  it('defaults Recent queries to newest modified assets first', () => {
    const store = new LocalStorageAssetStore();
    const older = spriteAsset('sprite-recent-old', 'A Recent Older', [255, 0, 0, 255]);
    const newer = spriteAsset('sprite-recent-new', 'Z Recent Newer', [0, 0, 255, 255]);

    expect(store.importJson(
      { fileName: 'older.sprite.json', text: JSON.stringify(older), acceptedAt: '2026-06-14T00:00:00.000Z' },
      buildAssetDatabase(),
    ).ok).toBe(true);
    expect(store.importJson(
      { fileName: 'newer.sprite.json', text: JSON.stringify(newer), acceptedAt: '2026-06-14T00:10:00.000Z' },
      buildAssetDatabase({ sprites: loadSprites(), importReports: store.listImportReports() }),
    ).ok).toBe(true);

    const db = buildAssetDatabase({ sprites: loadSprites(), importReports: store.listImportReports() });

    const recentSprites = db.query({ collection: 'recent' }).filter((record) => record.kind === 'sprite');
    const namedRecentSprites = db.query({ collection: 'recent', sort: 'name' }).filter((record) => record.kind === 'sprite');

    expect(recentSprites.map((record) => record.assetId).slice(0, 2)).toEqual([
      'sprite:library:sprite-recent-new',
      'sprite:library:sprite-recent-old',
    ]);
    expect(namedRecentSprites.map((record) => record.assetId).slice(0, 2)).toEqual([
      'sprite:library:sprite-recent-old',
      'sprite:library:sprite-recent-new',
    ]);
  });
});

function spriteAsset(id: string, name: string, rgba = [255, 128, 0, 255]): SpriteAsset {
  return {
    v: 1,
    kind: 'sprite',
    id,
    name,
    w: 1,
    h: 1,
    frames: [{ durationMs: 100, px: encodeFramePx(new Uint8ClampedArray(rgba)) }],
    tags: [],
    emissive: false,
  };
}

function prefabAsset(id: string, name: string, spriteId?: string): PrefabDef {
  return {
    v: 1,
    kind: 'prefab',
    id,
    name,
    tags: ['test'],
    w: 2,
    h: 2,
    rle: rleEncode(new Uint8Array([0, 0, 0, 0])),
    objects: spriteId
      ? [
          {
            id: 'p0',
            kind: 'decor',
            x: 0,
            y: 0,
            rotation: 0,
            locked: false,
            hidden: false,
            params: { spriteId },
          },
        ]
      : [],
    links: [],
    lights: [],
  };
}

function bundleEntry(assetId: string, sprite: SpriteAsset): {
  assetId: string;
  kind: 'sprite';
  origin: 'library';
  sourceId: string;
  filename: string;
  mime: string;
  text: string;
} {
  return {
    assetId,
    kind: 'sprite',
    origin: 'library',
    sourceId: sprite.id,
    filename: `${sprite.name}.sprite.json`,
    mime: 'application/json',
    text: JSON.stringify(sprite),
  };
}
