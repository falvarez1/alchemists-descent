import type { DocIssue } from '@/builder/validate';
import { assessEditorLink } from '@/builder/validate';
import type { EditorDocument, EditorLight, EditorLink, EditorObject, EditorObjectKind } from '@/builder/document';
import type { PrefabDef } from '@/builder/prefablib';
import type { SpriteAsset } from '@/builder/assets/sprites';
import { builderPanelHeader } from '@/ui/editor/PanelChrome';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';
import { editorSectionHtml } from '@/ui/editor/Section';

export type OutlinerFilter =
  | 'gameplay'
  | 'mechanisms'
  | 'machines'
  | 'lights'
  | 'decor'
  | 'hidden'
  | 'locked'
  | 'invalid'
  | 'selected';

export interface OutlinerLayerState {
  id: 'gameplay' | 'mech' | 'links' | 'lights';
  label: string;
  hidden: boolean;
  locked: boolean;
  count: number;
}

export interface OutlinerRow {
  id: string;
  type: 'group' | 'object' | 'light' | 'link' | 'prefab';
  label: string;
  sublabel: string;
  category: string;
  selectId?: string;
  selectIds?: string[];
  frameId?: string;
  objectId?: string;
  lightId?: string;
  linkId?: string;
  hidden: boolean;
  locked: boolean;
  selected: boolean;
  invalid: boolean;
  issueSeverity?: DocIssue['severity'];
  issueText?: string;
  badges: string[];
  filters: Set<OutlinerFilter>;
  searchText: string;
}

export interface OutlinerModel {
  query: string;
  filters: Set<OutlinerFilter>;
  rows: OutlinerRow[];
  visibleRows: OutlinerRow[];
  layers: OutlinerLayerState[];
  counts: {
    objects: number;
    lights: number;
    links: number;
    groups: number;
    prefabs: number;
    invalid: number;
    hidden: number;
    locked: number;
  };
  collapsedSections?: Readonly<Record<string, boolean>>;
}

export interface BuildOutlinerOptions {
  doc: EditorDocument;
  issues: readonly DocIssue[];
  selectedIds: ReadonlySet<string>;
  sprites?: readonly SpriteAsset[];
  documentSprites?: readonly SpriteAsset[];
  prefabs?: readonly PrefabDef[];
  query?: string;
  filters?: ReadonlySet<OutlinerFilter> | readonly OutlinerFilter[];
  layers?: readonly OutlinerLayerState[];
  collapsedSections?: Readonly<Record<string, boolean>>;
}

const FILTER_LABELS: Array<{ id: OutlinerFilter; label: string }> = [
  { id: 'gameplay', label: 'Gameplay' },
  { id: 'mechanisms', label: 'Mechanisms' },
  { id: 'machines', label: 'Machines' },
  { id: 'lights', label: 'Lights' },
  { id: 'decor', label: 'Decor' },
  { id: 'hidden', label: 'Hidden' },
  { id: 'locked', label: 'Locked' },
  { id: 'invalid', label: 'Invalid' },
  { id: 'selected', label: 'Selected' },
];

const MACHINE_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'valve',
  'plug',
  'sensor',
  'counterweight',
  'relay',
] as EditorObjectKind[]);

const MECHANISM_KINDS: ReadonlySet<EditorObjectKind> = new Set([
  'door',
  'plate',
  'lever',
  'brazier',
  'scale',
  'buoy',
  'chargeLatch',
  'runeGlyph',
  'runeDoor',
  ...MACHINE_KINDS,
] as EditorObjectKind[]);

export function buildOutlinerModel(options: BuildOutlinerOptions): OutlinerModel {
  const query = normalizeSearch(options.query ?? '');
  const filters = toFilterSet(options.filters);
  const issuesById = issuesByObjectId(options.issues);
  const spriteNames = spriteNameMap(options.sprites ?? [], options.documentSprites ?? []);
  const rows: OutlinerRow[] = [];

  rows.push(...groupRows(options.doc.objects, options.selectedIds, issuesById));
  for (const object of options.doc.objects) {
    rows.push(objectRow(object, options.selectedIds, issuesById, spriteNames));
  }
  for (const light of options.doc.lights) {
    rows.push(lightRow(light, options.selectedIds, issuesById));
  }
  for (const link of options.doc.links) {
    rows.push(linkRow(link, options.doc, options.selectedIds, issuesById));
  }
  for (const prefab of options.prefabs ?? []) {
    rows.push(prefabRow(prefab));
  }

  const visibleRows = rows.filter((row) => rowMatches(row, query, filters));
  return {
    query: options.query ?? '',
    filters,
    rows,
    visibleRows,
    layers: [...(options.layers ?? [])],
    counts: {
      objects: options.doc.objects.length,
      lights: options.doc.lights.length,
      links: options.doc.links.length,
      groups: rows.filter((row) => row.type === 'group').length,
      prefabs: options.prefabs?.length ?? 0,
      invalid: rows.filter((row) => row.invalid).length,
      hidden: options.doc.objects.filter((object) => object.hidden).length + options.doc.lights.filter((light) => light.hidden).length,
      locked: options.doc.objects.filter((object) => object.locked).length + options.doc.lights.filter((light) => light.locked).length,
    },
    collapsedSections: options.collapsedSections,
  };
}

export function renderOutlinerPanel(model: OutlinerModel): string {
  const chips = FILTER_LABELS.map(({ id, label }) => {
    const active = model.filters.has(id);
    return `<button type="button" class="bo-chip${active ? ' active' : ''}" data-outliner-filter="${id}" aria-pressed="${active ? 'true' : 'false'}">${esc(label)}</button>`;
  }).join('');
  const layerRows = model.layers.map(renderLayerRow).join('');
  const rows = model.visibleRows.length > 0
    ? model.visibleRows.map(renderOutlinerRow).join('')
    : '<div class="bo-empty b-empty">No matching rows</div>';
  const header = builderPanelHeader({
    title: builderPanelTitle('builder-outliner'),
    closeId: 'bo-close',
    closeLabel: 'Close object outliner',
  });
  return `
    ${header}
    <div class="bo-summary">${model.counts.objects} objects - ${model.counts.lights} lights - ${model.counts.links} links</div>
    <div class="bo-search"><input id="bo-search" type="search" class="editor-search" spellcheck="false" placeholder="search objects, links, params" value="${escAttr(model.query)}"></div>
    <div class="bo-chips">${chips}</div>
    ${section(model, 'outliner.layers', 'Layer Manager', `
      <div class="bo-layers">${layerRows}</div>
    `)}
    ${section(model, 'outliner.rows', 'Document Rows', `
      <div class="bo-rows" role="listbox">${rows}</div>
    `)}`;
}

function section(model: OutlinerModel, id: string, title: string, body: string): string {
  return editorSectionHtml({
    id,
    title,
    body,
    className: 'bo-section',
    titleClassName: 'bo-section-title',
    bodyClassName: 'bo-section-body',
    collapsed: model.collapsedSections?.[id] === true,
  });
}

function renderLayerRow(layer: OutlinerLayerState): string {
  return `<div class="bo-layer${layer.hidden ? ' off' : ''}${layer.locked ? ' locked' : ''}" data-layer="${layer.id}">
    <span>${esc(layer.label)}</span>
    <b>${layer.count}</b>
    <button type="button" data-layer-vis="${layer.id}" data-command-id="builder.layer.${layer.id}.visibility" aria-pressed="${layer.hidden ? 'true' : 'false'}" title="Show or hide this editor layer">${layer.hidden ? 'Show' : 'Hide'}</button>
    <button type="button" data-layer-lock="${layer.id}" data-command-id="builder.layer.${layer.id}.lock" aria-pressed="${layer.locked ? 'true' : 'false'}" title="Lock or unlock this editor layer">${layer.locked ? 'Unlock' : 'Lock'}</button>
  </div>`;
}

function renderOutlinerRow(row: OutlinerRow): string {
  const badges = row.badges.map((badge) => `<span class="bo-badge">${esc(badge)}</span>`).join('');
  const selectAttr = row.selectId ? ` data-select-id="${escAttr(row.selectId)}"` : '';
  const selectIdsAttr = row.selectIds && row.selectIds.length > 0 ? ` data-select-ids="${escAttr(row.selectIds.join(','))}"` : '';
  const frameAttr = row.frameId ? ` data-frame-id="${escAttr(row.frameId)}"` : '';
  const linkAttr = row.linkId ? ` data-link-id="${escAttr(row.linkId)}"` : '';
  const issue = row.issueText ? `<div class="bo-row-issue">${esc(row.issueText)}</div>` : '';
  const objectToggle =
    row.objectId || row.lightId
      ? `<div class="bo-row-actions">
          <button type="button" data-row-toggle="hidden" data-row-id="${escAttr(row.objectId ?? row.lightId ?? '')}" data-row-kind="${row.objectId ? 'object' : 'light'}" data-command-id="builder.toggleSelectedHidden">${row.hidden ? 'Unhide' : 'Hide'}</button>
          <button type="button" data-row-toggle="locked" data-row-id="${escAttr(row.objectId ?? row.lightId ?? '')}" data-row-kind="${row.objectId ? 'object' : 'light'}" data-command-id="builder.toggleSelectedLocked">${row.locked ? 'Unlock' : 'Lock'}</button>
        </div>`
      : '';
  return `<div class="bo-row ${row.type}${row.selected ? ' selected' : ''}${row.invalid ? ' invalid' : ''}${row.hidden ? ' hidden-row' : ''}" role="option" tabindex="-1" aria-selected="${row.selected ? 'true' : 'false'}" data-row-type="${row.type}"${selectAttr}${selectIdsAttr}${frameAttr}${linkAttr}>
    <div class="bo-row-main">
      <div class="bo-row-title">${esc(row.label)}</div>
      <div class="bo-row-sub">${esc(row.sublabel)}</div>
      ${issue}
      <div class="bo-badges">${badges}</div>
    </div>
    ${objectToggle}
  </div>`;
}

function groupRows(
  objects: readonly EditorObject[],
  selectedIds: ReadonlySet<string>,
  issuesById: Map<string, DocIssue[]>,
): OutlinerRow[] {
  const groups = new Map<string, EditorObject[]>();
  for (const object of objects) {
    if (!object.group) continue;
    const rows = groups.get(object.group) ?? [];
    rows.push(object);
    groups.set(object.group, rows);
  }
  return [...groups.entries()].map(([group, members]) => {
    const selected = members.some((member) => selectedIds.has(member.id));
    const invalid = members.some((member) => issuesById.has(member.id));
    const filters = new Set<OutlinerFilter>();
    if (selected) filters.add('selected');
    if (invalid) filters.add('invalid');
    if (members.some((member) => member.hidden)) filters.add('hidden');
    if (members.some((member) => member.locked)) filters.add('locked');
    return {
      id: `group:${group}`,
      type: 'group',
      label: `Group ${group}`,
      sublabel: `${members.length} object${members.length === 1 ? '' : 's'}`,
      category: 'Group',
      selectId: members[0]?.id,
      selectIds: members.map((member) => member.id),
      frameId: members[0]?.id,
      hidden: members.every((member) => member.hidden),
      locked: members.every((member) => member.locked),
      selected,
      invalid,
      badges: ['group', `${members.length}`],
      filters,
      searchText: normalizeSearch([group, ...members.map((member) => member.id), ...members.map((member) => member.kind)].join(' ')),
    };
  });
}

function objectRow(
  object: EditorObject,
  selectedIds: ReadonlySet<string>,
  issuesById: Map<string, DocIssue[]>,
  spriteNames: Map<string, string>,
): OutlinerRow {
  const issue = strongestIssue(issuesById.get(object.id) ?? []);
  const category = objectCategory(object);
  const filters = new Set<OutlinerFilter>();
  filters.add(category.filter);
  if (object.hidden) filters.add('hidden');
  if (object.locked) filters.add('locked');
  if (selectedIds.has(object.id)) filters.add('selected');
  if (issue) filters.add('invalid');
  const label = objectLabel(object, spriteNames);
  const badges = [category.label, object.kind];
  if (object.group) badges.push('group');
  if (object.hidden) badges.push('hidden');
  if (object.locked) badges.push('locked');
  if (issue) badges.push(issue.severity);
  return {
    id: `object:${object.id}`,
    type: 'object',
    label,
    sublabel: `${object.id} @ ${Math.round(object.x)},${Math.round(object.y)}`,
    category: category.label,
    selectId: object.id,
    frameId: object.id,
    objectId: object.id,
    hidden: object.hidden,
    locked: object.locked,
    selected: selectedIds.has(object.id),
    invalid: issue !== undefined,
    issueSeverity: issue?.severity,
    issueText: issue?.what,
    badges,
    filters,
    searchText: normalizeSearch([
      object.id,
      object.kind,
      label,
      object.group ?? '',
      JSON.stringify(object.params),
      issue?.what ?? '',
      spriteNameForObject(object, spriteNames),
    ].join(' ')),
  };
}

function lightRow(
  light: EditorLight,
  selectedIds: ReadonlySet<string>,
  issuesById: Map<string, DocIssue[]>,
): OutlinerRow {
  const issue = strongestIssue(issuesById.get(light.id) ?? []);
  const filters = new Set<OutlinerFilter>(['lights']);
  if (light.hidden) filters.add('hidden');
  if (light.locked) filters.add('locked');
  if (selectedIds.has(light.id)) filters.add('selected');
  if (issue) filters.add('invalid');
  const badges = ['light', light.color];
  if (light.hidden) badges.push('hidden');
  if (light.locked) badges.push('locked');
  if (issue) badges.push(issue.severity);
  return {
    id: `light:${light.id}`,
    type: 'light',
    label: `Light ${light.color}`,
    sublabel: `${light.id} @ ${Math.round(light.x)},${Math.round(light.y)} r${Math.round(light.radius)}`,
    category: 'Light',
    selectId: light.id,
    frameId: light.id,
    lightId: light.id,
    hidden: light.hidden,
    locked: light.locked,
    selected: selectedIds.has(light.id),
    invalid: issue !== undefined,
    issueSeverity: issue?.severity,
    issueText: issue?.what,
    badges,
    filters,
    searchText: normalizeSearch([light.id, light.color, String(light.radius), issue?.what ?? ''].join(' ')),
  };
}

function linkRow(
  link: EditorLink,
  doc: EditorDocument,
  selectedIds: ReadonlySet<string>,
  issuesById: Map<string, DocIssue[]>,
): OutlinerRow {
  const from = doc.objects.find((object) => object.id === link.fromId);
  const to = doc.objects.find((object) => object.id === link.toId);
  const assessment = assessEditorLink(link, from ?? null, to ?? null);
  const linkIssues = assessment.issues.map((item): DocIssue => ({
    severity: item.severity,
    what: item.what,
    ...(item.objId ? { objId: item.objId } : {}),
  }));
  const relatedIssues = [
    ...linkIssues,
    ...(from ? issuesById.get(from.id) ?? [] : []),
    ...(to ? issuesById.get(to.id) ?? [] : []),
  ];
  const issue = strongestIssue(relatedIssues);
  const selected = (from && selectedIds.has(from.id)) || (to && selectedIds.has(to.id)) || false;
  const hidden = from?.hidden === true || to?.hidden === true;
  const locked = from?.locked === true || to?.locked === true;
  const filters = new Set<OutlinerFilter>();
  if (hidden) filters.add('hidden');
  if (locked) filters.add('locked');
  if (selected) filters.add('selected');
  if (issue || !from || !to || hidden || assessment.severity) filters.add('invalid');
  const label = `${from?.kind ?? 'missing'} -> ${to?.kind ?? 'missing'}`;
  const badges = ['link', link.kind];
  if (hidden) badges.push('dead');
  if (!from || !to) badges.push('missing');
  if (issue) badges.push(issue.severity);
  return {
    id: `link:${link.id}`,
    type: 'link',
    label,
    sublabel: `${link.id} ${link.fromId} -> ${link.toId}`,
    category: 'Link',
    selectId: to?.id ?? from?.id,
    frameId: to?.id ?? from?.id,
    linkId: link.id,
    hidden,
    locked,
    selected,
    invalid: issue !== undefined || !from || !to || hidden || assessment.severity !== null,
    issueSeverity: issue?.severity,
    issueText: issue?.what,
    badges,
    filters,
    searchText: normalizeSearch([
      link.id,
      link.kind,
      link.fromId,
      link.toId,
      label,
      issue?.what ?? '',
      assessment.messages.join(' '),
    ].join(' ')),
  };
}

function prefabRow(prefab: PrefabDef): OutlinerRow {
  const tags = prefab.tags.join(', ');
  return {
    id: `prefab:${prefab.id}`,
    type: 'prefab',
    label: prefab.name,
    sublabel: `${prefab.w}x${prefab.h} - ${prefab.objects.length} objects - ${prefab.links.length} links`,
    category: 'Prefab',
    hidden: false,
    locked: false,
    selected: false,
    invalid: false,
    badges: ['prefab', ...prefab.tags.slice(0, 3)],
    filters: new Set(),
    searchText: normalizeSearch([prefab.id, prefab.name, tags, `${prefab.w}x${prefab.h}`].join(' ')),
  };
}

function objectCategory(object: EditorObject): { label: string; filter: OutlinerFilter } {
  if (object.kind === 'decor') return { label: 'Decor', filter: 'decor' };
  if (MACHINE_KINDS.has(object.kind)) return { label: 'Machine', filter: 'machines' };
  if (MECHANISM_KINDS.has(object.kind)) return { label: 'Mechanism', filter: 'mechanisms' };
  return { label: 'Gameplay', filter: 'gameplay' };
}

function objectLabel(object: EditorObject, spriteNames: Map<string, string>): string {
  if (object.kind === 'enemy') return `Enemy: ${String(object.params.kind ?? 'slime')}`;
  if (object.kind === 'pickup') return `Pickup: ${String(object.params.kind ?? 'goldpile')}`;
  if (object.kind === 'decor') {
    const sprite = spriteNameForObject(object, spriteNames);
    if (sprite) return `Decor: ${sprite}`;
    return `Note: ${String(object.params.text ?? 'note')}`;
  }
  return object.kind;
}

function spriteNameForObject(object: EditorObject, spriteNames: Map<string, string>): string {
  const spriteId = typeof object.params.spriteId === 'string' ? object.params.spriteId : '';
  return spriteId ? spriteNames.get(spriteId) ?? spriteId : '';
}

function rowMatches(row: OutlinerRow, query: string, filters: ReadonlySet<OutlinerFilter>): boolean {
  if (query && !row.searchText.includes(query)) return false;
  for (const filter of filters) {
    if (!row.filters.has(filter)) return false;
  }
  return true;
}

function issuesByObjectId(issues: readonly DocIssue[]): Map<string, DocIssue[]> {
  const map = new Map<string, DocIssue[]>();
  for (const issue of issues) {
    if (!issue.objId) continue;
    const bucket = map.get(issue.objId) ?? [];
    bucket.push(issue);
    map.set(issue.objId, bucket);
  }
  return map;
}

function strongestIssue(issues: readonly DocIssue[]): DocIssue | undefined {
  return issues.find((issue) => issue.severity === 'error') ?? issues.find((issue) => issue.severity === 'warning') ?? issues[0];
}

function spriteNameMap(sprites: readonly SpriteAsset[], documentSprites: readonly SpriteAsset[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const sprite of [...documentSprites, ...sprites]) map.set(sprite.id, sprite.name);
  return map;
}

function toFilterSet(filters: BuildOutlinerOptions['filters']): Set<OutlinerFilter> {
  if (!filters) return new Set();
  return filters instanceof Set ? new Set(filters) : new Set(filters);
}

function normalizeSearch(value: string): string {
  return value.trim().toLowerCase();
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(value: string): string {
  return esc(value);
}
