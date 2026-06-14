import type { EditorDocument } from '@/builder/document';
import type { PrefabDef } from '@/builder/prefablib';
import type { SpriteAsset } from '@/builder/assets/sprites';

export type AssetKind =
  | 'document'
  | 'prefab'
  | 'sprite'
  | 'materialPalette'
  | 'materialProfile'
  | 'lightPreset'
  | 'backdrop'
  | 'procPreset'
  | 'template'
  | 'importReport';

export type AssetOrigin =
  | 'built-in'
  | 'project'
  | 'library'
  | 'document-embedded'
  | 'imported'
  | 'missing'
  | 'broken';

export type AssetValidationState = 'valid' | 'warning' | 'error' | 'unknown';
export type AssetDependencyState = 'ok' | 'missing' | 'broken' | 'unknown';

export interface AssetValidationSummary {
  state: AssetValidationState;
  errors: number;
  warnings: number;
  messages: string[];
}

export interface AssetRef {
  assetId: string;
  kind: AssetKind;
  sourceId: string;
  label: string;
  optional?: boolean;
}

export interface AssetUsage {
  assetId: string;
  kind: AssetKind;
  sourceId: string;
  label: string;
  path: string;
}

export interface AssetDependencySummary {
  state: AssetDependencyState;
  refs: AssetRef[];
  missing: AssetRef[];
  broken: AssetRef[];
}

export interface AssetPreviewSummary {
  kind: 'none' | 'glyph' | 'swatch' | 'cells' | 'sprite' | 'document' | 'report';
  label: string;
  glyph?: string;
  swatch?: string;
  width?: number;
  height?: number;
  frames?: number;
  contentSignature: string;
  updatedAt?: string;
}

export interface AssetSourceMetadata {
  storage: 'builtin' | 'localStorage' | 'document' | 'generated' | 'import-report';
  key?: string;
  documentId?: string;
  fileName?: string;
  importedAt?: string;
  reimportToken?: string;
}

export type AssetPayload =
  | EditorDocument
  | PrefabDef
  | SpriteAsset
  | AssetImportReport
  | Record<string, unknown>
  | null;

export interface AssetRecord<TPayload extends AssetPayload = AssetPayload> {
  assetId: string;
  kind: AssetKind;
  sourceId: string;
  name: string;
  folder: string;
  tags: string[];
  origin: AssetOrigin;
  createdAt?: string;
  updatedAt?: string;
  source: AssetSourceMetadata;
  validation: AssetValidationSummary;
  dependencies: AssetDependencySummary;
  usages: AssetUsage[];
  preview: AssetPreviewSummary;
  payload: TPayload;
  immutable: boolean;
  portable: boolean;
  sizeBytes: number;
  contentSignature: string;
}

export type ImportDecision =
  | 'accepted'
  | 'rejected'
  | 'duplicate'
  | 'collision-reid'
  | 'collision-replace'
  | 'invalid';

export interface AssetImportReport {
  v: 1;
  kind: 'importReport';
  id: string;
  name: string;
  sourceFile: string;
  importedAt: string;
  decision: ImportDecision;
  importedAssetId?: string;
  importedKind?: AssetKind;
  originalSourceId?: string;
  finalSourceId?: string;
  duplicateOf?: string;
  collisionWith?: string;
  warnings: string[];
  errors: string[];
  diff: string[];
  sizeBytes: number;
  contentSignature: string;
}

export interface AssetDeletePlan {
  assetId: string;
  allowed: boolean;
  reasons: string[];
  usages: AssetUsage[];
  options: Array<'remove' | 'reassign' | 'embed' | 'cancel'>;
}

export interface AssetQuery {
  kinds?: readonly AssetKind[];
  origins?: readonly AssetOrigin[];
  tags?: readonly string[];
  text?: string;
  validation?: readonly AssetValidationState[];
  dependency?: readonly AssetDependencyState[];
  minUsageCount?: number;
  maxUsageCount?: number;
  collection?: AssetSmartCollection;
  sort?: AssetSortMode;
}

export type AssetSmartCollection =
  | 'all'
  | 'recent'
  | 'missing'
  | 'unused'
  | 'usedByCurrentDocument'
  | 'builtins'
  | 'imported'
  | 'broken'
  | 'warnings';

export type AssetSortMode = 'name' | 'kind' | 'modified' | 'usage' | 'validation' | 'size';

export const ASSET_KINDS: readonly AssetKind[] = [
  'document',
  'prefab',
  'sprite',
  'materialPalette',
  'materialProfile',
  'lightPreset',
  'backdrop',
  'procPreset',
  'template',
  'importReport',
];

export const ASSET_ORIGINS: readonly AssetOrigin[] = [
  'built-in',
  'project',
  'library',
  'document-embedded',
  'imported',
  'missing',
  'broken',
];

export function stableAssetId(kind: AssetKind, origin: AssetOrigin, sourceId: string): string {
  return `${kind}:${origin}:${normalizeAssetToken(sourceId)}`;
}

export function normalizeAssetToken(value: string): string {
  return value.trim().replace(/[^a-zA-Z0-9_.:-]+/g, '-').replace(/^-+|-+$/g, '') || 'unnamed';
}

export function validSummary(messages: string[] = []): AssetValidationSummary {
  return { state: 'valid', errors: 0, warnings: 0, messages };
}

export function warningSummary(messages: string[]): AssetValidationSummary {
  return { state: 'warning', errors: 0, warnings: messages.length, messages };
}

export function errorSummary(messages: string[]): AssetValidationSummary {
  return { state: 'error', errors: messages.length, warnings: 0, messages };
}

export function emptyDependencies(): AssetDependencySummary {
  return { state: 'ok', refs: [], missing: [], broken: [] };
}
