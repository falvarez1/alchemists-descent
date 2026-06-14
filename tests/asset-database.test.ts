import { beforeEach, describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/builder/document';
import { rleEncode } from '@/core/rle';
import { buildAssetDatabase } from '@/builder/assets/AssetDatabase';
import { previewJsonImport } from '@/builder/assets/AssetImportPipeline';
import { LocalStorageAssetStore } from '@/builder/assets/AssetStore';
import type { PrefabDef } from '@/builder/prefablib';
import { loadPrefabs, savePrefab } from '@/builder/prefablib';
import { loadSprites, saveSprite } from '@/builder/assets/spritelib';
import { encodeFramePx } from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';
import { renderAssetDetailPanel } from '@/builder/assetDetailPanel';

class StorageStub implements Storage {
  private readonly data = new Map<string, string>();
  private readonly failingSetPrefixes = new Set<string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
    this.failingSetPrefixes.clear();
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
    this.data.set(key, value);
  }

  failSetItemForPrefix(prefix: string): void {
    this.failingSetPrefixes.add(prefix);
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
    expect(db.get('sprite:document-embedded:embedded-torch')?.usages).toMatchObject([
      { assetId: `document:project:${doc.id}`, label: 'saved-doc' },
    ]);
    expect(db.query({ collection: 'missing' }).map((record) => record.assetId)).not.toContain('sprite:missing:embedded-torch');
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
