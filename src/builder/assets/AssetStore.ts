import { freshId, saveDocToLibrary, sanitizeImportedDoc } from '@/builder/document';
import type { EditorDocument } from '@/builder/document';
import { deletePrefab, savePrefab, sanitizePrefab } from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';
import { deleteSprite, saveSprite } from '@/builder/assets/spritelib';
import { freshSpriteId, sanitizeSpriteAsset } from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';
import {
  prefabContentSignature,
  spriteAssetContentSignature,
  stableContentSignature,
} from '@/builder/assets/AssetPreview';
import type { AssetDatabase } from '@/builder/assets/AssetDatabase';
import { stableAssetId } from '@/builder/assets/AssetTypes';
import type { AssetImportReport, AssetKind, AssetOrigin, AssetRecord } from '@/builder/assets/AssetTypes';

export interface AssetStoreResult {
  ok: boolean;
  message: string;
}

export interface AssetStoreExport {
  filename: string;
  mime: string;
  text: string;
}

export interface AssetQuotaSummary {
  available: boolean;
  usedBytes: number;
  itemCount: number;
  estimate?: StorageEstimate;
}

export interface AssetImportInput {
  fileName: string;
  text: string;
  acceptedAt?: string;
}

export interface AssetImportResult extends AssetStoreResult {
  report: AssetImportReport;
  importedKind?: AssetKind;
  importedSourceId?: string;
}

export interface AssetRecoveryReport {
  scanned: number;
  corrupt: Array<{ key: string; reason: string }>;
}

export interface AssetStore {
  listImportReports(): AssetImportReport[];
  put(record: AssetRecord): AssetStoreResult;
  delete(record: AssetRecord): AssetStoreResult;
  rename(record: AssetRecord, name: string): AssetStoreResult;
  duplicate(record: AssetRecord): AssetStoreResult;
  export(record: AssetRecord): AssetStoreExport | null;
  importJson(input: AssetImportInput, database: AssetDatabase): AssetImportResult;
  quota(): Promise<AssetQuotaSummary>;
  recover(): AssetRecoveryReport;
}

const DOC_PREFIX = 'noita-builder-doc:';
const PREFAB_PREFIX = 'noita-builder-prefab:';
const SPRITE_PREFIX = 'noita-builder-sprite:';
const REPORT_PREFIX = 'noita-builder-import-report:';

export class LocalStorageAssetStore implements AssetStore {
  constructor(private readonly resolveStorage: () => Storage | null = storageOrNull) {}

  listImportReports(): AssetImportReport[] {
    const store = this.resolveStorage();
    const reports: AssetImportReport[] = [];
    if (!store) return reports;
    try {
      for (let n = 0; n < store.length; n++) {
        const key = store.key(n);
        if (!key?.startsWith(REPORT_PREFIX)) continue;
        try {
          const report = sanitizeImportReport(JSON.parse(store.getItem(key) ?? 'null'));
          if (report) reports.push(report);
        } catch {
          // one corrupt report must not take the browser down
        }
      }
    } catch {
      return reports;
    }
    reports.sort((a, b) => b.importedAt.localeCompare(a.importedAt) || a.id.localeCompare(b.id));
    return reports;
  }

  put(record: AssetRecord): AssetStoreResult {
    if (record.immutable) return { ok: false, message: 'Built-in assets are immutable' };
    if (record.kind === 'document' && isDocument(record.payload)) {
      return saveDocToLibrary(record.payload)
        ? { ok: true, message: `Saved document ${record.name}` }
        : { ok: false, message: 'Document storage full or unavailable' };
    }
    if (record.kind === 'prefab' && isPrefab(record.payload)) {
      return savePrefab(record.payload)
        ? { ok: true, message: `Saved prefab ${record.name}` }
        : { ok: false, message: 'Prefab storage full or unavailable' };
    }
    if (record.kind === 'sprite' && isSprite(record.payload)) {
      return saveSprite(record.payload)
        ? { ok: true, message: `Saved sprite ${record.name}` }
        : { ok: false, message: 'Sprite storage full or unavailable' };
    }
    if (record.kind === 'importReport' && isImportReport(record.payload)) {
      return this.saveReport(record.payload);
    }
    return { ok: false, message: `${record.kind} assets are read-only in this store` };
  }

  delete(record: AssetRecord): AssetStoreResult {
    if (record.immutable) return { ok: false, message: 'Built-in assets are immutable' };
    const store = this.resolveStorage();
    if (!store) return { ok: false, message: 'Storage unavailable' };
    try {
      if (record.kind === 'document') store.removeItem(DOC_PREFIX + record.sourceId);
      else if (record.kind === 'prefab') deletePrefab(record.sourceId);
      else if (record.kind === 'sprite') deleteSprite(record.sourceId);
      else if (record.kind === 'importReport') store.removeItem(REPORT_PREFIX + record.sourceId);
      else return { ok: false, message: `${record.kind} assets are read-only in this store` };
      return { ok: true, message: `Deleted ${record.name}` };
    } catch {
      return { ok: false, message: `Could not delete ${record.name}` };
    }
  }

  rename(record: AssetRecord, name: string): AssetStoreResult {
    const clean = name.trim();
    if (!clean) return { ok: false, message: 'Name cannot be blank' };
    if (record.immutable) return { ok: false, message: 'Built-in assets are immutable; duplicate first' };
    if (record.kind === 'document' && isDocument(record.payload)) {
      return saveDocToLibrary({ ...record.payload, name: clean })
        ? { ok: true, message: `Renamed document to ${clean}` }
        : { ok: false, message: 'Document storage full or unavailable' };
    }
    if (record.kind === 'prefab' && isPrefab(record.payload)) {
      return savePrefab({ ...record.payload, name: clean })
        ? { ok: true, message: `Renamed prefab to ${clean}` }
        : { ok: false, message: 'Prefab storage full or unavailable' };
    }
    if (record.kind === 'sprite' && isSprite(record.payload)) {
      return saveSprite({ ...record.payload, name: clean })
        ? { ok: true, message: `Renamed sprite to ${clean}` }
        : { ok: false, message: 'Sprite storage full or unavailable' };
    }
    if (record.kind === 'importReport' && isImportReport(record.payload)) {
      return this.saveReport({ ...record.payload, name: clean });
    }
    return { ok: false, message: `${record.kind} assets cannot be renamed yet` };
  }

  duplicate(record: AssetRecord): AssetStoreResult {
    if (record.kind === 'document' && isDocument(record.payload)) {
      const copy: EditorDocument = { ...structuredClone(record.payload), id: freshId('doc'), name: `${record.name} copy` };
      return saveDocToLibrary(copy)
        ? { ok: true, message: `Duplicated document ${record.name}` }
        : { ok: false, message: 'Document storage full or unavailable' };
    }
    if (record.kind === 'prefab' && isPrefab(record.payload)) {
      const copy: PrefabDef = { ...structuredClone(record.payload), id: freshId('prefab'), name: `${record.name} copy`, createdAt: new Date().toISOString() };
      return savePrefab(copy)
        ? { ok: true, message: `Duplicated prefab ${record.name}` }
        : { ok: false, message: 'Prefab storage full or unavailable' };
    }
    if (record.kind === 'sprite' && isSprite(record.payload)) {
      const copy: SpriteAsset = { ...structuredClone(record.payload), id: freshSpriteId(), name: `${record.name} copy` };
      return saveSprite(copy)
        ? { ok: true, message: `Duplicated sprite ${record.name}` }
        : { ok: false, message: 'Sprite storage full or unavailable' };
    }
    return { ok: false, message: `${record.kind} assets cannot be duplicated yet` };
  }

  export(record: AssetRecord): AssetStoreExport | null {
    if (record.kind === 'document' && isDocument(record.payload)) {
      return jsonExport(`${record.name || 'level'}.builder.json`, record.payload);
    }
    if (record.kind === 'prefab' && isPrefab(record.payload)) {
      return jsonExport(`${record.name || 'prefab'}.prefab.json`, record.payload);
    }
    if (record.kind === 'sprite' && isSprite(record.payload)) {
      return jsonExport(`${record.name || 'sprite'}.sprite.json`, record.payload);
    }
    if (record.kind === 'importReport' && isImportReport(record.payload)) {
      return jsonExport(`${record.name || 'import-report'}.import-report.json`, record.payload);
    }
    if (record.origin === 'built-in') {
      return jsonExport(`${record.name || record.sourceId}.asset.json`, {
        kind: record.kind,
        sourceId: record.sourceId,
        name: record.name,
        tags: record.tags,
        payload: record.payload,
      });
    }
    return null;
  }

  importJson(input: AssetImportInput, database: AssetDatabase): AssetImportResult {
    const importedAt = input.acceptedAt ?? new Date().toISOString();
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.text);
    } catch {
      const report = makeReport(input, importedAt, 'invalid', 'unknown', null, ['Invalid JSON'], [], []);
      const reportSave = this.saveReport(report);
      return { ok: false, message: reportSave.ok ? 'Import failed: invalid JSON' : `Import failed: invalid JSON; ${reportSave.message}`, report };
    }

    const parsedAsset = parseImportPayload(parsed);
    if (!parsedAsset) {
      const report = makeReport(input, importedAt, 'invalid', 'unknown', null, ['Unsupported asset JSON'], [], []);
      const reportSave = this.saveReport(report);
      return {
        ok: false,
        message: reportSave.ok ? 'Import failed: unsupported asset JSON' : `Import failed: unsupported asset JSON; ${reportSave.message}`,
        report,
      };
    }

    const existingSameContent = database
      .list()
      .find((record) => record.kind === parsedAsset.kind && record.contentSignature === parsedAsset.contentSignature);
    if (existingSameContent) {
      const report = makeReport(input, importedAt, 'duplicate', parsedAsset.kind, existingSameContent.assetId, [], [], [
        `Duplicate of ${existingSameContent.assetId}`,
      ], existingSameContent.assetId);
      const reportSave = this.saveReport(report);
      return {
        ok: reportSave.ok,
        message: reportSave.ok
          ? `Duplicate ${parsedAsset.kind} skipped`
          : `Duplicate ${parsedAsset.kind} skipped, but ${reportSave.message}`,
        report,
        importedKind: parsedAsset.kind,
        importedSourceId: existingSameContent.sourceId,
      };
    }

    const existingSameId = database
      .list()
      .find((record) => record.kind === parsedAsset.kind && record.sourceId === parsedAsset.sourceId && record.origin !== 'missing');
    const asset = existingSameId ? reIdImportedAsset(parsedAsset) : parsedAsset;
    const decision = existingSameId ? 'collision-reid' : 'accepted';
    const save = saveImportedAsset(asset);
    const warnings = [...parsedAsset.warnings];
    const diff = existingSameId
      ? [`ID collision with ${existingSameId.assetId}; imported copy re-id ${parsedAsset.sourceId} -> ${asset.sourceId}`]
      : [`Accepted ${asset.kind} ${asset.sourceId}`];
    const report = makeReport(
      input,
      importedAt,
      save.ok ? decision : 'rejected',
      asset.kind,
      save.ok ? stableImportedAssetId(asset.kind, asset.sourceId) : null,
      save.ok ? [] : [save.message],
      warnings,
      diff,
      undefined,
      parsedAsset.sourceId,
      asset.sourceId,
      existingSameId?.assetId,
      asset.contentSignature,
    );
    const reportSave = this.saveReport(report);
    if (!reportSave.ok) {
      if (save.ok) {
        const rollback = this.rollbackImportedAsset(asset);
        return {
          ok: false,
          message: rollback.ok
            ? `Import failed: ${reportSave.message}; imported asset rolled back`
            : `Import failed: ${reportSave.message}; rollback also failed: ${rollback.message}`,
          report,
          importedKind: asset.kind,
          importedSourceId: asset.sourceId,
        };
      }
      return {
        ok: false,
        message: `${save.message}; ${reportSave.message}`,
        report,
        importedKind: asset.kind,
        importedSourceId: asset.sourceId,
      };
    }
    return {
      ok: save.ok,
      message: save.ok ? `Imported ${asset.kind} ${asset.name}` : save.message,
      report,
      importedKind: asset.kind,
      importedSourceId: asset.sourceId,
    };
  }

  async quota(): Promise<AssetQuotaSummary> {
    const store = this.resolveStorage();
    if (!store) return { available: false, usedBytes: 0, itemCount: 0 };
    let usedBytes = 0;
    try {
      for (let n = 0; n < store.length; n++) {
        const key = store.key(n) ?? '';
        usedBytes += key.length + (store.getItem(key)?.length ?? 0);
      }
    } catch {
      return { available: false, usedBytes: 0, itemCount: 0 };
    }
    const estimate = typeof navigator !== 'undefined' && navigator.storage?.estimate
      ? await navigator.storage.estimate()
      : undefined;
    return { available: true, usedBytes, itemCount: store.length, estimate };
  }

  recover(): AssetRecoveryReport {
    const store = this.resolveStorage();
    const report: AssetRecoveryReport = { scanned: 0, corrupt: [] };
    if (!store) return report;
    const checks: Array<{ prefix: string; validate: (value: unknown) => boolean }> = [
      { prefix: DOC_PREFIX, validate: (value) => sanitizeImportedDoc(value) !== null },
      { prefix: PREFAB_PREFIX, validate: (value) => sanitizePrefab(value) !== null },
      { prefix: SPRITE_PREFIX, validate: (value) => sanitizeSpriteAsset(value) !== null },
      { prefix: REPORT_PREFIX, validate: (value) => sanitizeImportReport(value) !== null },
    ];
    try {
      for (let n = 0; n < store.length; n++) {
        const key = store.key(n);
        if (!key) continue;
        const check = checks.find((candidate) => key.startsWith(candidate.prefix));
        if (!check) continue;
        report.scanned++;
        try {
          const raw = store.getItem(key);
          if (!check.validate(raw ? JSON.parse(raw) : null)) report.corrupt.push({ key, reason: 'failed sanitization' });
        } catch {
          report.corrupt.push({ key, reason: 'invalid JSON' });
        }
      }
    } catch {
      report.corrupt.push({ key: '*', reason: 'storage enumeration failed' });
    }
    return report;
  }

  private rollbackImportedAsset(asset: ParsedImportAsset): AssetStoreResult {
    try {
      if (asset.kind === 'document') {
        const store = this.resolveStorage();
        if (!store) return { ok: false, message: 'Storage unavailable' };
        store.removeItem(DOC_PREFIX + asset.sourceId);
        return { ok: true, message: 'Rolled back document import' };
      }
      if (asset.kind === 'prefab') {
        deletePrefab(asset.sourceId);
        return { ok: true, message: 'Rolled back prefab import' };
      }
      if (asset.kind === 'sprite') {
        deleteSprite(asset.sourceId);
        return { ok: true, message: 'Rolled back sprite import' };
      }
    } catch {
      return { ok: false, message: 'Could not roll back imported asset' };
    }
    return { ok: false, message: 'Unsupported imported asset rollback' };
  }

  private saveReport(report: AssetImportReport): AssetStoreResult {
    const store = this.resolveStorage();
    if (!store) return { ok: false, message: 'Storage unavailable' };
    try {
      store.setItem(REPORT_PREFIX + report.id, JSON.stringify(report));
      return { ok: true, message: `Saved import report ${report.name}` };
    } catch {
      return { ok: false, message: 'Import report storage full or unavailable' };
    }
  }
}

export function sanitizeImportReport(value: unknown): AssetImportReport | null {
  const report = value as AssetImportReport;
  if (!report || typeof report !== 'object' || report.v !== 1 || report.kind !== 'importReport') return null;
  if (typeof report.id !== 'string' || typeof report.name !== 'string' || typeof report.sourceFile !== 'string') return null;
  if (typeof report.importedAt !== 'string' || typeof report.decision !== 'string') return null;
  return {
    v: 1,
    kind: 'importReport',
    id: report.id,
    name: report.name,
    sourceFile: report.sourceFile,
    importedAt: report.importedAt,
    decision: report.decision,
    importedAssetId: typeof report.importedAssetId === 'string' ? report.importedAssetId : undefined,
    importedKind: typeof report.importedKind === 'string' ? report.importedKind : undefined,
    originalSourceId: typeof report.originalSourceId === 'string' ? report.originalSourceId : undefined,
    finalSourceId: typeof report.finalSourceId === 'string' ? report.finalSourceId : undefined,
    duplicateOf: typeof report.duplicateOf === 'string' ? report.duplicateOf : undefined,
    collisionWith: typeof report.collisionWith === 'string' ? report.collisionWith : undefined,
    warnings: Array.isArray(report.warnings) ? report.warnings.filter((v): v is string => typeof v === 'string') : [],
    errors: Array.isArray(report.errors) ? report.errors.filter((v): v is string => typeof v === 'string') : [],
    diff: Array.isArray(report.diff) ? report.diff.filter((v): v is string => typeof v === 'string') : [],
    sizeBytes: Number.isFinite(report.sizeBytes) ? report.sizeBytes : 0,
    contentSignature: typeof report.contentSignature === 'string' ? report.contentSignature : stableContentSignature(report),
  };
}

function parseImportPayload(value: unknown): ParsedImportAsset | null {
  const doc = sanitizeImportedDoc(value);
  if (doc) return { kind: 'document', sourceId: doc.id, name: doc.name, payload: doc, contentSignature: stableContentSignature(doc), warnings: [] };
  const prefab = sanitizePrefab(value);
  if (prefab) return {
    kind: 'prefab',
    sourceId: prefab.prefab.id,
    name: prefab.prefab.name,
    payload: prefab.prefab,
    contentSignature: prefabContentSignature(prefab.prefab),
    warnings: prefab.warnings,
  };
  const sprite = sanitizeSpriteAsset(value);
  if (sprite) return {
    kind: 'sprite',
    sourceId: sprite.id,
    name: sprite.name,
    payload: sprite,
    contentSignature: spriteAssetContentSignature(sprite),
    warnings: [],
  };
  return null;
}

interface ParsedImportAsset {
  kind: 'document' | 'prefab' | 'sprite';
  sourceId: string;
  name: string;
  payload: EditorDocument | PrefabDef | SpriteAsset;
  contentSignature: string;
  warnings: string[];
}

function reIdImportedAsset(asset: ParsedImportAsset): ParsedImportAsset {
  if (asset.kind === 'document' && isDocument(asset.payload)) {
    const payload = { ...structuredClone(asset.payload), id: freshId('doc') };
    return { ...asset, sourceId: payload.id, payload, contentSignature: stableContentSignature(payload) };
  }
  if (asset.kind === 'prefab' && isPrefab(asset.payload)) {
    const payload = { ...structuredClone(asset.payload), id: freshId('prefab'), createdAt: new Date().toISOString() };
    return { ...asset, sourceId: payload.id, payload, contentSignature: prefabContentSignature(payload) };
  }
  if (asset.kind === 'sprite' && isSprite(asset.payload)) {
    const payload = { ...structuredClone(asset.payload), id: freshSpriteId() };
    return { ...asset, sourceId: payload.id, payload, contentSignature: spriteAssetContentSignature(payload) };
  }
  return asset;
}

function saveImportedAsset(asset: ParsedImportAsset): AssetStoreResult {
  if (asset.kind === 'document' && isDocument(asset.payload)) {
    return saveDocToLibrary(asset.payload)
      ? { ok: true, message: 'Imported document' }
      : { ok: false, message: 'Document storage full or unavailable' };
  }
  if (asset.kind === 'prefab' && isPrefab(asset.payload)) {
    return savePrefab(asset.payload)
      ? { ok: true, message: 'Imported prefab' }
      : { ok: false, message: 'Prefab storage full or unavailable' };
  }
  if (asset.kind === 'sprite' && isSprite(asset.payload)) {
    return saveSprite(asset.payload)
      ? { ok: true, message: 'Imported sprite' }
      : { ok: false, message: 'Sprite storage full or unavailable' };
  }
  return { ok: false, message: 'Unsupported imported asset' };
}

function makeReport(
  input: AssetImportInput,
  importedAt: string,
  decision: AssetImportReport['decision'],
  kind: AssetKind | 'unknown',
  importedAssetId: string | null,
  errors: string[],
  warnings: string[],
  diff: string[],
  duplicateOf?: string,
  originalSourceId?: string,
  finalSourceId?: string,
  collisionWith?: string,
  contentSignature = stableContentSignature(input.text),
): AssetImportReport {
  const id = freshId('import');
  return {
    v: 1,
    kind: 'importReport',
    id,
    name: `Import ${input.fileName}`,
    sourceFile: input.fileName,
    importedAt,
    decision,
    importedKind: kind === 'unknown' ? undefined : kind,
    importedAssetId: kind === 'unknown' || !importedAssetId ? undefined : importedAssetId,
    originalSourceId,
    finalSourceId,
    duplicateOf,
    collisionWith,
    warnings,
    errors,
    diff,
    sizeBytes: new TextEncoder().encode(input.text).length,
    contentSignature,
  };
}

function stableImportedAssetId(kind: ParsedImportAsset['kind'], sourceId: string): string {
  const origin: AssetOrigin = kind === 'document' ? 'project' : 'library';
  return stableAssetId(kind, origin, sourceId);
}

function jsonExport(filename: string, value: unknown): AssetStoreExport {
  return {
    filename,
    mime: 'application/json',
    text: JSON.stringify(value),
  };
}

function storageOrNull(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function isDocument(value: unknown): value is EditorDocument {
  return !!value && typeof value === 'object' && (value as EditorDocument).v === 2;
}

function isPrefab(value: unknown): value is PrefabDef {
  return !!value && typeof value === 'object' && (value as PrefabDef).kind === 'prefab';
}

function isSprite(value: unknown): value is SpriteAsset {
  return !!value && typeof value === 'object' && (value as SpriteAsset).kind === 'sprite';
}

function isImportReport(value: unknown): value is AssetImportReport {
  return !!value && typeof value === 'object' && (value as AssetImportReport).kind === 'importReport';
}
