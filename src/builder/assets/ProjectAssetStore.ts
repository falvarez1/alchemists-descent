import type {
  AssetImportReport,
  AssetKind,
  AssetOrigin,
  AssetRecord,
  AssetSourceMetadata,
} from '@/builder/assets/AssetTypes';
import { ASSET_KINDS, ASSET_ORIGINS, stableAssetId } from '@/builder/assets/AssetTypes';
import type { AssetQuotaSummary, AssetStoreExport, AssetStoreResult, AssetImportInput } from '@/builder/assets/AssetStore';

export type ProjectAssetPersistenceBackend = 'memory' | 'indexedDB' | 'fileSystem';

export interface ProjectAssetPersistenceMetadata {
  backend: ProjectAssetPersistenceBackend;
  key?: string;
  path?: string;
}

export interface ProjectAssetEntry {
  v: 1;
  kind: 'projectAssetEntry';
  assetId: string;
  assetKind: AssetKind;
  origin: AssetOrigin;
  sourceId: string;
  source: AssetSourceMetadata;
  persistence: ProjectAssetPersistenceMetadata;
  name: string;
  filename: string;
  mime: string;
  text: string;
  sizeBytes: number;
  contentSignature: string;
  updatedAt: string;
}

export interface ProjectAssetRecoveryReport {
  scannedAssets: number;
  scannedReports: number;
  corrupt: Array<{ key: string; reason: string }>;
}

export interface ProjectAssetStore {
  available(): boolean;
  listAssets(): Promise<ProjectAssetEntry[]>;
  getAsset(assetId: string): Promise<ProjectAssetEntry | null>;
  putAsset(entry: ProjectAssetEntry): Promise<AssetStoreResult>;
  deleteAsset(assetId: string): Promise<AssetStoreResult>;
  listImportReports(): Promise<AssetImportReport[]>;
  putImportReport(report: AssetImportReport): Promise<AssetStoreResult>;
  deleteImportReport(id: string): Promise<AssetStoreResult>;
  quota(): Promise<AssetQuotaSummary>;
  recover(): Promise<ProjectAssetRecoveryReport>;
}

export function projectAssetEntryFromExport(
  record: AssetRecord,
  exported: AssetStoreExport,
  updatedAt = new Date().toISOString(),
): ProjectAssetEntry | null {
  if (!canPersistProjectAssetRecord(record)) return null;
  if (typeof exported.text !== 'string' || !exported.filename.trim() || !exported.mime.trim()) return null;
  return {
    v: 1,
    kind: 'projectAssetEntry',
    assetId: record.assetId,
    assetKind: record.kind,
    origin: record.origin,
    sourceId: record.sourceId,
    source: clone(record.source),
    persistence: { backend: 'memory' },
    name: record.name,
    filename: exported.filename,
    mime: exported.mime,
    text: exported.text,
    sizeBytes: byteLength(exported.text),
    contentSignature: record.contentSignature,
    updatedAt,
  };
}

export function importInputFromProjectAssetEntry(entry: ProjectAssetEntry): AssetImportInput {
  return { fileName: entry.filename, text: entry.text, acceptedAt: entry.updatedAt };
}

export function sanitizeProjectAssetEntry(value: unknown): ProjectAssetEntry | null {
  const entry = value as Partial<ProjectAssetEntry>;
  if (!entry || typeof entry !== 'object' || entry.v !== 1 || entry.kind !== 'projectAssetEntry') return null;
  if (!nonBlank(entry.assetId) ||
    !nonBlank(entry.assetKind) ||
    !nonBlank(entry.origin) ||
    !nonBlank(entry.sourceId) ||
    !nonBlank(entry.name) ||
    !nonBlank(entry.filename) ||
    !nonBlank(entry.mime) ||
    typeof entry.text !== 'string' ||
    !nonBlank(entry.contentSignature) ||
    !nonBlank(entry.updatedAt)) {
    return null;
  }
  if (!isAssetKind(entry.assetKind) || !isAssetOrigin(entry.origin)) return null;
  if (!validTimestamp(entry.updatedAt)) return null;
  const source = sanitizeSourceMetadata(entry.source);
  const persistence = sanitizePersistenceMetadata(entry.persistence);
  if (!source || !persistence) return null;
  if (!canPersistProjectAssetEntry(entry.assetKind, entry.origin, source.storage)) return null;
  if (entry.assetId !== stableAssetId(entry.assetKind, entry.origin, entry.sourceId)) return null;
  const expectedSize = byteLength(entry.text);
  if (entry.sizeBytes !== undefined && (!Number.isFinite(entry.sizeBytes) || entry.sizeBytes !== expectedSize)) return null;
  return {
    v: 1,
    kind: 'projectAssetEntry',
    assetId: entry.assetId,
    assetKind: entry.assetKind,
    origin: entry.origin,
    sourceId: entry.sourceId,
    source,
    persistence,
    name: entry.name,
    filename: entry.filename,
    mime: entry.mime,
    text: entry.text,
    sizeBytes: expectedSize,
    contentSignature: entry.contentSignature,
    updatedAt: entry.updatedAt,
  };
}

function canPersistProjectAssetRecord(record: AssetRecord): boolean {
  return record.portable &&
    !record.immutable &&
    canPersistProjectAssetEntry(record.kind, record.origin, record.source.storage) &&
    record.assetId === stableAssetId(record.kind, record.origin, record.sourceId);
}

function canPersistProjectAssetEntry(
  kind: AssetKind,
  origin: AssetOrigin,
  sourceStorage: AssetSourceMetadata['storage'],
): boolean {
  if (kind === 'importReport') return false;
  if (origin !== 'project' && origin !== 'library') return false;
  return sourceStorage === 'localStorage' || sourceStorage === 'indexedDB' || sourceStorage === 'fileSystem';
}

export class MemoryProjectAssetStore implements ProjectAssetStore {
  private readonly assets = new Map<string, ProjectAssetEntry>();
  private readonly reports = new Map<string, AssetImportReport>();

  constructor(input: { assets?: readonly ProjectAssetEntry[]; reports?: readonly AssetImportReport[] } = {}) {
    for (const asset of input.assets ?? []) {
      const clean = sanitizeProjectAssetEntry(asset);
      if (clean) this.assets.set(clean.assetId, stampPersistence(clean, { backend: 'memory' }));
    }
    for (const report of input.reports ?? []) this.reports.set(report.id, clone(report));
  }

  available(): boolean {
    return true;
  }

  async listAssets(): Promise<ProjectAssetEntry[]> {
    return sortedEntries([...this.assets.values()].map(clone));
  }

  async getAsset(assetId: string): Promise<ProjectAssetEntry | null> {
    const asset = this.assets.get(assetId);
    return asset ? clone(asset) : null;
  }

  async putAsset(entry: ProjectAssetEntry): Promise<AssetStoreResult> {
    const clean = sanitizeProjectAssetEntry(entry);
    if (!clean) return { ok: false, message: 'Project asset entry is invalid' };
    this.assets.set(clean.assetId, stampPersistence(clean, { backend: 'memory' }));
    return { ok: true, message: `Saved project asset ${clean.name}` };
  }

  async deleteAsset(assetId: string): Promise<AssetStoreResult> {
    const existed = this.assets.delete(assetId);
    return existed
      ? { ok: true, message: `Deleted project asset ${assetId}` }
      : { ok: false, message: `Project asset ${assetId} is not stored` };
  }

  async listImportReports(): Promise<AssetImportReport[]> {
    return sortedReports([...this.reports.values()].map(clone));
  }

  async putImportReport(report: AssetImportReport): Promise<AssetStoreResult> {
    if (!isImportReport(report)) return { ok: false, message: 'Import report is invalid' };
    this.reports.set(report.id, clone(report));
    return { ok: true, message: `Saved import report ${report.name}` };
  }

  async deleteImportReport(id: string): Promise<AssetStoreResult> {
    const existed = this.reports.delete(id);
    return existed
      ? { ok: true, message: `Deleted import report ${id}` }
      : { ok: false, message: `Import report ${id} is not stored` };
  }

  async quota(): Promise<AssetQuotaSummary> {
    return {
      available: true,
      usedBytes: usedBytes([...this.assets.values()], [...this.reports.values()]),
      itemCount: this.assets.size + this.reports.size,
    };
  }

  async recover(): Promise<ProjectAssetRecoveryReport> {
    return {
      scannedAssets: this.assets.size,
      scannedReports: this.reports.size,
      corrupt: [],
    };
  }
}

export class IndexedDbAssetStore implements ProjectAssetStore {
  private static readonly version = 1;
  private static readonly assetsStore = 'assets';
  private static readonly reportsStore = 'reports';

  constructor(
    private readonly dbName = 'noita-builder-project-assets',
    private readonly resolveIndexedDb: () => IDBFactory | null = indexedDbOrNull,
  ) {}

  available(): boolean {
    return this.resolveIndexedDb() !== null;
  }

  async listAssets(): Promise<ProjectAssetEntry[]> {
    try {
      const values = await this.getAll(IndexedDbAssetStore.assetsStore);
      return sortedEntries(values.map(sanitizeProjectAssetEntry).filter((entry): entry is ProjectAssetEntry => entry !== null));
    } catch {
      return [];
    }
  }

  async getAsset(assetId: string): Promise<ProjectAssetEntry | null> {
    try {
      const value = await this.request(IndexedDbAssetStore.assetsStore, 'readonly', (store) => store.get(assetId));
      return sanitizeProjectAssetEntry(value);
    } catch {
      return null;
    }
  }

  async putAsset(entry: ProjectAssetEntry): Promise<AssetStoreResult> {
    const clean = sanitizeProjectAssetEntry(entry);
    if (!clean) return { ok: false, message: 'Project asset entry is invalid' };
    try {
      await this.request(IndexedDbAssetStore.assetsStore, 'readwrite', (store) =>
        store.put(stampPersistence(clean, { backend: 'indexedDB', key: clean.assetId })),
      );
      return { ok: true, message: `Saved project asset ${clean.name}` };
    } catch {
      return { ok: false, message: 'IndexedDB asset storage unavailable' };
    }
  }

  async deleteAsset(assetId: string): Promise<AssetStoreResult> {
    if (!(await this.getAsset(assetId))) return { ok: false, message: `Project asset ${assetId} is not stored` };
    try {
      await this.request(IndexedDbAssetStore.assetsStore, 'readwrite', (store) => store.delete(assetId));
      return { ok: true, message: `Deleted project asset ${assetId}` };
    } catch {
      return { ok: false, message: 'IndexedDB asset delete failed' };
    }
  }

  async listImportReports(): Promise<AssetImportReport[]> {
    try {
      const values = await this.getAll(IndexedDbAssetStore.reportsStore);
      return sortedReports(values.filter(isImportReport));
    } catch {
      return [];
    }
  }

  async putImportReport(report: AssetImportReport): Promise<AssetStoreResult> {
    if (!isImportReport(report)) return { ok: false, message: 'Import report is invalid' };
    try {
      await this.request(IndexedDbAssetStore.reportsStore, 'readwrite', (store) => store.put(report));
      return { ok: true, message: `Saved import report ${report.name}` };
    } catch {
      return { ok: false, message: 'IndexedDB import report storage unavailable' };
    }
  }

  async deleteImportReport(id: string): Promise<AssetStoreResult> {
    const existing = (await this.listImportReports()).some((report) => report.id === id);
    if (!existing) return { ok: false, message: `Import report ${id} is not stored` };
    try {
      await this.request(IndexedDbAssetStore.reportsStore, 'readwrite', (store) => store.delete(id));
      return { ok: true, message: `Deleted import report ${id}` };
    } catch {
      return { ok: false, message: 'IndexedDB import report delete failed' };
    }
  }

  async quota(): Promise<AssetQuotaSummary> {
    if (!this.available()) return { available: false, usedBytes: 0, itemCount: 0 };
    try {
      const [assets, reports] = await Promise.all([this.getAll(IndexedDbAssetStore.assetsStore), this.getAll(IndexedDbAssetStore.reportsStore)]);
      const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate
        ? await navigator.storage.estimate()
        : undefined;
      return {
        available: true,
        usedBytes: usedBytes(assets, reports),
        itemCount: assets.length + reports.length,
        estimate,
      };
    } catch {
      return { available: false, usedBytes: 0, itemCount: 0 };
    }
  }

  async recover(): Promise<ProjectAssetRecoveryReport> {
    const report: ProjectAssetRecoveryReport = { scannedAssets: 0, scannedReports: 0, corrupt: [] };
    if (!this.available()) return report;
    let assets: unknown[];
    let reports: unknown[];
    try {
      [assets, reports] = await Promise.all([this.getAll(IndexedDbAssetStore.assetsStore), this.getAll(IndexedDbAssetStore.reportsStore)]);
    } catch {
      report.corrupt.push({ key: '*', reason: 'IndexedDB unavailable' });
      return report;
    }
    for (const value of assets) {
      const key = assetKey(value);
      report.scannedAssets++;
      if (!sanitizeProjectAssetEntry(value)) report.corrupt.push({ key, reason: 'failed project asset sanitization' });
    }
    for (const value of reports) {
      const key = importReportKey(value);
      report.scannedReports++;
      if (!isImportReport(value)) report.corrupt.push({ key, reason: 'failed import report sanitization' });
    }
    return report;
  }

  private async getAll(storeName: string): Promise<unknown[]> {
    return this.request(storeName, 'readonly', (store) => store.getAll());
  }

  private async request<T>(
    storeName: string,
    mode: IDBTransactionMode,
    createRequest: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      let result: T | undefined;
      let requestError: DOMException | null = null;
      let tx: IDBTransaction;
      let request: IDBRequest<T>;
      try {
        tx = db.transaction(storeName, mode);
        request = createRequest(tx.objectStore(storeName));
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      request.onsuccess = () => {
        result = request.result;
      };
      request.onerror = () => {
        requestError = request.error;
      };
      tx.oncomplete = () => {
        db.close();
        resolve(result as T);
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error ?? requestError ?? new Error(`IndexedDB transaction failed: ${storeName}`));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error ?? requestError ?? new Error(`IndexedDB transaction aborted: ${storeName}`));
      };
    });
  }

  private async open(): Promise<IDBDatabase> {
    const indexedDb = this.resolveIndexedDb();
    if (!indexedDb) throw new Error('IndexedDB unavailable');
    return new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDb.open(this.dbName, IndexedDbAssetStore.version);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(IndexedDbAssetStore.assetsStore)) {
          db.createObjectStore(IndexedDbAssetStore.assetsStore, { keyPath: 'assetId' });
        }
        if (!db.objectStoreNames.contains(IndexedDbAssetStore.reportsStore)) {
          db.createObjectStore(IndexedDbAssetStore.reportsStore, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB open failed'));
      request.onblocked = () => reject(new Error('IndexedDB upgrade blocked'));
    });
  }
}

export interface FileSystemDirectoryHandleLike {
  kind?: 'directory';
  name?: string;
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandleLike>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>;
  entries?: () => AsyncIterableIterator<[string, FileSystemDirectoryHandleLike | FileSystemFileHandleLike]>;
}

export interface FileSystemFileHandleLike {
  kind?: 'file';
  name?: string;
  getFile(): Promise<{ text(): Promise<string> }>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

export class FileSystemAccessAssetStore implements ProjectAssetStore {
  private static readonly rootDir = '.noita-builder';
  private static readonly assetsDir = 'assets';
  private static readonly reportsDir = 'import-reports';
  private static readonly assetSuffix = '.asset.json';
  private static readonly reportSuffix = '.import-report.json';

  constructor(private readonly root: FileSystemDirectoryHandleLike | null) {}

  available(): boolean {
    return this.root !== null;
  }

  async listAssets(): Promise<ProjectAssetEntry[]> {
    const values = await this.readAllAssets();
    return sortedEntries(values.map(sanitizeProjectAssetEntry).filter((entry): entry is ProjectAssetEntry => entry !== null));
  }

  async getAsset(assetId: string): Promise<ProjectAssetEntry | null> {
    return (await this.listAssets()).find((asset) => asset.assetId === assetId) ?? null;
  }

  async putAsset(entry: ProjectAssetEntry): Promise<AssetStoreResult> {
    const clean = sanitizeProjectAssetEntry(entry);
    if (!clean) return { ok: false, message: 'Project asset entry is invalid' };
    try {
      const path = projectAssetPath(clean);
      await this.writeJson(path, stampPersistence(clean, { backend: 'fileSystem', path: path.join('/') }));
      return { ok: true, message: `Saved project asset ${clean.name}` };
    } catch {
      return { ok: false, message: 'Project folder asset write failed' };
    }
  }

  async deleteAsset(assetId: string): Promise<AssetStoreResult> {
    try {
      const entry = await this.getAsset(assetId);
      if (!entry) return { ok: false, message: `Project asset ${assetId} is not stored` };
      await this.remove(projectAssetPath(entry));
      return { ok: true, message: `Deleted project asset ${assetId}` };
    } catch {
      return { ok: false, message: 'Project folder asset delete failed' };
    }
  }

  async listImportReports(): Promise<AssetImportReport[]> {
    const values = await this.readAllReports();
    return sortedReports(values.filter(isImportReport));
  }

  async putImportReport(report: AssetImportReport): Promise<AssetStoreResult> {
    if (!isImportReport(report)) return { ok: false, message: 'Import report is invalid' };
    try {
      await this.writeJson(projectReportPath(report.id), report);
      return { ok: true, message: `Saved import report ${report.name}` };
    } catch {
      return { ok: false, message: 'Project folder import report write failed' };
    }
  }

  async deleteImportReport(id: string): Promise<AssetStoreResult> {
    try {
      const existing = (await this.listImportReports()).some((report) => report.id === id);
      if (!existing) return { ok: false, message: `Import report ${id} is not stored` };
      await this.remove(projectReportPath(id));
      return { ok: true, message: `Deleted import report ${id}` };
    } catch {
      return { ok: false, message: 'Project folder import report delete failed' };
    }
  }

  async quota(): Promise<AssetQuotaSummary> {
    if (!this.root) return { available: false, usedBytes: 0, itemCount: 0 };
    try {
      const [assets, reports] = await Promise.all([this.readAllAssets(), this.readAllReports()]);
      return {
        available: true,
        usedBytes: usedBytes(assets, reports),
        itemCount: assets.length + reports.length,
      };
    } catch {
      return { available: false, usedBytes: 0, itemCount: 0 };
    }
  }

  async recover(): Promise<ProjectAssetRecoveryReport> {
    const report: ProjectAssetRecoveryReport = { scannedAssets: 0, scannedReports: 0, corrupt: [] };
    if (!this.root) return report;
    try {
      await this.recoverAssets(report);
      await this.recoverReports(report);
    } catch {
      report.corrupt.push({ key: '*', reason: 'project folder unavailable' });
    }
    return report;
  }

  private async recoverAssets(report: ProjectAssetRecoveryReport): Promise<void> {
    const assetsDir = await this.directory([FileSystemAccessAssetStore.rootDir, FileSystemAccessAssetStore.assetsDir], false);
    if (!assetsDir?.entries) return;
    for await (const [kindName, kindHandle] of assetsDir.entries()) {
      if (kindHandle.kind !== 'directory' || !isAssetKind(kindName) || !kindHandle.entries) continue;
      for await (const [fileName, handle] of kindHandle.entries()) {
        if (handle.kind === 'directory' || !fileName.endsWith(FileSystemAccessAssetStore.assetSuffix)) continue;
        const path = [FileSystemAccessAssetStore.rootDir, FileSystemAccessAssetStore.assetsDir, kindName, fileName];
        report.scannedAssets++;
        try {
          const text = await (handle as FileSystemFileHandleLike).getFile().then((file) => file.text());
          if (!sanitizeProjectAssetEntryAtPath(JSON.parse(text), path, kindName)) {
            report.corrupt.push({ key: path.join('/'), reason: 'failed sanitization or path mismatch' });
          }
        } catch {
          report.corrupt.push({ key: path.join('/'), reason: 'invalid JSON' });
        }
      }
    }
  }

  private async recoverReports(report: ProjectAssetRecoveryReport): Promise<void> {
    const dir = await this.directory([FileSystemAccessAssetStore.rootDir, FileSystemAccessAssetStore.reportsDir], false);
    if (!dir?.entries) return;
    for await (const [fileName, handle] of dir.entries()) {
      if (handle.kind === 'directory' || !fileName.endsWith(FileSystemAccessAssetStore.reportSuffix)) continue;
      report.scannedReports++;
      try {
        const text = await (handle as FileSystemFileHandleLike).getFile().then((file) => file.text());
        if (!isImportReport(JSON.parse(text))) report.corrupt.push({ key: `${FileSystemAccessAssetStore.rootDir}/${FileSystemAccessAssetStore.reportsDir}/${fileName}`, reason: 'failed sanitization' });
      } catch {
        report.corrupt.push({ key: `${FileSystemAccessAssetStore.rootDir}/${FileSystemAccessAssetStore.reportsDir}/${fileName}`, reason: 'invalid JSON' });
      }
    }
  }

  private async readAllAssets(): Promise<ProjectAssetEntry[]> {
    const assetsDir = await this.directory([FileSystemAccessAssetStore.rootDir, FileSystemAccessAssetStore.assetsDir], false);
    if (!assetsDir?.entries) return [];
    const values: ProjectAssetEntry[] = [];
    for await (const [kindName, kindHandle] of assetsDir.entries()) {
      if (kindHandle.kind !== 'directory' || !isAssetKind(kindName) || !kindHandle.entries) continue;
      for await (const [fileName, handle] of kindHandle.entries()) {
        if (handle.kind === 'directory' || !fileName.endsWith(FileSystemAccessAssetStore.assetSuffix)) continue;
        const path = [FileSystemAccessAssetStore.rootDir, FileSystemAccessAssetStore.assetsDir, kindName, fileName];
        try {
          const text = await (handle as FileSystemFileHandleLike).getFile().then((file) => file.text());
          const entry = sanitizeProjectAssetEntryAtPath(JSON.parse(text), path, kindName);
          if (entry) values.push(entry);
        } catch {
          // recover() reports corrupt files; list operations stay fail-open.
        }
      }
    }
    return values;
  }

  private async readAllReports(): Promise<unknown[]> {
    const dir = await this.directory([FileSystemAccessAssetStore.rootDir, FileSystemAccessAssetStore.reportsDir], false);
    if (!dir?.entries) return [];
    const values: unknown[] = [];
    for await (const [fileName, handle] of dir.entries()) {
      if (handle.kind === 'directory' || !fileName.endsWith(FileSystemAccessAssetStore.reportSuffix)) continue;
      try {
        const text = await (handle as FileSystemFileHandleLike).getFile().then((file) => file.text());
        values.push(JSON.parse(text));
      } catch {
        // recover() reports corrupt files; list operations stay fail-open.
      }
    }
    return values;
  }

  private async writeJson(path: readonly string[], value: unknown): Promise<void> {
    const fileName = path.at(-1);
    if (!fileName) throw new Error('Project file path unavailable');
    const dir = await this.directory(path.slice(0, -1), true);
    if (!dir) throw new Error('Project directory unavailable');
    const handle = await dir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    try {
      await writable.write(`${JSON.stringify(value, null, 2)}\n`);
    } finally {
      await writable.close();
    }
  }

  private async remove(path: readonly string[]): Promise<void> {
    const fileName = path.at(-1);
    if (!fileName) throw new Error('Project file path unavailable');
    const dir = await this.directory(path.slice(0, -1), false);
    if (!dir) throw new Error('Project directory unavailable');
    await dir.removeEntry(fileName);
  }

  private async directory(path: readonly string[], create: boolean): Promise<FileSystemDirectoryHandleLike | null> {
    if (!this.root) return null;
    let dir = this.root;
    try {
      for (const segment of path) dir = await dir.getDirectoryHandle(segment, { create });
      return dir;
    } catch (error) {
      if (!create && isNotFoundError(error)) return null;
      throw error;
    }
  }
}

export interface ProjectAssetDirectoryRequestResult {
  ok: boolean;
  handle: FileSystemDirectoryHandleLike | null;
  reason?: 'unsupported' | 'cancelled' | 'denied' | 'error';
  message: string;
}

export async function requestProjectAssetDirectory(
  pickerHost: { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandleLike> } =
    globalThis as unknown as { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandleLike> },
): Promise<FileSystemDirectoryHandleLike | null> {
  const result = await requestProjectAssetDirectoryResult(pickerHost);
  return result.handle;
}

export async function requestProjectAssetDirectoryResult(
  pickerHost: { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandleLike> } =
    globalThis as unknown as { showDirectoryPicker?: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandleLike> },
): Promise<ProjectAssetDirectoryRequestResult> {
  if (!pickerHost.showDirectoryPicker) {
    return { ok: false, handle: null, reason: 'unsupported', message: 'File System Access API is not supported' };
  }
  try {
    return { ok: true, handle: await pickerHost.showDirectoryPicker({ mode: 'readwrite' }), message: 'Project folder selected' };
  } catch (error) {
    const name = typeof error === 'object' && error !== null ? (error as { name?: unknown }).name : undefined;
    if (name === 'AbortError') return { ok: false, handle: null, reason: 'cancelled', message: 'Project folder selection cancelled' };
    if (name === 'NotAllowedError' || name === 'SecurityError') return { ok: false, handle: null, reason: 'denied', message: 'Project folder permission denied' };
    return { ok: false, handle: null, reason: 'error', message: 'Project folder selection failed' };
  }
}

function isAssetKind(value: string): value is AssetKind {
  return ASSET_KINDS.includes(value as AssetKind);
}

function isAssetOrigin(value: string): value is AssetOrigin {
  return ASSET_ORIGINS.includes(value as AssetOrigin);
}

function sanitizeSourceMetadata(value: unknown): AssetSourceMetadata | null {
  const source = value as Partial<AssetSourceMetadata>;
  if (!source || typeof source !== 'object' || typeof source.storage !== 'string') return null;
  if (!isAssetSourceStorage(source.storage)) return null;
  return {
    storage: source.storage,
    key: typeof source.key === 'string' ? source.key : undefined,
    documentId: typeof source.documentId === 'string' ? source.documentId : undefined,
    fileName: typeof source.fileName === 'string' ? source.fileName : undefined,
    importedAt: typeof source.importedAt === 'string' ? source.importedAt : undefined,
    reimportToken: typeof source.reimportToken === 'string' ? source.reimportToken : undefined,
  };
}

function sanitizePersistenceMetadata(value: unknown): ProjectAssetPersistenceMetadata | null {
  const persistence = value as Partial<ProjectAssetPersistenceMetadata>;
  if (!persistence || typeof persistence !== 'object' || typeof persistence.backend !== 'string') return null;
  if (persistence.backend !== 'memory' && persistence.backend !== 'indexedDB' && persistence.backend !== 'fileSystem') return null;
  return {
    backend: persistence.backend,
    key: typeof persistence.key === 'string' ? persistence.key : undefined,
    path: typeof persistence.path === 'string' ? persistence.path : undefined,
  };
}

function isAssetSourceStorage(value: string): value is AssetSourceMetadata['storage'] {
  return value === 'builtin' ||
    value === 'localStorage' ||
    value === 'indexedDB' ||
    value === 'fileSystem' ||
    value === 'document' ||
    value === 'generated' ||
    value === 'import-report' ||
    value === 'content-registry';
}

function sanitizeProjectAssetEntryAtPath(value: unknown, path: readonly string[], folderKind: AssetKind): ProjectAssetEntry | null {
  const entry = sanitizeProjectAssetEntry(value);
  if (!entry || entry.assetKind !== folderKind) return null;
  const expected = projectAssetPath(entry);
  if (path.join('/') !== expected.join('/')) return null;
  return stampPersistence(entry, { backend: 'fileSystem', path: path.join('/') });
}

function isImportReport(value: unknown): value is AssetImportReport {
  const report = value as Partial<AssetImportReport>;
  return !!report &&
    typeof report === 'object' &&
    report.v === 1 &&
    report.kind === 'importReport' &&
    nonBlank(report.id) &&
    nonBlank(report.name) &&
    nonBlank(report.sourceFile) &&
    nonBlank(report.importedAt) &&
    validTimestamp(report.importedAt) &&
    isImportDecision(report.decision) &&
    (report.importedAssetId === undefined || nonBlank(report.importedAssetId)) &&
    (report.importedKind === undefined || isAssetKind(report.importedKind)) &&
    (report.originalSourceId === undefined || nonBlank(report.originalSourceId)) &&
    (report.finalSourceId === undefined || nonBlank(report.finalSourceId)) &&
    (report.duplicateOf === undefined || nonBlank(report.duplicateOf)) &&
    (report.collisionWith === undefined || nonBlank(report.collisionWith)) &&
    Array.isArray(report.warnings) &&
    report.warnings.every((warning) => typeof warning === 'string') &&
    Array.isArray(report.errors) &&
    report.errors.every((error) => typeof error === 'string') &&
    Array.isArray(report.diff) &&
    report.diff.every((line) => typeof line === 'string') &&
    typeof report.sizeBytes === 'number' &&
    Number.isInteger(report.sizeBytes) &&
    report.sizeBytes >= 0 &&
    nonBlank(report.contentSignature);
}

function isImportDecision(value: unknown): value is AssetImportReport['decision'] {
  return value === 'accepted' ||
    value === 'rejected' ||
    value === 'duplicate' ||
    value === 'collision-reid' ||
    value === 'collision-replace' ||
    value === 'invalid';
}

function sortedEntries(entries: ProjectAssetEntry[]): ProjectAssetEntry[] {
  return entries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.assetId.localeCompare(b.assetId));
}

function sortedReports(reports: AssetImportReport[]): AssetImportReport[] {
  return reports.sort((a, b) => b.importedAt.localeCompare(a.importedAt) || a.id.localeCompare(b.id));
}

function stampPersistence(entry: ProjectAssetEntry, persistence: ProjectAssetPersistenceMetadata): ProjectAssetEntry {
  return { ...clone(entry), persistence };
}

function usedBytes(assets: readonly unknown[], reports: readonly unknown[]): number {
  let total = 0;
  for (const value of [...assets, ...reports]) total += byteLength(JSON.stringify(value));
  return total;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function indexedDbOrNull(): IDBFactory | null {
  try {
    return typeof indexedDB === 'undefined' ? null : indexedDB;
  } catch {
    return null;
  }
}

function projectAssetPath(entry: ProjectAssetEntry): string[] {
  return [
    FileSystemAccessAssetStore['rootDir'],
    FileSystemAccessAssetStore['assetsDir'],
    entry.assetKind,
    `${safeProjectFileToken(entry.sourceId)}.${safeProjectFileToken(entry.filename).replace(/\.json$/i, '')}.asset.json`,
  ];
}

function projectReportPath(id: string): string[] {
  return [
    FileSystemAccessAssetStore['rootDir'],
    FileSystemAccessAssetStore['reportsDir'],
    `${safeProjectFileToken(id)}.import-report.json`,
  ];
}

function assetKey(value: unknown): string {
  const candidate = value as { assetId?: unknown };
  return typeof candidate?.assetId === 'string' ? candidate.assetId : '<unknown asset>';
}

function importReportKey(value: unknown): string {
  const candidate = value as { id?: unknown };
  return typeof candidate?.id === 'string' ? candidate.id : '<unknown import report>';
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function validTimestamp(value: string): boolean {
  return Number.isFinite(Date.parse(value));
}

function safeProjectFileToken(value: string): string {
  const base = value.split(/[\\/]/).at(-1) ?? value;
  return encodeURIComponent(base.trim().replace(/\s+/g, '-').replace(/^\.+/, '') || 'asset')
    .replace(/%/g, '_')
    .replace(/_2E/gi, '.');
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === 'object' &&
    error !== null &&
    ((error as { name?: unknown }).name === 'NotFoundError' || (error as { code?: unknown }).code === 8);
}
