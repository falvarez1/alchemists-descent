export type ContentKind =
  | 'card'
  | 'modifier'
  | 'wandFrame'
  | 'wandLoadout'
  | 'potion'
  | 'elixir'
  | 'recipe'
  | 'material'
  | 'enemy'
  | 'encounterScenario'
  | 'spellLabScenario'
  | 'cookReport';

export type ContentDependencyKind = ContentKind | 'code' | 'test' | 'probe' | 'cell' | 'status';
export type ContentStatus = 'live' | 'review' | 'experimental' | 'deprecated' | 'editorOnly';

export interface ContentDependency {
  kind: ContentDependencyKind;
  id: string;
  reason: string;
}

export interface ContentValidationSummary {
  errors: number;
  warnings: number;
  infos: number;
  messages: string[];
  lastCheckedAt?: string;
}

export interface ContentItem<TPayload = unknown> {
  id: string;
  kind: ContentKind;
  name: string;
  description: string;
  tags: string[];
  status: ContentStatus;
  source: string;
  dependencies: ContentDependency[];
  validation: ContentValidationSummary;
  payload: TPayload;
}

export function isAssetContentKind(kind: ContentDependencyKind): kind is ContentKind {
  return (
    kind === 'card' ||
    kind === 'modifier' ||
    kind === 'wandFrame' ||
    kind === 'wandLoadout' ||
    kind === 'potion' ||
    kind === 'elixir' ||
    kind === 'recipe' ||
    kind === 'material' ||
    kind === 'enemy' ||
    kind === 'encounterScenario' ||
    kind === 'spellLabScenario' ||
    kind === 'cookReport'
  );
}
