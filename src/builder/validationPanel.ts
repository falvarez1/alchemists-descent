import type { DocIssue } from '@/builder/validate';
import { validationRepairActions } from '@/builder/validationActions';
import { escapeAttr, escapeHtml } from '@/ui/editor/Fields';

const GROUPS: Array<{ severity: DocIssue['severity']; label: string }> = [
  { severity: 'error', label: 'Errors' },
  { severity: 'warning', label: 'Warnings' },
  { severity: 'info', label: 'Info' },
];

export interface ValidationPanelOptions {
  playtestBlockers?: readonly DocIssue[];
}

export function renderValidationPanel(issues: DocIssue[], options: ValidationPanelOptions = {}): string {
  const indexed = issues.map((issue, index) => ({ issue, index }));
  const blockerKeys = new Set((options.playtestBlockers ?? []).map(issueKey));
  const groups = GROUPS
    .map((group) =>
      renderGroup(
        group.label,
        indexed.filter(({ issue }) => issue.severity === group.severity),
        blockerKeys,
      ),
    )
    .join('');
  const blockerBanner =
    blockerKeys.size > 0
      ? `<div class="bv-blocker" data-playtest-blockers="${blockerKeys.size}">
          <strong>PLAYTEST BLOCKED</strong>
          <span>${blockerKeys.size} compile blocker${blockerKeys.size === 1 ? '' : 's'} must be repaired first.</span>
        </div>`
      : '';
  return `<div class="bi-head" data-panel-handle>VALIDATION <button id="b-issues-close" type="button">&times;</button></div>
    ${blockerBanner}
    <div class="bv-summary">${issues.length} issue${issues.length === 1 ? '' : 's'} - ${count(issues, 'error')} errors - ${count(issues, 'warning')} warnings</div>
    <div class="bv-filters" role="tablist" aria-label="Validation filters">
      ${filterButton('all', 'All', 'All issues', issues.length, true)}
      ${filterButton('error', 'Err', 'Errors', count(issues, 'error'))}
      ${filterButton('warning', 'Warn', 'Warnings', count(issues, 'warning'))}
      ${filterButton('info', 'Info', 'Info', count(issues, 'info'))}
    </div>
    <div class="bv-groups">${groups}</div>`;
}

function renderGroup(
  label: string,
  issues: Array<{ issue: DocIssue; index: number }>,
  blockerKeys: ReadonlySet<string>,
): string {
  if (issues.length === 0) return '';
  const severity = issues[0]?.issue.severity ?? 'info';
  return `<section class="bv-group" data-validation-group="${escapeAttr(severity)}">
    <div class="bv-group-title">${escapeHtml(label)} <span>${issues.length}</span></div>
    ${issues.map(({ issue, index }) => renderIssueRow(issue, index, blockerKeys.has(issueKey(issue)))).join('')}
  </section>`;
}

function renderIssueRow(issue: DocIssue, index: number, playtestBlocker: boolean): string {
  const actions = validationRepairActions(issue)
    .map((action) => {
      const kind = action.mutatesDocument ? 'mutate' : 'inspect';
      const title = action.mutatesDocument ? 'Undoable document repair' : 'View or select without changing the document';
      return `<button type="button" class="bv-action ${kind}" title="${escapeAttr(title)}" data-validation-action="${escapeAttr(action.id)}" data-action-kind="${kind}" data-mutates-document="${action.mutatesDocument ? 'true' : 'false'}"><span aria-hidden="true"></span>${escapeHtml(action.label)}</button>`;
    })
    .join('');
  const code = issue.code ? `<span class="bv-code">${escapeHtml(issue.code)}</span>` : '';
  const loc = issue.location ? `<span class="bv-loc">${Math.round(issue.location.x)},${Math.round(issue.location.y)}</span>` : '';
  const objIds = issue.objIds ?? (issue.objId ? [issue.objId] : []);
  const classes = ['b-issue', 'bv-issue', issue.severity, playtestBlocker ? 'playtest-blocker' : ''].filter(Boolean).join(' ');
  return `<div class="${classes}" role="button" tabindex="0" aria-label="${escapeAttr(issue.severity + ': ' + issue.what)}" data-n="${index}" data-issue-code="${escapeAttr(issue.code ?? '')}" data-issue-obj="${escapeAttr(issue.objId ?? '')}" data-issue-objs="${escapeAttr(objIds.join(','))}" data-issue-link="${escapeAttr(issue.linkId ?? '')}"${playtestBlocker ? ' data-playtest-blocker="true"' : ''}>
    <div class="bv-main">
      <div class="bv-title">[${issue.severity.slice(0, 4).toUpperCase()}] ${escapeHtml(issue.what)}</div>
      <div class="bv-meta">${code}${loc}</div>
    </div>
    ${actions ? `<div class="bv-actions">${actions}</div>` : ''}
  </div>`;
}

function count(issues: readonly DocIssue[], severity: DocIssue['severity']): number {
  return issues.filter((issue) => issue.severity === severity).length;
}

function filterButton(id: string, label: string, ariaLabel: string, n: number, active = false): string {
  return `<button type="button" data-validation-filter="${escapeAttr(id)}" aria-label="${escapeAttr(ariaLabel)}" aria-pressed="${active ? 'true' : 'false'}">${escapeHtml(label)} <span>${n}</span></button>`;
}

function issueKey(issue: DocIssue): string {
  return [issue.code ?? '', issue.objId ?? '', issue.linkId ?? '', issue.what].join('|');
}
