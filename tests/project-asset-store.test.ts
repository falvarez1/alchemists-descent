import { describe, expect, it } from 'vitest';
import { createEmptyDocument } from '@/builder/document';
import { buildAssetDatabase } from '@/builder/assets/AssetDatabase';
import { LocalStorageAssetStore } from '@/builder/assets/AssetStore';
import {
  FileSystemAccessAssetStore,
  IndexedDbAssetStore,
  MemoryProjectAssetStore,
  importInputFromProjectAssetEntry,
  projectAssetEntryFromExport,
} from '@/builder/assets/ProjectAssetStore';
import type {
  FileSystemDirectoryHandleLike,
  FileSystemFileHandleLike,
  ProjectAssetEntry,
} from '@/builder/assets/ProjectAssetStore';
import type { AssetImportReport } from '@/builder/assets/AssetTypes';

describe('project asset store', () => {
  it('converts existing Asset Database exports into async project-store entries', () => {
    const doc = createEmptyDocument('project-store-doc', 'earthen');
    const database = buildAssetDatabase({ documents: { [doc.id]: doc } });
    const record = database.get(`document:project:${doc.id}`)!;
    const exported = new LocalStorageAssetStore().export(record)!;

    const entry = projectAssetEntryFromExport(record, exported, '2026-06-14T10:00:00.000Z');

    expect(entry).toMatchObject({
      v: 1,
      kind: 'projectAssetEntry',
      assetId: `document:project:${doc.id}`,
      assetKind: 'document',
      origin: 'project',
      source: { storage: 'localStorage' },
      persistence: { backend: 'memory' },
      sourceId: doc.id,
      filename: 'project-store-doc.builder.json',
      mime: 'application/json',
      updatedAt: '2026-06-14T10:00:00.000Z',
    });
    expect(importInputFromProjectAssetEntry(entry!)).toEqual({
      fileName: 'project-store-doc.builder.json',
      text: exported.text,
      acceptedAt: '2026-06-14T10:00:00.000Z',
    });
  });

  it('rejects document-owned, immutable, and malformed records as project-store entries', async () => {
    const doc = createEmptyDocument('current-doc', 'earthen');
    const currentDb = buildAssetDatabase({ currentDocument: doc });
    const currentRecord = currentDb.get(`document:project:${doc.id}`)!;
    const exported = new LocalStorageAssetStore().export(currentRecord)!;

    expect(projectAssetEntryFromExport(currentRecord, exported)).toBeNull();

    const templateDb = buildAssetDatabase({ templates: { stock: { ...doc, id: 'stock', name: 'Stock Template' } } });
    const templateRecord = templateDb.get('template:built-in:stock')!;
    expect(projectAssetEntryFromExport(templateRecord, new LocalStorageAssetStore().export(templateRecord)!)).toBeNull();

    const store = new MemoryProjectAssetStore();
    const malformed = { ...assetEntry('sprite:library:good', 'Good', '2026-06-14T10:10:00.000Z'), assetId: 'sprite:library:wrong' };
    await expect(store.putAsset(malformed)).resolves.toMatchObject({ ok: false });
  });

  it('keeps memory backend operations async, sorted, cloned, and quota-aware', async () => {
    const newer = assetEntry('sprite:library:newer', 'Newer', '2026-06-14T10:05:00.000Z');
    const older = assetEntry('sprite:library:older', 'Older', '2026-06-14T10:00:00.000Z');
    const report = importReport('import-a', '2026-06-14T10:04:00.000Z');
    const store = new MemoryProjectAssetStore({ assets: [older], reports: [report] });

    expect(await store.putAsset(newer)).toMatchObject({ ok: true });
    expect((await store.listAssets()).map((entry) => entry.assetId)).toEqual([
      'sprite:library:newer',
      'sprite:library:older',
    ]);

    const listed = await store.listAssets();
    listed[0].name = 'Mutated outside store';
    expect(await store.getAsset('sprite:library:newer')).toMatchObject({ name: 'Newer' });

    expect(await store.listImportReports()).toMatchObject([{ id: 'import-a' }]);
    expect(await store.quota()).toMatchObject({ available: true, itemCount: 3 });
    expect(await store.recover()).toEqual({ scannedAssets: 2, scannedReports: 1, corrupt: [] });
    expect(await store.deleteAsset('sprite:library:older')).toMatchObject({ ok: true });
    expect(await store.deleteImportReport('import-a')).toMatchObject({ ok: true });
  });

  it('persists project assets and import reports through a File System Access directory shape', async () => {
    const root = new FakeDirectoryHandle('root');
    const store = new FileSystemAccessAssetStore(root);
    const entry = assetEntry('prefab:library:room', 'Room', '2026-06-14T11:00:00.000Z');
    const report = importReport('import-room', '2026-06-14T11:01:00.000Z');

    expect(store.available()).toBe(true);
    expect(await store.putAsset(entry)).toMatchObject({ ok: true });
    expect(await store.putImportReport(report)).toMatchObject({ ok: true });
    expect(await store.getAsset(entry.assetId)).toMatchObject({ assetId: entry.assetId, name: 'Room' });
    expect((await store.listAssets()).map((asset) => asset.assetId)).toEqual(['prefab:library:room']);
    expect((await store.listImportReports()).map((item) => item.id)).toEqual(['import-room']);
    expect(await store.quota()).toMatchObject({ available: true, itemCount: 2 });

    root.directory('.noita-builder').directory('assets').directory('prefab').writeRaw('broken.asset.json', '{not-json');
    const recovery = await store.recover();
    expect(recovery.scannedAssets).toBe(2);
    expect(recovery.scannedReports).toBe(1);
    expect(recovery.corrupt).toEqual([{ key: '.noita-builder/assets/prefab/broken.asset.json', reason: 'invalid JSON' }]);

    expect(await store.deleteAsset(entry.assetId)).toMatchObject({ ok: true });
    expect(await store.deleteImportReport(report.id)).toMatchObject({ ok: true });
    expect(await store.listAssets()).toEqual([]);
    expect(await store.listImportReports()).toEqual([]);
  });

  it('does not trust serialized File System Access delete paths', async () => {
    const root = new FakeDirectoryHandle('root');
    const store = new FileSystemAccessAssetStore(root);
    const entry = assetEntry('prefab:library:room', 'Room', '2026-06-14T11:30:00.000Z');

    expect(await store.putAsset(entry)).toMatchObject({ ok: true });
    root.writeRaw('outside.txt', 'keep me');
    root
      .directory('.noita-builder')
      .directory('assets')
      .directory('prefab')
      .writeRaw('room.Room.asset.json', JSON.stringify({
        ...entry,
        persistence: { backend: 'fileSystem', path: 'outside.txt' },
      }));

    expect(await store.deleteAsset(entry.assetId)).toMatchObject({ ok: true });
    expect(root.readRaw('outside.txt')).toBe('keep me');
    expect(root.directory('.noita-builder').directory('assets').directory('prefab').readRaw('room.Room.asset.json')).toBeNull();
  });

  it('quarantines misplaced File System Access assets and malformed import reports', async () => {
    const root = new FakeDirectoryHandle('root');
    const store = new FileSystemAccessAssetStore(root);
    const misplaced = assetEntry('sprite:library:misplaced', 'Misplaced', '2026-06-14T11:40:00.000Z');
    root
      .directory('.noita-builder')
      .directory('assets')
      .directory('prefab')
      .writeRaw('misplaced.Misplaced.asset.json', JSON.stringify(misplaced));
    root
      .directory('.noita-builder')
      .directory('import-reports')
      .writeRaw('bad.import-report.json', JSON.stringify({
        ...importReport('bad', 'not-a-date'),
        decision: 'accepted-but-not-really',
      }));

    expect(await store.listAssets()).toEqual([]);
    expect(await store.listImportReports()).toEqual([]);
    expect(await store.recover()).toEqual({
      scannedAssets: 1,
      scannedReports: 1,
      corrupt: [
        { key: '.noita-builder/assets/prefab/misplaced.Misplaced.asset.json', reason: 'failed sanitization or path mismatch' },
        { key: '.noita-builder/import-reports/bad.import-report.json', reason: 'failed sanitization' },
      ],
    });
  });

  it('round trips project assets and import reports through IndexedDB schema', async () => {
    const factory = new FakeIndexedDbFactory();
    const store = new IndexedDbAssetStore('project-assets-test', () => factory as unknown as IDBFactory);
    const entry = assetEntry('sprite:library:indexed', 'Indexed', '2026-06-14T12:00:00.000Z');
    const report = importReport('import-indexed', '2026-06-14T12:01:00.000Z');

    expect(store.available()).toBe(true);
    expect(await store.putAsset(entry)).toMatchObject({ ok: true });
    expect(await store.putImportReport(report)).toMatchObject({ ok: true });

    const reopened = new IndexedDbAssetStore('project-assets-test', () => factory as unknown as IDBFactory);
    expect(await reopened.getAsset(entry.assetId)).toMatchObject({
      assetId: entry.assetId,
      name: 'Indexed',
      source: { storage: 'localStorage' },
      persistence: { backend: 'indexedDB', key: entry.assetId },
    });
    expect((await reopened.listAssets()).map((asset) => asset.assetId)).toEqual(['sprite:library:indexed']);
    expect((await reopened.listImportReports()).map((item) => item.id)).toEqual(['import-indexed']);

    factory.seed('project-assets-test', 'assets', 'bad', { v: 1, kind: 'projectAssetEntry', assetId: 'bad' });
    expect(await reopened.quota()).toMatchObject({ available: true, itemCount: 3 });
    const recovery = await reopened.recover();
    expect(recovery.scannedAssets).toBe(2);
    expect(recovery.scannedReports).toBe(1);
    expect(recovery.corrupt).toEqual([{ key: 'bad', reason: 'failed project asset sanitization' }]);

    expect(await reopened.deleteAsset(entry.assetId)).toMatchObject({ ok: true });
    expect(await reopened.deleteAsset(entry.assetId)).toMatchObject({ ok: false });
    expect(await reopened.deleteImportReport(report.id)).toMatchObject({ ok: true });
    expect(await reopened.deleteImportReport(report.id)).toMatchObject({ ok: false });
  });

  it('keeps IndexedDB unavailable state explicit for non-browser test environments', async () => {
    const store = new IndexedDbAssetStore('test-assets', () => null);

    expect(store.available()).toBe(false);
    expect(await store.quota()).toEqual({ available: false, usedBytes: 0, itemCount: 0 });
    expect(await store.recover()).toEqual({ scannedAssets: 0, scannedReports: 0, corrupt: [] });
  });
});

function assetEntry(assetId: string, name: string, updatedAt: string): ProjectAssetEntry {
  const text = JSON.stringify({ name });
  return {
    v: 1,
    kind: 'projectAssetEntry',
    assetId,
    assetKind: assetId.startsWith('prefab:') ? 'prefab' : 'sprite',
    origin: 'library',
    sourceId: assetId.split(':').at(-1) ?? assetId,
    source: { storage: 'localStorage' },
    persistence: { backend: 'memory' },
    name,
    filename: `${name}.json`,
    mime: 'application/json',
    text,
    sizeBytes: new TextEncoder().encode(text).length,
    contentSignature: `${assetId}:sig`,
    updatedAt,
  };
}

function importReport(id: string, importedAt: string): AssetImportReport {
  return {
    v: 1,
    kind: 'importReport',
    id,
    name: `Import ${id}`,
    sourceFile: `${id}.json`,
    importedAt,
    decision: 'accepted',
    importedAssetId: 'prefab:library:room',
    importedKind: 'prefab',
    warnings: [],
    errors: [],
    diff: ['Accepted prefab room'],
    sizeBytes: 10,
    contentSignature: `${id}:sig`,
  };
}

class FakeDirectoryHandle implements FileSystemDirectoryHandleLike {
  readonly kind = 'directory';
  private readonly directories = new Map<string, FakeDirectoryHandle>();
  private readonly files = new Map<string, FakeFileHandle>();

  constructor(readonly name: string) {}

  async getDirectoryHandle(name: string, options: { create?: boolean } = {}): Promise<FileSystemDirectoryHandleLike> {
    const existing = this.directories.get(name);
    if (existing) return existing;
    if (!options.create) throw new Error(`Missing directory ${name}`);
    const dir = new FakeDirectoryHandle(name);
    this.directories.set(name, dir);
    return dir;
  }

  async getFileHandle(name: string, options: { create?: boolean } = {}): Promise<FileSystemFileHandleLike> {
    const existing = this.files.get(name);
    if (existing) return existing;
    if (!options.create) throw new Error(`Missing file ${name}`);
    const file = new FakeFileHandle(name, '');
    this.files.set(name, file);
    return file;
  }

  async removeEntry(name: string): Promise<void> {
    if (this.files.delete(name) || this.directories.delete(name)) return;
    throw new Error(`Missing entry ${name}`);
  }

  async *entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandleLike | FileSystemFileHandleLike]> {
    for (const entry of this.directories) yield entry;
    for (const entry of this.files) yield entry;
  }

  directory(name: string): FakeDirectoryHandle {
    let dir = this.directories.get(name);
    if (!dir) {
      dir = new FakeDirectoryHandle(name);
      this.directories.set(name, dir);
    }
    return dir;
  }

  writeRaw(name: string, text: string): void {
    this.files.set(name, new FakeFileHandle(name, text));
  }

  readRaw(name: string): string | null {
    return this.files.get(name)?.readRaw() ?? null;
  }
}

class FakeFileHandle implements FileSystemFileHandleLike {
  readonly kind = 'file';

  constructor(readonly name: string, private text: string) {}

  async getFile(): Promise<{ text(): Promise<string> }> {
    return { text: async () => this.text };
  }

  async createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }> {
    return {
      write: async (data: string): Promise<void> => {
        this.text = data;
      },
      close: async (): Promise<void> => {},
    };
  }

  readRaw(): string {
    return this.text;
  }
}

class FakeIndexedDbFactory {
  private readonly databases = new Map<string, FakeIndexedDbDatabaseState>();

  open(name: string): FakeOpenRequest {
    let state = this.databases.get(name);
    const fresh = !state;
    if (!state) {
      state = new FakeIndexedDbDatabaseState();
      this.databases.set(name, state);
    }
    return new FakeOpenRequest(new FakeIndexedDbDatabase(state), fresh);
  }

  seed(dbName: string, storeName: string, key: string, value: unknown): void {
    let state = this.databases.get(dbName);
    if (!state) {
      state = new FakeIndexedDbDatabaseState();
      this.databases.set(dbName, state);
    }
    state.store(storeName).set(key, value);
  }
}

class FakeIndexedDbDatabaseState {
  readonly stores = new Map<string, Map<string, unknown>>();

  store(name: string): Map<string, unknown> {
    let store = this.stores.get(name);
    if (!store) {
      store = new Map<string, unknown>();
      this.stores.set(name, store);
    }
    return store;
  }
}

class FakeOpenRequest {
  result: FakeIndexedDbDatabase;
  error: DOMException | null = null;
  onupgradeneeded: (() => void) | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onblocked: (() => void) | null = null;

  constructor(db: FakeIndexedDbDatabase, fresh: boolean) {
    this.result = db;
    setTimeout(() => {
      if (fresh) this.onupgradeneeded?.();
      this.onsuccess?.();
    }, 0);
  }
}

class FakeIndexedDbDatabase {
  readonly objectStoreNames: { contains(name: string): boolean };

  constructor(private readonly state: FakeIndexedDbDatabaseState) {
    this.objectStoreNames = { contains: (name: string) => this.state.stores.has(name) };
  }

  createObjectStore(name: string): void {
    this.state.store(name);
  }

  transaction(storeName: string): FakeTransaction {
    return new FakeTransaction(this.state.store(storeName));
  }

  close(): void {}
}

class FakeTransaction {
  error: DOMException | null = null;
  oncomplete: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private completed = false;

  constructor(private readonly data: Map<string, unknown>) {}

  objectStore(): FakeObjectStore {
    return new FakeObjectStore(this.data, () => this.complete());
  }

  private complete(): void {
    if (this.completed) return;
    this.completed = true;
    setTimeout(() => this.oncomplete?.(), 0);
  }
}

class FakeObjectStore {
  constructor(
    private readonly data: Map<string, unknown>,
    private readonly complete: () => void,
  ) {}

  get(key: string): FakeRequest<unknown> {
    return this.respond(this.data.get(key));
  }

  getAll(): FakeRequest<unknown[]> {
    return this.respond([...this.data.values()]);
  }

  put(value: unknown): FakeRequest<unknown> {
    const key = indexedDbKey(value);
    if (key) this.data.set(key, JSON.parse(JSON.stringify(value)));
    return this.respond(key);
  }

  delete(key: string): FakeRequest<undefined> {
    this.data.delete(key);
    return this.respond(undefined);
  }

  private respond<T>(value: T): FakeRequest<T> {
    const request = new FakeRequest<T>(value);
    setTimeout(() => {
      request.onsuccess?.();
      this.complete();
    }, 0);
    return request;
  }
}

class FakeRequest<T> {
  result: T;
  error: DOMException | null = null;
  onsuccess: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(result: T) {
    this.result = result;
  }
}

function indexedDbKey(value: unknown): string | null {
  const candidate = value as { assetId?: unknown; id?: unknown };
  if (typeof candidate.assetId === 'string') return candidate.assetId;
  if (typeof candidate.id === 'string') return candidate.id;
  return null;
}
