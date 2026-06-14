import { sanitizeImportedDoc } from '@/builder/document';
import { sanitizePrefab } from '@/builder/prefablib';
import { sanitizeSpriteAsset } from '@/builder/assets/sprites';
import {
  prefabContentSignature,
  spriteAssetContentSignature,
  stableContentSignature,
} from '@/builder/assets/AssetPreview';
import type { AssetDatabase } from '@/builder/assets/AssetDatabase';
import type { AssetImportInput, AssetImportResult, AssetStore } from '@/builder/assets/AssetStore';
import type { AssetKind, AssetRecord } from '@/builder/assets/AssetTypes';

export interface AssetImportPreview {
  ok: boolean;
  kind: AssetKind | 'unknown';
  sourceId: string | null;
  name: string;
  contentSignature: string;
  duplicateOf?: string;
  collisionWith?: string;
  warnings: string[];
  errors: string[];
  diff: string[];
}

export interface AssetReimportDiff {
  sameContent: boolean;
  changes: string[];
  warnings: string[];
}

export function previewJsonImport(input: AssetImportInput, database: Pick<AssetDatabase, 'list'>): AssetImportPreview {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.text);
  } catch {
    return invalidPreview(input, 'Invalid JSON');
  }
  const asset = identifyImportPayload(parsed);
  if (!asset) return invalidPreview(input, 'Unsupported asset JSON');
  const duplicate = database
    .list()
    .find((record) => record.kind === asset.kind && record.contentSignature === asset.contentSignature);
  const collision = database
    .list()
    .find((record) =>
      record.kind === asset.kind &&
      record.sourceId === asset.sourceId &&
      record.origin !== 'missing' &&
      record.contentSignature !== asset.contentSignature,
    );
  return {
    ok: true,
    kind: asset.kind,
    sourceId: asset.sourceId,
    name: asset.name,
    contentSignature: asset.contentSignature,
    duplicateOf: duplicate?.assetId,
    collisionWith: collision?.assetId,
    warnings: asset.warnings,
    errors: [],
    diff: duplicate
      ? [`Duplicate of ${duplicate.assetId}`]
      : collision
        ? [`ID collision with ${collision.assetId}; import will create a new id`]
        : [`New ${asset.kind} ${asset.sourceId}`],
  };
}

export function importJsonAsset(
  input: AssetImportInput,
  store: AssetStore,
  database: AssetDatabase,
): AssetImportResult {
  return store.importJson(input, database);
}

export function previewReimport(existing: AssetRecord, input: AssetImportInput): AssetReimportDiff {
  const preview = previewJsonImport(input, { list: () => [existing] });
  if (!preview.ok) {
    return { sameContent: false, changes: [], warnings: preview.errors };
  }
  if (preview.kind !== existing.kind) {
    return {
      sameContent: false,
      changes: [`Kind changes from ${existing.kind} to ${preview.kind}`],
      warnings: ['Reimport kind mismatch; use Import as New instead'],
    };
  }
  return {
    sameContent: preview.contentSignature === existing.contentSignature,
    changes:
      preview.contentSignature === existing.contentSignature
        ? ['No content changes detected']
        : [`Content signature ${existing.contentSignature} -> ${preview.contentSignature}`],
    warnings: preview.warnings,
  };
}

function identifyImportPayload(value: unknown): {
  kind: 'document' | 'prefab' | 'sprite';
  sourceId: string;
  name: string;
  contentSignature: string;
  warnings: string[];
} | null {
  const doc = sanitizeImportedDoc(value);
  if (doc) {
    return { kind: 'document', sourceId: doc.id, name: doc.name, contentSignature: stableContentSignature(doc), warnings: [] };
  }
  const prefab = sanitizePrefab(value);
  if (prefab) {
    return {
      kind: 'prefab',
      sourceId: prefab.prefab.id,
      name: prefab.prefab.name,
      contentSignature: prefabContentSignature(prefab.prefab),
      warnings: prefab.warnings,
    };
  }
  const sprite = sanitizeSpriteAsset(value);
  if (sprite) {
    return {
      kind: 'sprite',
      sourceId: sprite.id,
      name: sprite.name,
      contentSignature: spriteAssetContentSignature(sprite),
      warnings: [],
    };
  }
  return null;
}

function invalidPreview(input: AssetImportInput, message: string): AssetImportPreview {
  return {
    ok: false,
    kind: 'unknown',
    sourceId: null,
    name: input.fileName,
    contentSignature: stableContentSignature(input.text),
    warnings: [],
    errors: [message],
    diff: [],
  };
}
