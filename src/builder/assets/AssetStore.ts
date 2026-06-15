import { freshId, loadDocLibrary, saveDocToLibrary, sanitizeImportedDoc } from '@/builder/document';
import type { EditorDocument } from '@/builder/document';
import { deletePrefab, loadPrefabs, savePrefab, sanitizePrefab } from '@/builder/prefablib';
import type { PrefabDef } from '@/builder/prefablib';
import { deleteSprite, loadSprites, saveSprite } from '@/builder/assets/spritelib';
import { freshSpriteId, sanitizeSpriteAsset } from '@/builder/assets/sprites';
import type { SpriteAsset } from '@/builder/assets/sprites';
import {
  prefabContentSignature,
  spriteAssetContentSignature,
  stableContentSignature,
} from '@/builder/assets/AssetPreview';
import { buildAssetDatabase } from '@/builder/assets/AssetDatabase';
import type { AssetDatabase } from '@/builder/assets/AssetDatabase';
import { ASSET_KINDS, normalizeAssetToken, stableAssetId } from '@/builder/assets/AssetTypes';
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

export interface AssetExportBundle {
  v: 1;
  kind: 'assetExportBundle';
  exportedAt: string;
  assets: Array<{
    assetId: string;
    kind: AssetKind;
    origin: AssetOrigin;
    sourceId: string;
    filename: string;
    mime: string;
    text: string;
  }>;
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
  reimportJson(record: AssetRecord, input: AssetImportInput): AssetImportResult;
  quota(): Promise<AssetQuotaSummary>;
  recover(): AssetRecoveryReport;
}

const DOC_PREFIX = 'noita-builder-doc:';
const PREFAB_PREFIX = 'noita-builder-prefab:';
const SPRITE_PREFIX = 'noita-builder-sprite:';
const REPORT_PREFIX = 'noita-builder-import-report:';
const IMPORT_JSON_MAX_BYTES = 12_000_000;
const IMPORT_BUNDLE_MAX_ENTRIES = 128;
const IMPORT_BUNDLE_ENTRY_MAX_BYTES = 4_000_000;
const IMPORT_DECISIONS: readonly AssetImportReport['decision'][] = [
  'accepted',
  'rejected',
  'duplicate',
  'collision-reid',
  'collision-replace',
  'invalid',
];

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
    if (record.usages.length > 0) {
      return { ok: false, message: `Cannot delete ${record.name}; ${record.usages.length} current document reference(s) still exist` };
    }
    if (record.source.storage === 'document') {
      return { ok: false, message: 'Document-owned assets must be changed through Builder document commands' };
    }
    if (record.source.storage !== 'localStorage' && record.source.storage !== 'import-report') {
      return { ok: false, message: `${record.kind} assets are read-only in this store` };
    }
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
    if (record.source.storage === 'content-registry') {
      return jsonExport(`${record.sourceId}.${record.kind}.content-metadata.json`, {
        metadataOnly: true,
        kind: record.kind,
        sourceId: record.sourceId,
        name: record.name,
        origin: record.origin,
        source: record.source,
        tags: record.tags,
        validation: record.validation,
        dependencies: record.dependencies.refs,
        payload: record.payload,
      });
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
    if (byteLength(input.text) > IMPORT_JSON_MAX_BYTES) {
      const report = makeReport(input, importedAt, 'invalid', 'unknown', null, ['Import JSON is too large'], [], []);
      const reportSave = this.saveReport(report);
      return { ok: false, message: reportSave.ok ? 'Import failed: JSON too large' : `Import failed: JSON too large; ${reportSave.message}`, report };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(input.text);
    } catch {
      const report = makeReport(input, importedAt, 'invalid', 'unknown', null, ['Invalid JSON'], [], []);
      const reportSave = this.saveReport(report);
      return { ok: false, message: reportSave.ok ? 'Import failed: invalid JSON' : `Import failed: invalid JSON; ${reportSave.message}`, report };
    }

    const bundle = sanitizeAssetExportBundle(parsed);
    if (bundle) return this.importBundleJson(input, importedAt, bundle, database);

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

    const existingSameId = findImportCollision(database, parsedAsset.kind, parsedAsset.sourceId);
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

  private importBundleJson(
    input: AssetImportInput,
    importedAt: string,
    bundle: AssetExportBundle,
    database: AssetDatabase,
  ): AssetImportResult {
    if (bundle.assets.length > IMPORT_BUNDLE_MAX_ENTRIES) {
      const report = makeReport(input, importedAt, 'invalid', 'unknown', null, [`Bundle contains ${bundle.assets.length} entries; max is ${IMPORT_BUNDLE_MAX_ENTRIES}`], [], []);
      const reportSave = this.saveReport(report);
      return { ok: false, message: reportSave.ok ? 'Import failed: bundle too large' : `Import failed: bundle too large; ${reportSave.message}`, report };
    }
    const preflightErrors: string[] = [];
    for (const [index, entry] of bundle.assets.entries()) {
      if (byteLength(entry.text) > IMPORT_BUNDLE_ENTRY_MAX_BYTES) {
        preflightErrors.push(`${entry.filename || index}: entry JSON is too large`);
        continue;
      }
      try {
        if (!parseImportPayload(JSON.parse(entry.text))) preflightErrors.push(`${entry.filename || index}: unsupported asset JSON`);
      } catch {
        preflightErrors.push(`${entry.filename || index}: invalid JSON`);
      }
    }
    if (preflightErrors.length > 0) {
      const report = makeReport(input, importedAt, 'invalid', 'unknown', null, preflightErrors, [], ['Bundle rejected before writing any assets']);
      const reportSave = this.saveReport(report);
      return {
        ok: false,
        message: reportSave.ok ? 'Import failed: bundle preflight rejected' : `Import failed: bundle preflight rejected; ${reportSave.message}`,
        report,
      };
    }
    const diffs: string[] = [];
    const warnings: string[] = [];
    const errors: string[] = [];
    const entryReports: AssetImportReport[] = [];
    let workingDatabase = database;
    for (const [index, entry] of bundle.assets.entries()) {
      const entryInput: AssetImportInput = {
        fileName: entry.filename || `${entry.kind}-${index}.json`,
        text: entry.text,
        acceptedAt: importedAt,
      };
      const result = this.importJson(entryInput, workingDatabase);
      const label = `${entry.assetId || entry.filename}: ${result.message}`;
      diffs.push(label);
      if (result.report.warnings.length > 0) warnings.push(...result.report.warnings.map((warning) => `${entry.filename}: ${warning}`));
      if (!result.ok) errors.push(label);
      else entryReports.push(result.report);
      workingDatabase = this.bundleWorkingDatabase(workingDatabase);
    }
    const decision: AssetImportReport['decision'] = errors.length === 0 ? 'accepted' : 'rejected';
    const report = makeReport(
      input,
      importedAt,
      decision,
      'unknown',
      null,
      errors,
      warnings,
      [`Bundle entries: ${bundle.assets.length}`, ...diffs],
      undefined,
      undefined,
      undefined,
      undefined,
      stableContentSignature(input.text),
    );
    const reportSave = this.saveReport(report);
    if (!reportSave.ok) {
      const rollback = this.rollbackBundleImports(entryReports);
      return {
        ok: false,
        message: `Imported bundle entries, but ${reportSave.message}; ${rollback.message}`,
        report,
      };
    }
    return {
      ok: errors.length === 0,
      message: `Imported bundle: ${bundle.assets.length - errors.length}/${bundle.assets.length} entries accepted`,
      report,
    };
  }

  reimportJson(record: AssetRecord, input: AssetImportInput): AssetImportResult {
    const importedAt = input.acceptedAt ?? new Date().toISOString();
    const reportAndReturn = (
      decision: AssetImportReport['decision'],
      kind: AssetKind | 'unknown',
      importedAssetId: string | null,
      errors: string[],
      warnings: string[],
      diff: string[],
      contentSignature = stableContentSignature(input.text),
      duplicateOf?: string,
      originalSourceId?: string,
      finalSourceId?: string,
      collisionWith?: string,
    ): AssetImportResult => {
      const report = makeReport(
        input,
        importedAt,
        decision,
        kind,
        importedAssetId,
        errors,
        warnings,
        diff,
        duplicateOf,
        originalSourceId,
        finalSourceId,
        collisionWith,
        contentSignature,
      );
      const reportSave = this.saveReport(report);
      const ok = errors.length === 0 && reportSave.ok;
      return {
        ok,
        message: reportSave.ok
          ? diff[0] ?? (ok ? 'Reimport complete' : 'Reimport rejected')
          : `Reimport report failed: ${reportSave.message}`,
        report,
        importedKind: kind === 'unknown' ? undefined : kind,
        importedSourceId: finalSourceId ?? originalSourceId,
      };
    };

    if (!canReimportRecord(record)) {
      return reportAndReturn(
        'rejected',
        record.kind,
        null,
        [`${record.kind} ${record.sourceId} cannot be reimported from this store`],
        [],
        [`Reimport rejected for ${record.assetId}`],
        record.contentSignature,
        undefined,
        record.sourceId,
        record.sourceId,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(input.text);
    } catch {
      return reportAndReturn('invalid', 'unknown', null, ['Invalid JSON'], [], []);
    }
    const asset = parseImportPayload(parsed);
    if (!asset) return reportAndReturn('invalid', 'unknown', null, ['Unsupported asset JSON'], [], []);

    if (asset.kind !== record.kind) {
      return reportAndReturn(
        'rejected',
        asset.kind,
        null,
        [`Kind changes from ${record.kind} to ${asset.kind}`],
        asset.warnings,
        [`Reimport kind mismatch for ${record.assetId}`],
        asset.contentSignature,
        undefined,
        asset.sourceId,
        record.sourceId,
      );
    }

    if (asset.sourceId !== record.sourceId) {
      return reportAndReturn(
        'rejected',
        asset.kind,
        null,
        [`Source id changes from ${record.sourceId} to ${asset.sourceId}`],
        asset.warnings,
        [`Reimport source id mismatch for ${record.assetId}`],
        asset.contentSignature,
        undefined,
        asset.sourceId,
        record.sourceId,
      );
    }

    if (asset.contentSignature === record.contentSignature) {
      return reportAndReturn(
        'duplicate',
        asset.kind,
        record.assetId,
        [],
        asset.warnings,
        ['No content changes detected'],
        asset.contentSignature,
        record.assetId,
        asset.sourceId,
        record.sourceId,
      );
    }

    const save = saveImportedAsset(asset);
    const diff = [`Replaced ${record.assetId}: ${record.contentSignature} -> ${asset.contentSignature}`];
    const report = makeReport(
      input,
      importedAt,
      save.ok ? 'collision-replace' : 'rejected',
      asset.kind,
      save.ok ? record.assetId : null,
      save.ok ? [] : [save.message],
      asset.warnings,
      save.ok ? diff : [`Reimport failed for ${record.assetId}`],
      undefined,
      asset.sourceId,
      record.sourceId,
      record.assetId,
      asset.contentSignature,
    );
    const reportSave = this.saveReport(report);
    if (!reportSave.ok) {
      if (save.ok) {
        const rollback = restoreRecordPayload(record);
        return {
          ok: false,
          message: rollback.ok
            ? `Reimport failed: ${reportSave.message}; previous asset restored`
            : `Reimport failed: ${reportSave.message}; rollback also failed: ${rollback.message}`,
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
      message: save.ok ? `Reimported ${record.kind} ${record.name}` : save.message,
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

  private rollbackBundleImports(reports: readonly AssetImportReport[]): AssetStoreResult {
    let assetsRolledBack = 0;
    let reportsRolledBack = 0;
    const errors: string[] = [];
    const store = this.resolveStorage();
    for (const report of reports) {
      const decisionWritesAsset = report.decision === 'accepted' || report.decision === 'collision-reid';
      if (decisionWritesAsset && report.importedKind && report.finalSourceId) {
        try {
          if (report.importedKind === 'document') {
            if (!store) throw new Error('storage unavailable');
            store.removeItem('noita-builder-doc:' + report.finalSourceId);
            assetsRolledBack++;
          } else if (report.importedKind === 'prefab') {
            deletePrefab(report.finalSourceId);
            assetsRolledBack++;
          } else if (report.importedKind === 'sprite') {
            deleteSprite(report.finalSourceId);
            assetsRolledBack++;
          }
        } catch {
          errors.push(`asset ${report.importedAssetId ?? report.finalSourceId}`);
        }
      }
      if (store) {
        try {
          store.removeItem(REPORT_PREFIX + report.id);
          reportsRolledBack++;
        } catch {
          errors.push(`report ${report.id}`);
        }
      }
    }
    const message = errors.length > 0
      ? `bundle rollback incomplete (${assetsRolledBack} asset(s), ${reportsRolledBack} report(s)); failed ${errors.join(', ')}`
      : `bundle rollback removed ${assetsRolledBack} asset(s) and ${reportsRolledBack} report(s)`;
    return { ok: errors.length === 0, message };
  }

  private localAssetDatabase(): AssetDatabase {
    return buildAssetDatabase({
      documents: loadDocLibrary(),
      prefabs: loadPrefabs(),
      sprites: loadSprites(),
      importReports: this.listImportReports(),
    });
  }

  private bundleWorkingDatabase(base: AssetDatabase): AssetDatabase {
    const database = this.localAssetDatabase();
    for (const record of base.list()) {
      if (record.source.storage === 'localStorage' || record.source.storage === 'import-report') continue;
      if (!database.get(record.assetId)) database.add(record);
    }
    return database;
  }
}

export function sanitizeImportReport(value: unknown): AssetImportReport | null {
  const report = value as AssetImportReport;
  if (!report || typeof report !== 'object' || report.v !== 1 || report.kind !== 'importReport') return null;
  if (typeof report.id !== 'string' || typeof report.name !== 'string' || typeof report.sourceFile !== 'string') return null;
  if (typeof report.importedAt !== 'string' || Number.isNaN(Date.parse(report.importedAt))) return null;
  if (!IMPORT_DECISIONS.includes(report.decision)) return null;
  if (report.importedKind !== undefined && !ASSET_KINDS.includes(report.importedKind)) return null;
  if (!Array.isArray(report.warnings) || !Array.isArray(report.errors) || !Array.isArray(report.diff)) return null;
  if (!Number.isInteger(report.sizeBytes) || report.sizeBytes < 0) return null;
  return {
    v: 1,
    kind: 'importReport',
    id: normalizeAssetToken(report.id),
    name: report.name.slice(0, 160),
    sourceFile: report.sourceFile.slice(0, 260),
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
    sizeBytes: report.sizeBytes,
    contentSignature: typeof report.contentSignature === 'string' ? report.contentSignature : stableContentSignature(report),
  };
}

function sanitizeAssetExportBundle(value: unknown): AssetExportBundle | null {
  const bundle = value as Partial<AssetExportBundle>;
  if (!bundle || typeof bundle !== 'object' || bundle.v !== 1 || bundle.kind !== 'assetExportBundle') return null;
  if (typeof bundle.exportedAt !== 'string' || !Array.isArray(bundle.assets)) return null;
  const assets: AssetExportBundle['assets'] = [];
  for (const raw of bundle.assets) {
    const entry = raw as Partial<AssetExportBundle['assets'][number]>;
    if (!entry || typeof entry !== 'object') return null;
    if (
      typeof entry.assetId !== 'string' ||
      typeof entry.kind !== 'string' ||
      typeof entry.origin !== 'string' ||
      typeof entry.sourceId !== 'string' ||
      typeof entry.filename !== 'string' ||
      typeof entry.mime !== 'string' ||
      typeof entry.text !== 'string'
    )
      return null;
    assets.push({
      assetId: entry.assetId,
      kind: entry.kind as AssetKind,
      origin: entry.origin as AssetOrigin,
      sourceId: entry.sourceId,
      filename: entry.filename,
      mime: entry.mime,
      text: entry.text,
    });
  }
  return { v: 1, kind: 'assetExportBundle', exportedAt: bundle.exportedAt, assets };
}

function parseImportPayload(value: unknown): ParsedImportAsset | null {
  const doc = sanitizeImportedDoc(value);
  if (doc) {
    const payload = { ...doc, id: normalizeAssetToken(doc.id) };
    return { kind: 'document', sourceId: payload.id, name: payload.name, payload, contentSignature: stableContentSignature(payload), warnings: [] };
  }
  const prefab = sanitizePrefab(value);
  if (prefab) {
    const payload = { ...prefab.prefab, id: normalizeAssetToken(prefab.prefab.id) };
    return {
      kind: 'prefab',
      sourceId: payload.id,
      name: payload.name,
      payload,
      contentSignature: prefabContentSignature(payload),
      warnings: prefab.warnings,
    };
  }
  const sprite = sanitizeSpriteAsset(value);
  if (sprite) {
    const payload = { ...sprite, id: normalizeAssetToken(sprite.id) };
    return {
      kind: 'sprite',
      sourceId: payload.id,
      name: payload.name,
      payload,
      contentSignature: spriteAssetContentSignature(payload),
      warnings: [],
    };
  }
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

function restoreRecordPayload(record: AssetRecord): AssetStoreResult {
  if (record.kind === 'document' && isDocument(record.payload)) {
    return saveDocToLibrary(record.payload)
      ? { ok: true, message: 'Restored previous document' }
      : { ok: false, message: 'Could not restore previous document' };
  }
  if (record.kind === 'prefab' && isPrefab(record.payload)) {
    return savePrefab(record.payload)
      ? { ok: true, message: 'Restored previous prefab' }
      : { ok: false, message: 'Could not restore previous prefab' };
  }
  if (record.kind === 'sprite' && isSprite(record.payload)) {
    return saveSprite(record.payload)
      ? { ok: true, message: 'Restored previous sprite' }
      : { ok: false, message: 'Could not restore previous sprite' };
  }
  return { ok: false, message: 'Unsupported rollback asset' };
}

function canReimportRecord(record: AssetRecord): boolean {
  if (record.immutable || record.source.storage !== 'localStorage') return false;
  if (record.kind === 'document') return isDocument(record.payload);
  if (record.kind === 'prefab') return isPrefab(record.payload);
  if (record.kind === 'sprite') return isSprite(record.payload);
  return false;
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

function findImportCollision(
  database: AssetDatabase,
  kind: ParsedImportAsset['kind'],
  sourceId: string,
): AssetRecord | undefined {
  const incomingAssetId = stableImportedAssetId(kind, sourceId);
  return database
    .list()
    .find((record) =>
      record.kind === kind &&
      record.origin !== 'missing' &&
      (record.assetId === incomingAssetId || normalizeAssetToken(record.sourceId) === sourceId),
    );
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

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
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
