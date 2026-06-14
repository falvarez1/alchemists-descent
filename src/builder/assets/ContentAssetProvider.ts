import type { MaterialParams } from '@/core/types';
import { listBuiltInContent } from '@/content/registry';
import type { ContentItem } from '@/content/types';
import { emptyDependencies, errorSummary, stableAssetId, validSummary, warningSummary } from '@/builder/assets/AssetTypes';
import type { AssetKind, AssetRecord, AssetValidationSummary } from '@/builder/assets/AssetTypes';
import { estimatedJsonBytes, stableContentSignature } from '@/builder/assets/AssetPreview';

export interface BuiltInContentAssetProviderInput {
  materials?: Record<number, MaterialParams>;
  items?: readonly ContentItem[];
}

export function createBuiltInContentAssetRecords(input: BuiltInContentAssetProviderInput = {}): AssetRecord<ContentItem>[] {
  const items = input.items ? [...input.items] : listBuiltInContent({ materials: input.materials });
  return items.map(contentItemToAssetRecord);
}

export function contentAssetId(item: Pick<ContentItem, 'kind' | 'id'>): string {
  return stableAssetId(item.kind as AssetKind, 'built-in', item.id);
}

function contentItemToAssetRecord(item: ContentItem): AssetRecord<ContentItem> {
  const signature = stableContentSignature(item);
  return {
    assetId: contentAssetId(item),
    kind: item.kind as AssetKind,
    sourceId: item.id,
    name: item.name,
    folder: contentFolder(item),
    tags: ['content', item.kind, item.status, ...item.tags],
    origin: 'built-in',
    source: { storage: 'content-registry', key: `built-in:${item.kind}:${item.id}` },
    validation: contentValidation(item),
    dependencies: emptyDependencies(),
    usages: [],
    preview: {
      kind: item.kind === 'material' ? 'swatch' : item.kind === 'cookReport' ? 'report' : 'glyph',
      label: item.description,
      glyph: contentGlyph(item.kind),
      swatch: item.kind === 'material' ? materialSwatch(item) : undefined,
      contentSignature: signature,
    },
    payload: item,
    immutable: true,
    portable: false,
    sizeBytes: estimatedJsonBytes(item),
    contentSignature: signature,
  };
}

function contentValidation(item: ContentItem): AssetValidationSummary {
  if (item.validation.errors > 0) return errorSummary(item.validation.messages);
  if (item.validation.warnings > 0) return warningSummary(item.validation.messages);
  return validSummary(item.validation.messages);
}

function contentFolder(item: ContentItem): string {
  if (item.kind === 'card') return 'Built-ins/Content/Spells';
  if (item.kind === 'modifier') return 'Built-ins/Content/Modifiers';
  if (item.kind === 'wandFrame' || item.kind === 'wandLoadout') return 'Built-ins/Content/Wands';
  if (item.kind === 'potion' || item.kind === 'elixir' || item.kind === 'recipe') return 'Built-ins/Content/Alchemy';
  if (item.kind === 'material') return 'Built-ins/Content/Materials';
  if (item.kind === 'enemy') return 'Built-ins/Content/Enemies';
  if (item.kind === 'encounterScenario') return 'Built-ins/Content/Encounter Scenarios';
  if (item.kind === 'spellLabScenario') return 'Built-ins/Content/Spell Lab Scenarios';
  if (item.kind === 'cookReport') return 'Built-ins/Content/Cook Reports';
  return 'Built-ins/Content';
}

function contentGlyph(kind: ContentItem['kind']): string {
  if (kind === 'card') return 'C';
  if (kind === 'modifier') return '+';
  if (kind === 'wandFrame') return 'W';
  if (kind === 'wandLoadout') return 'L';
  if (kind === 'potion') return 'P';
  if (kind === 'elixir') return 'E';
  if (kind === 'recipe') return 'R';
  if (kind === 'material') return 'M';
  if (kind === 'enemy') return 'N';
  if (kind === 'encounterScenario') return 'S';
  if (kind === 'spellLabScenario') return 'T';
  if (kind === 'cookReport') return '!';
  return '?';
}

function materialSwatch(item: ContentItem): string | undefined {
  const id = typeof item.payload === 'object' && item.payload !== null ? (item.payload as { id?: unknown }).id : undefined;
  if (typeof id !== 'number') return undefined;
  const hue = (id * 47) % 360;
  return `hsl(${hue} 58% 50%)`;
}
