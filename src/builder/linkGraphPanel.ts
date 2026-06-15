import type { DocIssue } from '@/builder/validate';
import { assessEditorLink } from '@/builder/validate';
import type { EditorDocument, EditorLink, EditorObject } from '@/builder/document';
import { builderPanelHeader } from '@/ui/editor/PanelChrome';
import { builderPanelTitle } from '@/ui/editor/PanelRegistry';
import { editorSectionHtml } from '@/ui/editor/Section';

export interface LinkGraphEndpoint {
  id: string;
  kind: string;
  label: string;
  hidden: boolean;
  locked: boolean;
  issues: DocIssue[];
}

export interface LinkGraphLinkRow {
  id: string;
  link: EditorLink;
  from: LinkGraphEndpoint | null;
  to: LinkGraphEndpoint | null;
  live: boolean;
  severity: 'error' | 'warning' | 'info' | null;
  messages: string[];
  sequenceIndex: number | null;
  selected: boolean;
  searchText: string;
}

export interface LinkGraphActuatorRow {
  id: string;
  endpoint: LinkGraphEndpoint;
  logic: string;
  inputs: LinkGraphLinkRow[];
  outputs: LinkGraphLinkRow[];
  relay: boolean;
  selected: boolean;
  severity: 'error' | 'warning' | 'info' | null;
  messages: string[];
  searchText: string;
}

export interface LinkGraphModel {
  query: string;
  links: LinkGraphLinkRow[];
  visibleLinks: LinkGraphLinkRow[];
  actuators: LinkGraphActuatorRow[];
  visibleActuators: LinkGraphActuatorRow[];
  counts: {
    links: number;
    live: number;
    dead: number;
    errors: number;
    warnings: number;
    actuators: number;
  };
  collapsedSections?: Readonly<Record<string, boolean>>;
}

export interface BuildLinkGraphOptions {
  doc: EditorDocument;
  issues: readonly DocIssue[];
  selectedIds: ReadonlySet<string>;
  query?: string;
  collapsedSections?: Readonly<Record<string, boolean>>;
}

const ACTUATOR_ROW_KINDS = new Set(['door', 'valve', 'relay', 'runeDoor', 'plug']);

export function buildLinkGraphModel(options: BuildLinkGraphOptions): LinkGraphModel {
  const query = normalizeSearch(options.query ?? '');
  const objectsById = new Map(options.doc.objects.map((object) => [object.id, object]));
  const issuesById = issuesByObjectId(options.issues);
  const incoming = new Map<string, LinkGraphLinkRow[]>();
  const outgoing = new Map<string, LinkGraphLinkRow[]>();
  const sequenceIndexes = sequenceIndexMap(options.doc);
  const linkRows = options.doc.links.map((link) => {
    const fromObject = objectsById.get(link.fromId) ?? null;
    const toObject = objectsById.get(link.toId) ?? null;
    const from = fromObject ? endpoint(fromObject, issuesById.get(fromObject.id) ?? []) : null;
    const to = toObject ? endpoint(toObject, issuesById.get(toObject.id) ?? []) : null;
    const assessed = assessEditorLink(link, fromObject, toObject);
    const selected = options.selectedIds.has(link.fromId) || options.selectedIds.has(link.toId);
    const row: LinkGraphLinkRow = {
      id: link.id,
      link,
      from,
      to,
      live: assessed.live,
      severity: assessed.severity,
      messages: assessed.messages,
      sequenceIndex: sequenceIndexes.get(link.id) ?? null,
      selected,
      searchText: normalizeSearch([
        link.id,
        link.kind,
        link.fromId,
        link.toId,
        from?.kind ?? '',
        to?.kind ?? '',
        assessed.messages.join(' '),
      ].join(' ')),
    };
    if (from) pushMap(outgoing, from.id, row);
    if (to) pushMap(incoming, to.id, row);
    return row;
  });

  const actuators = options.doc.objects
    .filter((object) => ACTUATOR_ROW_KINDS.has(object.kind))
    .map((object) => {
      const endpointRow = endpoint(object, issuesById.get(object.id) ?? []);
      const inputs = incoming.get(object.id) ?? [];
      const outputs = outgoing.get(object.id) ?? [];
      const issueMessages = endpointRow.issues.map((issue) => issue.what);
      const severity = strongestSeverity([
        ...inputs.map((row) => row.severity),
        ...outputs.map((row) => row.severity),
        ...endpointRow.issues.map((issue) => issue.severity),
      ]);
      return {
        id: object.id,
        endpoint: endpointRow,
        logic: String(object.params.logic ?? (object.kind === 'runeDoor' ? 'rune' : 'and')),
        inputs,
        outputs,
        relay: object.kind === 'relay',
        selected: options.selectedIds.has(object.id),
        severity,
        messages: issueMessages,
        searchText: normalizeSearch([
          object.id,
          object.kind,
          String(object.params.logic ?? ''),
          ...inputs.map((row) => row.searchText),
          ...outputs.map((row) => row.searchText),
          ...issueMessages,
        ].join(' ')),
      } satisfies LinkGraphActuatorRow;
    });

  const visibleLinks = linkRows.filter((row) => !query || row.searchText.includes(query));
  const visibleActuators = actuators.filter((row) => !query || row.searchText.includes(query));
  return {
    query: options.query ?? '',
    links: linkRows,
    visibleLinks,
    actuators,
    visibleActuators,
    counts: {
      links: linkRows.length,
      live: linkRows.filter((row) => row.live).length,
      dead: linkRows.filter((row) => !row.live).length,
      errors: linkRows.filter((row) => row.severity === 'error').length,
      warnings: linkRows.filter((row) => row.severity === 'warning').length,
      actuators: actuators.length,
    },
    collapsedSections: options.collapsedSections,
  };
}

export function renderLinkGraphPanel(model: LinkGraphModel): string {
  const actuatorRows = model.visibleActuators.length > 0
    ? model.visibleActuators.map(renderActuator).join('')
    : '<div class="bo-empty b-empty">No matching actuators</div>';
  const brokenRows = model.visibleLinks
    .filter((row) => row.severity !== null || !row.live)
    .map(renderLink)
    .join('');
  const allRows = model.visibleLinks.length > 0
    ? model.visibleLinks.map(renderLink).join('')
    : '<div class="bo-empty b-empty">No matching links</div>';
  return `
    ${builderPanelHeader({ title: builderPanelTitle('builder-link-graph'), closeId: 'blg-close', closeLabel: 'Close link graph' })}
    <div class="bo-summary">${model.counts.links} links - ${model.counts.live} live - ${model.counts.dead} dead - ${model.counts.actuators} actuators</div>
    <div class="bo-search"><input id="blg-search" class="editor-search" type="search" spellcheck="false" placeholder="search endpoints, links, warnings" value="${escAttr(model.query)}"></div>
    ${section(model, 'linkGraph.actuators', 'Actuators', `
      <div class="blg-actuators" role="listbox">${actuatorRows}</div>
    `)}
    ${section(model, 'linkGraph.invalid', 'Dead Or Invalid Links', `
      <div class="blg-links" role="listbox">${brokenRows || '<div class="bo-empty b-empty">No dead links</div>'}</div>
    `)}
    ${section(model, 'linkGraph.all', 'All Links', `
      <div class="blg-links" role="listbox">${allRows}</div>
    `)}`;
}

function section(model: LinkGraphModel, id: string, title: string, body: string): string {
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

function renderActuator(row: LinkGraphActuatorRow): string {
  const messages = row.messages.length > 0 ? `<div class="blg-msg">${esc(row.messages.join(' | '))}</div>` : '';
  const inputText = row.inputs.length === 0
    ? 'no inputs'
    : row.inputs.map((input) => `${input.sequenceIndex ? `${input.sequenceIndex}. ` : ''}${input.from?.kind ?? 'missing'}`).join(', ');
  const outputText = row.outputs.length === 0 ? 'no outputs' : row.outputs.map((output) => output.to?.kind ?? 'missing').join(', ');
  return `<div class="blg-actuator${row.selected ? ' selected' : ''}${row.severity ? ` ${row.severity}` : ''}" role="option" tabindex="0" aria-selected="${row.selected ? 'true' : 'false'}" data-select-id="${escAttr(row.endpoint.id)}" data-frame-id="${escAttr(row.endpoint.id)}">
    <div class="bo-row-title">${esc(row.endpoint.label)} <span class="bo-badge">${esc(row.logic.toUpperCase())}</span>${row.relay ? '<span class="bo-badge">relay</span>' : ''}</div>
    <div class="bo-row-sub">in: ${esc(inputText)}</div>
    <div class="bo-row-sub">out: ${esc(outputText)}</div>
    ${messages}
  </div>`;
}

function renderLink(row: LinkGraphLinkRow): string {
  const status = row.severity ?? (row.live ? 'live' : 'dead');
  const messages = row.messages.length > 0 ? `<div class="blg-msg">${esc(row.messages.join(' | '))}</div>` : '';
  const sequence = row.sequenceIndex ? `<span class="bo-badge">seq ${row.sequenceIndex}</span>` : '';
  return `<div class="blg-link${row.selected ? ' selected' : ''}${row.severity ? ` ${row.severity}` : ''}" role="option" tabindex="0" aria-selected="${row.selected ? 'true' : 'false'}" data-link-id="${escAttr(row.id)}" data-select-id="${escAttr(row.to?.id ?? row.from?.id ?? '')}" data-frame-id="${escAttr(row.to?.id ?? row.from?.id ?? '')}">
    <div class="bo-row-title">${esc(row.from?.label ?? `Missing ${row.link.fromId}`)} -&gt; ${esc(row.to?.label ?? `Missing ${row.link.toId}`)}</div>
    <div class="bo-row-sub">${esc(row.link.kind)} - ${esc(row.id)} <span class="bo-badge">${esc(status)}</span>${sequence}</div>
    ${messages}
    <div class="bo-row-actions">
      ${row.from ? `<button type="button" data-select-id="${escAttr(row.from.id)}">Source</button>` : ''}
      ${row.to ? `<button type="button" data-select-id="${escAttr(row.to.id)}">Target</button>` : ''}
      <button type="button" class="b-danger" aria-label="Unlink" data-unlink="${escAttr(row.id)}">Unlink</button>
    </div>
  </div>`;
}

function endpoint(object: EditorObject, issues: DocIssue[]): LinkGraphEndpoint {
  return {
    id: object.id,
    kind: object.kind,
    label: `${object.kind} (${object.id})`,
    hidden: object.hidden,
    locked: object.locked,
    issues,
  };
}

function sequenceIndexMap(doc: EditorDocument): Map<string, number> {
  const map = new Map<string, number>();
  const byTarget = new Map<string, EditorLink[]>();
  const byId = new Map(doc.objects.map((object) => [object.id, object]));
  for (const link of doc.links) {
    if (link.kind !== 'triggerDoor') continue;
    const target = byId.get(link.toId);
    if (!target || target.params.logic !== 'sequence') continue;
    pushMap(byTarget, link.toId, link);
  }
  for (const links of byTarget.values()) {
    links.forEach((link, index) => map.set(link.id, index + 1));
  }
  return map;
}

function issuesByObjectId(issues: readonly DocIssue[]): Map<string, DocIssue[]> {
  const map = new Map<string, DocIssue[]>();
  for (const issue of issues) {
    if (!issue.objId) continue;
    pushMap(map, issue.objId, issue);
  }
  return map;
}

function pushMap<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function strongestSeverity(values: Array<'error' | 'warning' | 'info' | null>): 'error' | 'warning' | 'info' | null {
  if (values.includes('error')) return 'error';
  if (values.includes('warning')) return 'warning';
  if (values.includes('info')) return 'info';
  return null;
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
