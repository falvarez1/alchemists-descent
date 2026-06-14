import type { DocIssue } from '@/builder/validate';
import { escapeHtml } from '@/ui/editor/Fields';

export function renderIssueRows(issues: DocIssue[]): string {
  return issues
    .map(
      (issue, index) =>
        `<div class="b-issue ${issue.severity}" data-n="${index}">[${issue.severity
          .slice(0, 4)
          .toUpperCase()}] ${escapeHtml(issue.what)}</div>`,
    )
    .join('');
}
