import type { MaterialParams } from '@/core/types';
import { CARD_DEFS } from '@/combat/wands/cards';
import type { EditorDocument, EditorObject } from '@/builder/document';
import type { PrefabDef } from '@/builder/prefablib';
import type { SpriteAsset } from '@/builder/assets/sprites';
import { decorSpriteId } from '@/builder/assets/spritelib';
import { validateDocument } from '@/builder/validate';
import {
  assetPreviewSummary,
  estimatedJsonBytes,
  prefabContentSignature,
  spriteAssetContentSignature,
  stableContentSignature,
} from '@/builder/assets/AssetPreview';
import {
  emptyDependencies,
  errorSummary,
  stableAssetId,
  validSummary,
  warningSummary,
} from '@/builder/assets/AssetTypes';
import type {
  AssetDependencySummary,
  AssetKind,
  AssetOrigin,
  AssetQuery,
  AssetRecord,
  AssetRef,
  AssetSmartCollection,
  AssetSortMode,
  AssetUsage,
  AssetValidationSummary,
  AssetDeletePlan,
  AssetImportReport,
} from '@/builder/assets/AssetTypes';
import { isAssetContentKind } from '@/content/types';
import type { ContentItem } from '@/content/types';

export interface AssetDatabaseInput {
  currentDocument?: EditorDocument;
  documents?: Record<string, EditorDocument>;
  templates?: Record<string, EditorDocument>;
  prefabs?: readonly PrefabDef[];
  builtinPrefabs?: readonly PrefabDef[];
  sprites?: readonly SpriteAsset[];
  embeddedSprites?: readonly SpriteAsset[];
  importReports?: readonly AssetImportReport[];
  contentAssets?: readonly AssetRecord[];
  materials?: Record<number, MaterialParams>;
  procPresets?: readonly { id: string; label: string; usesMaterial?: boolean }[];
  lightPresets?: readonly { id: string; label: string; color?: string; radius?: number }[];
  backdropProfiles?: readonly { id: string; label: string; builtIn?: boolean }[];
}

export interface AssetDatabaseStats {
  total: number;
  byKind: Record<string, number>;
  byOrigin: Record<string, number>;
  missing: number;
  warnings: number;
  errors: number;
}

export class AssetDatabase {
  private readonly records = new Map<string, AssetRecord>();

  constructor(input: AssetDatabaseInput = {}) {
    const importTimes = importTimestampIndex(input.importReports ?? []);
    indexBuiltInMetadata(this, input);
    for (const prefab of input.builtinPrefabs ?? []) this.add(makePrefabRecord(prefab, 'built-in'));
    for (const prefab of input.prefabs ?? []) this.add(makePrefabRecord(prefab, 'library', importTimes.get(`prefab:${prefab.id}`)));
    for (const doc of Object.values(input.documents ?? {})) {
      for (const sprite of doc.assets?.sprites ?? []) this.add(makeSpriteRecord(sprite, 'document-embedded', doc.id));
    }
    if (input.currentDocument) {
      for (const sprite of input.currentDocument.assets?.sprites ?? []) this.add(makeSpriteRecord(sprite, 'document-embedded', input.currentDocument.id));
    }
    for (const sprite of input.embeddedSprites ?? []) this.add(makeSpriteRecord(sprite, 'document-embedded', input.currentDocument?.id));
    for (const sprite of input.sprites ?? []) this.add(makeSpriteRecord(sprite, 'library', undefined, importTimes.get(`sprite:${sprite.id}`)));
    for (const record of input.contentAssets ?? []) this.add(record);
    for (const doc of Object.values(input.templates ?? {})) this.add(makeTemplateRecord(doc));
    for (const doc of Object.values(input.documents ?? {})) {
      if (doc.id !== input.currentDocument?.id) this.add(makeDocumentRecord(doc, false, importTimes.get(`document:${doc.id}`)));
    }
    if (input.currentDocument) this.add(makeDocumentRecord(input.currentDocument, true));
    for (const report of input.importReports ?? []) this.add(makeImportReportRecord(report));
    this.rebuildDependencies(input.currentDocument?.id ?? null);
  }

  add(record: AssetRecord): void {
    this.records.set(record.assetId, record);
  }

  get(assetId: string): AssetRecord | null {
    return this.records.get(assetId) ?? null;
  }

  list(): AssetRecord[] {
    return [...this.records.values()].sort(compareAssets('name'));
  }

  query(query: AssetQuery = {}): AssetRecord[] {
    const text = normalizeSearch(query.text ?? '');
    const kinds = query.kinds ? new Set(query.kinds) : null;
    const origins = query.origins ? new Set(query.origins) : null;
    const tags = query.tags ? query.tags.map(normalizeSearch).filter(Boolean) : [];
    const validation = query.validation ? new Set(query.validation) : null;
    const dependency = query.dependency ? new Set(query.dependency) : null;
    const collection = query.collection ?? 'all';
    return this.list()
      .filter((record) => {
        if (kinds && !kinds.has(record.kind)) return false;
        if (origins && !origins.has(record.origin)) return false;
        if (validation && !validation.has(record.validation.state)) return false;
        if (dependency && !dependency.has(record.dependencies.state)) return false;
        if (query.minUsageCount !== undefined && record.usages.length < query.minUsageCount) return false;
        if (query.maxUsageCount !== undefined && record.usages.length > query.maxUsageCount) return false;
        if (tags.length > 0 && !tags.every((tag) => record.tags.some((t) => normalizeSearch(t).includes(tag)))) return false;
        if (text && !assetSearchText(record).includes(text)) return false;
        return collectionMatches(record, collection);
      })
      .sort(compareAssets(query.sort ?? (collection === 'recent' ? 'modified' : 'name')));
  }

  usageFor(assetId: string): AssetUsage[] {
    return [...(this.records.get(assetId)?.usages ?? [])];
  }

  dependenciesFor(assetId: string): AssetDependencySummary {
    return this.records.get(assetId)?.dependencies ?? emptyDependencies();
  }

  deletePlan(assetId: string): AssetDeletePlan {
    const record = this.get(assetId);
    if (!record) {
      return {
        assetId,
        allowed: false,
        reasons: ['Asset is not indexed'],
        usages: [],
        options: ['cancel'],
      };
    }
    const reasons: string[] = [];
    if (record.source.storage === 'content-registry') {
      reasons.push('Built-in gameplay content is read-only; export metadata for reference or review');
    } else if (record.immutable) {
      reasons.push('Built-in assets are immutable; duplicate or export them first');
    }
    if (record.source.storage === 'document') {
      reasons.push('Current Builder document edits must use Builder document commands or the document toolbar');
    }
    if (record.origin === 'missing' || record.origin === 'broken') reasons.push('Missing or broken placeholders cannot be deleted');
    if (record.usages.length > 0) reasons.push(`${record.usages.length} usage(s) must be resolved before deletion`);
    return {
      assetId,
      allowed: reasons.length === 0,
      reasons,
      usages: [...record.usages],
      options: record.usages.length > 0 ? ['reassign', 'embed', 'cancel'] : ['remove', 'cancel'],
    };
  }

  stats(): AssetDatabaseStats {
    const stats: AssetDatabaseStats = { total: 0, byKind: {}, byOrigin: {}, missing: 0, warnings: 0, errors: 0 };
    for (const record of this.records.values()) {
      stats.total++;
      stats.byKind[record.kind] = (stats.byKind[record.kind] ?? 0) + 1;
      stats.byOrigin[record.origin] = (stats.byOrigin[record.origin] ?? 0) + 1;
      if (record.dependencies.missing.length > 0 || record.origin === 'missing') stats.missing++;
      if (record.validation.state === 'warning') stats.warnings++;
      if (record.validation.state === 'error') stats.errors++;
    }
    return stats;
  }

  private rebuildDependencies(currentDocumentId: string | null): void {
    for (const record of this.records.values()) {
      record.dependencies = emptyDependencies();
      record.usages = [];
    }
    for (const record of [...this.records.values()]) {
      const refs = dependencyRefs(record);
      if (refs.length === 0) continue;
      const missing: AssetRef[] = [];
      const broken: AssetRef[] = [];
      for (const ref of refs) {
        const target = this.resolveReference(ref);
        if (!target) {
          missing.push(ref);
          const placeholder = makeMissingRecord(ref);
          if (!this.records.has(placeholder.assetId)) this.add(placeholder);
          this.addUsage(placeholder.assetId, makeUsage(record, ref, currentDocumentId));
          continue;
        }
        if (target.validation.state === 'error' || target.origin === 'broken') broken.push(ref);
        this.addUsage(target.assetId, makeUsage(record, ref, currentDocumentId));
      }
      record.dependencies = {
        state: missing.length > 0 ? 'missing' : broken.length > 0 ? 'broken' : 'ok',
        refs,
        missing,
        broken,
      };
      if (missing.length > 0 && record.validation.state === 'valid') {
        record.validation = warningSummary(missing.map((ref) => `missing ${ref.kind} ${ref.sourceId}`));
      }
    }
  }

  private resolveReference(ref: AssetRef): AssetRecord | null {
    const preferred = ref.kind === 'sprite'
      ? [
          stableAssetId('sprite', 'library', ref.sourceId),
          stableAssetId('sprite', 'document-embedded', ref.sourceId),
          stableAssetId('sprite', 'built-in', ref.sourceId),
        ]
      : ref.kind === 'prefab'
        ? [
            stableAssetId('prefab', 'library', ref.sourceId),
            stableAssetId('prefab', 'built-in', ref.sourceId),
          ]
        : [
            stableAssetId(ref.kind, 'project', ref.sourceId),
            stableAssetId(ref.kind, 'library', ref.sourceId),
            stableAssetId(ref.kind, 'built-in', ref.sourceId),
            stableAssetId(ref.kind, 'document-embedded', ref.sourceId),
          ];
    for (const id of preferred) {
      const record = this.records.get(id);
      if (record) return record;
    }
    return null;
  }

  private addUsage(assetId: string, usage: AssetUsage): void {
    const record = this.records.get(assetId);
    if (record) record.usages.push(usage);
  }
}

export function buildAssetDatabase(input: AssetDatabaseInput = {}): AssetDatabase {
  return new AssetDatabase(input);
}

export function assetRecordSourceKey(record: AssetRecord): string {
  return `${record.kind}:${record.sourceId}`;
}

function indexBuiltInMetadata(db: AssetDatabase, input: AssetDatabaseInput): void {
  db.add(makeSyntheticRecord('materialPalette', 'built-in', 'default', 'Default Material Palette', 'Built-ins', ['materials']));
  for (const [id, params] of Object.entries(input.materials ?? {})) {
    const label = params?.name ?? `Material ${id}`;
    db.add(makeSyntheticRecord('materialProfile', 'built-in', `cell-${id}`, label, 'Built-ins/Materials', ['material', id]));
  }
  for (const pass of input.procPresets ?? []) {
    db.add(makeSyntheticRecord('procPreset', 'built-in', pass.id, pass.label, 'Built-ins/Procedural', pass.usesMaterial ? ['procedural', 'material'] : ['procedural']));
  }
  for (const preset of input.lightPresets ?? []) {
    db.add(makeSyntheticRecord('lightPreset', 'built-in', preset.id, preset.label, 'Built-ins/Lights', ['light']));
  }
  for (const backdrop of input.backdropProfiles ?? []) {
    db.add(makeSyntheticRecord('backdrop', backdrop.builtIn === false ? 'project' : 'built-in', backdrop.id, backdrop.label, 'Built-ins/Backdrops', ['backdrop']));
  }
}

function makeTemplateRecord(doc: EditorDocument): AssetRecord<EditorDocument> {
  const signature = stableContentSignature(doc);
  return finalizeRecord({
    assetId: stableAssetId('template', 'built-in', doc.id),
    kind: 'template',
    sourceId: doc.id,
    name: doc.name || 'template',
    folder: 'Built-ins/Templates',
    tags: ['template', 'document', doc.biome],
    origin: 'built-in',
    source: { storage: 'builtin', documentId: doc.id },
    validation: validSummary(['Template opens as a new Builder document']),
    dependencies: emptyDependencies(),
    usages: [],
    preview: { kind: 'document', label: 'Builder template', glyph: 'T', contentSignature: signature },
    payload: doc,
    immutable: true,
    portable: true,
    sizeBytes: estimatedJsonBytes(doc),
    contentSignature: signature,
  });
}

function makeDocumentRecord(doc: EditorDocument, current: boolean, importedAt?: string): AssetRecord<EditorDocument> {
  const issues = validateDocument(doc);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');
  const validation: AssetValidationSummary = errors.length > 0
    ? errorSummary(errors.map((issue) => issue.what))
    : warnings.length > 0
      ? warningSummary(warnings.map((issue) => issue.what))
      : validSummary();
  const signature = stableContentSignature(doc);
  return finalizeRecord({
    assetId: stableAssetId('document', 'project', doc.id),
    kind: 'document',
    sourceId: doc.id,
    name: doc.name || 'untitled',
    folder: current ? 'Current Document' : 'Documents',
    tags: ['document', doc.biome, current ? 'current' : 'saved'],
    origin: 'project',
    createdAt: undefined,
    updatedAt: importedAt ?? doc.validation?.at,
    source: { storage: current ? 'document' : 'localStorage', key: `noita-builder-doc:${doc.id}`, documentId: doc.id },
    validation,
    dependencies: emptyDependencies(),
    usages: [],
    preview: { kind: 'none', label: '', contentSignature: signature },
    payload: doc,
    immutable: false,
    portable: true,
    sizeBytes: estimatedJsonBytes(doc),
    contentSignature: signature,
  });
}

function makePrefabRecord(prefab: PrefabDef, origin: 'built-in' | 'library', importedAt?: string): AssetRecord<PrefabDef> {
  const signature = prefabContentSignature(prefab);
  return finalizeRecord({
    assetId: stableAssetId('prefab', origin, prefab.id),
    kind: 'prefab',
    sourceId: prefab.id,
    name: prefab.name || 'prefab',
    folder: origin === 'built-in' ? 'Built-ins/Prefabs' : 'Prefabs',
    tags: ['prefab', ...prefab.tags],
    origin,
    createdAt: prefab.createdAt,
    updatedAt: importedAt ?? prefab.createdAt,
    source: { storage: origin === 'built-in' ? 'builtin' : 'localStorage', key: origin === 'built-in' ? undefined : `noita-builder-prefab:${prefab.id}` },
    validation: validSummary(),
    dependencies: emptyDependencies(),
    usages: [],
    preview: { kind: 'none', label: '', contentSignature: signature },
    payload: prefab,
    immutable: origin === 'built-in',
    portable: true,
    sizeBytes: estimatedJsonBytes(prefab),
    contentSignature: signature,
  });
}

function makeSpriteRecord(sprite: SpriteAsset, origin: 'library' | 'document-embedded', documentId?: string, importedAt?: string): AssetRecord<SpriteAsset> {
  const signature = spriteAssetContentSignature(sprite);
  return finalizeRecord({
    assetId: stableAssetId('sprite', origin, sprite.id),
    kind: 'sprite',
    sourceId: sprite.id,
    name: sprite.name || 'sprite',
    folder: origin === 'document-embedded' ? 'Document Embedded/Sprites' : 'Sprites',
    tags: ['sprite', sprite.emissive ? 'emissive' : 'lit', ...sprite.tags.map((tag) => tag.name)],
    origin,
    createdAt: importedAt,
    updatedAt: importedAt,
    source: {
      storage: origin === 'document-embedded' ? 'document' : 'localStorage',
      key: origin === 'library' ? `noita-builder-sprite:${sprite.id}` : undefined,
      documentId,
    },
    validation: validSummary(),
    dependencies: emptyDependencies(),
    usages: [],
    preview: { kind: 'none', label: '', contentSignature: signature },
    payload: sprite,
    immutable: false,
    portable: true,
    sizeBytes: estimatedJsonBytes(sprite),
    contentSignature: signature,
  });
}

function makeImportReportRecord(report: AssetImportReport): AssetRecord<AssetImportReport> {
  const signature = stableContentSignature(report);
  const validation = report.errors.length > 0
    ? errorSummary(report.errors)
    : report.warnings.length > 0
      ? warningSummary(report.warnings)
      : validSummary();
  return finalizeRecord({
    assetId: stableAssetId('importReport', 'imported', report.id),
    kind: 'importReport',
    sourceId: report.id,
    name: report.name,
    folder: 'Import Reports',
    tags: ['import', report.decision, report.importedKind ?? 'unknown'],
    origin: 'imported',
    createdAt: report.importedAt,
    updatedAt: report.importedAt,
    source: { storage: 'import-report', key: `noita-builder-import-report:${report.id}`, fileName: report.sourceFile, importedAt: report.importedAt },
    validation,
    dependencies: emptyDependencies(),
    usages: [],
    preview: { kind: 'none', label: '', contentSignature: signature },
    payload: report,
    immutable: false,
    portable: false,
    sizeBytes: estimatedJsonBytes(report),
    contentSignature: signature,
  });
}

function importTimestampIndex(reports: readonly AssetImportReport[]): Map<string, string> {
  const times = new Map<string, string>();
  for (const report of reports) {
    if (!report.importedKind || !report.finalSourceId) continue;
    if (report.decision !== 'accepted' && report.decision !== 'collision-reid' && report.decision !== 'collision-replace') continue;
    const key = `${report.importedKind}:${report.finalSourceId}`;
    const previous = times.get(key);
    if (!previous || report.importedAt > previous) times.set(key, report.importedAt);
  }
  return times;
}

function makeSyntheticRecord(
  kind: AssetKind,
  origin: AssetOrigin,
  sourceId: string,
  name: string,
  folder: string,
  tags: readonly unknown[],
): AssetRecord<Record<string, unknown>> {
  const payload = { id: sourceId, name, kind };
  const signature = stableContentSignature(payload);
  return finalizeRecord({
    assetId: stableAssetId(kind, origin, sourceId),
    kind,
    sourceId,
    name,
    folder,
    tags: tags.map(String),
    origin,
    source: { storage: origin === 'built-in' ? 'builtin' : 'generated' },
    validation: validSummary(),
    dependencies: emptyDependencies(),
    usages: [],
    preview: { kind: 'none', label: '', contentSignature: signature },
    payload,
    immutable: origin === 'built-in',
    portable: origin !== 'built-in',
    sizeBytes: estimatedJsonBytes(payload),
    contentSignature: signature,
  });
}

function makeMissingRecord(ref: AssetRef): AssetRecord<null> {
  const signature = stableContentSignature(ref);
  return finalizeRecord({
    assetId: stableAssetId(ref.kind, 'missing', ref.sourceId),
    kind: ref.kind,
    sourceId: ref.sourceId,
    name: `Missing ${ref.kind}: ${ref.sourceId}`,
    folder: 'Missing Dependencies',
    tags: ['missing', ref.kind],
    origin: 'missing',
    source: { storage: 'generated' },
    validation: errorSummary([`Missing ${ref.kind} ${ref.sourceId}`]),
    dependencies: { state: 'missing', refs: [], missing: [], broken: [] },
    usages: [],
    preview: { kind: 'glyph', label: 'Missing asset', glyph: '?', contentSignature: signature },
    payload: null,
    immutable: true,
    portable: false,
    sizeBytes: 0,
    contentSignature: signature,
  });
}

function finalizeRecord<T extends AssetRecord>(record: T): T {
  record.preview = assetPreviewSummary(record);
  return record;
}

function dependencyRefs(record: AssetRecord): AssetRef[] {
  if (record.kind === 'document' && isDocument(record.payload)) {
    return [
      ...spriteRefs(record.payload.objects, record),
      ...contentRefs(record.payload.objects, record),
      ...record.payload.proceduralHistory.map((pass) => ({
        assetId: stableAssetId('procPreset', 'built-in', pass.pass),
        kind: 'procPreset' as const,
        sourceId: pass.pass,
        label: `procedural pass ${pass.pass}`,
      })),
      ...record.payload.proceduralHistory
        .map((pass) => (typeof pass.params.material === 'number' ? Math.floor(pass.params.material) : null))
        .filter((material): material is number => material !== null)
        .map((material) => ({
          assetId: stableAssetId('materialProfile', 'built-in', `cell-${material}`),
          kind: 'materialProfile' as const,
          sourceId: `cell-${material}`,
          label: `material ${material}`,
          optional: true,
        })),
      ...(record.payload.backdropProfileId
        ? [{
            assetId: stableAssetId('backdrop', 'built-in', record.payload.backdropProfileId),
            kind: 'backdrop' as const,
            sourceId: record.payload.backdropProfileId,
            label: `backdrop ${record.payload.backdropProfileId}`,
            optional: true,
          }]
        : []),
    ];
  }
  if (record.kind === 'prefab' && isPrefab(record.payload)) {
    return [...spriteRefs(record.payload.objects, record), ...contentRefs(record.payload.objects, record)];
  }
  if (isContentItem(record.payload)) {
    return record.payload.dependencies
      .filter((dep) => isAssetContentKind(dep.kind))
      .map((dep) => ({
        assetId: stableAssetId(dep.kind as AssetKind, 'built-in', dep.id),
        kind: dep.kind as AssetKind,
        sourceId: dep.id,
        label: dep.reason,
      }));
  }
  return [];
}

function spriteRefs(objects: readonly EditorObject[], source: AssetRecord): AssetRef[] {
  const ids = new Set<string>();
  for (const object of objects) {
    const spriteId = decorSpriteId(object);
    if (spriteId) ids.add(spriteId);
  }
  return [...ids].sort().map((sourceId) => ({
    assetId: stableAssetId('sprite', 'library', sourceId),
    kind: 'sprite',
    sourceId,
    label: `${source.name} decor sprite`,
  }));
}

function contentRefs(objects: readonly EditorObject[], source: AssetRecord): AssetRef[] {
  const refs = new Map<string, AssetRef>();
  const addRef = (kind: AssetKind, sourceId: string, label: string): void => {
    const key = `${kind}:${sourceId}`;
    if (refs.has(key)) return;
    refs.set(key, {
      assetId: stableAssetId(kind, 'built-in', sourceId),
      kind,
      sourceId,
      label,
    });
  };
  for (const object of objects) {
    if (object.kind === 'enemy') {
      const enemy = typeof object.params.kind === 'string' ? object.params.kind : 'slime';
      addRef('enemy', enemy, `${source.name} enemy`);
    } else if (object.kind === 'bossMarker') {
      addRef('enemy', 'colossus', `${source.name} boss marker`);
    } else if (object.kind === 'pickup') {
      const pickupKind = typeof object.params.kind === 'string' ? object.params.kind : 'goldpile';
      if (pickupKind === 'tome') {
        const card = typeof object.params.card === 'string' ? object.params.card : 'spark';
        addRef(cardAssetKind(card), card, `${source.name} tome card`);
      } else if (pickupKind === 'potion') {
        const potion = typeof object.params.potion === 'string' ? object.params.potion : 'vigor';
        addRef('potion', potion, `${source.name} potion pickup`);
      }
    }
  }
  return [...refs.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.sourceId.localeCompare(b.sourceId));
}

function cardAssetKind(id: string): 'card' | 'modifier' {
  const def = CARD_DEFS[id as keyof typeof CARD_DEFS];
  return def && def.kind !== 'projectile' ? 'modifier' : 'card';
}

function makeUsage(record: AssetRecord, ref: AssetRef, currentDocumentId: string | null): AssetUsage {
  const current = record.kind === 'document' && record.sourceId === currentDocumentId;
  return {
    assetId: record.assetId,
    kind: record.kind,
    sourceId: record.sourceId,
    label: `${current ? 'Current ' : ''}${record.name}`,
    path: `${record.kind}/${record.sourceId}/${ref.kind}/${ref.sourceId}`,
  };
}

function collectionMatches(record: AssetRecord, collection: AssetSmartCollection): boolean {
  if (collection === 'all') return true;
  if (collection === 'recent') return record.updatedAt !== undefined || record.createdAt !== undefined;
  if (collection === 'missing') return record.origin === 'missing' || record.dependencies.missing.length > 0;
  if (collection === 'unused') {
    return record.usages.length === 0 &&
      record.kind !== 'document' &&
      record.origin !== 'missing' &&
      !record.immutable &&
      record.source.storage !== 'content-registry';
  }
  if (collection === 'usedByCurrentDocument') return record.usages.some((usage) => usage.label.startsWith('Current '));
  if (collection === 'builtins') return record.origin === 'built-in';
  if (collection === 'imported') return record.origin === 'imported';
  if (collection === 'broken') return record.origin === 'broken' || record.validation.state === 'error' || record.dependencies.state === 'broken';
  if (collection === 'warnings') return record.validation.state === 'warning';
  return true;
}

function compareAssets(sort: AssetSortMode): (a: AssetRecord, b: AssetRecord) => number {
  return (a, b) => {
    if (sort === 'kind') return a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name);
    if (sort === 'modified') return (b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? '') || a.name.localeCompare(b.name);
    if (sort === 'usage') return b.usages.length - a.usages.length || a.name.localeCompare(b.name);
    if (sort === 'validation') return validationRank(b.validation.state) - validationRank(a.validation.state) || a.name.localeCompare(b.name);
    if (sort === 'size') return b.sizeBytes - a.sizeBytes || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name) || a.assetId.localeCompare(b.assetId);
  };
}

function validationRank(state: string): number {
  if (state === 'error') return 3;
  if (state === 'warning') return 2;
  if (state === 'unknown') return 1;
  return 0;
}

function assetSearchText(record: AssetRecord): string {
  return normalizeSearch([
    record.assetId,
    record.sourceId,
    record.name,
    record.folder,
    record.kind,
    record.origin,
    record.tags.join(' '),
    record.validation.messages.join(' '),
    record.dependencies.missing.map((ref) => ref.sourceId).join(' '),
  ].join(' '));
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function isDocument(value: unknown): value is EditorDocument {
  return !!value && typeof value === 'object' && (value as EditorDocument).v === 2;
}

function isPrefab(value: unknown): value is PrefabDef {
  return !!value && typeof value === 'object' && (value as PrefabDef).kind === 'prefab';
}

function isContentItem(value: unknown): value is ContentItem {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<ContentItem>;
  return typeof item.id === 'string' &&
    typeof item.kind === 'string' &&
    typeof item.name === 'string' &&
    Array.isArray(item.dependencies) &&
    item.validation !== undefined;
}
