import type { CommandResult } from '@/core/types';
import type { HelpRow } from '@/game/console/help';

/**
 * The console's help pages as DOM: the rows `help` returns (game/console/help)
 * laid out in two columns (the command and its arguments, then what it does)
 * that wrap at any width. The plain text is still the result's `text`; this is
 * only its presentation, so a narrow console never breaks the alignment.
 */

const ROW_KINDS = new Set(['text', 'gap', 'heading', 'command', 'field', 'code']);

/** The rows of a help result, or null when the result is anything else. */
export function helpRowsOf(res: CommandResult): HelpRow[] | null {
  const data = res.data;
  if (!res.ok || typeof data !== 'object' || data === null) return null;
  const { action, rows } = data as { action?: unknown; rows?: unknown };
  if (action !== 'help' || !Array.isArray(rows)) return null;
  const valid = rows.every((row) => typeof row === 'object' && row !== null && ROW_KINDS.has((row as { kind?: unknown }).kind as string));
  return valid ? (rows as HelpRow[]) : null;
}

function span(className: string, text: string): HTMLElement {
  const el = document.createElement('span');
  el.className = className;
  el.textContent = text;
  return el;
}

function cell(className: string, ...children: Array<Node | string>): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  el.append(...children);
  return el;
}

export function renderHelpRows(rows: readonly HelpRow[]): HTMLElement {
  const block = document.createElement('div');
  block.className = 'dch-block';
  for (const row of rows) {
    switch (row.kind) {
      case 'text':
        block.append(cell('dch-wide dch-text', row.text));
        break;
      case 'gap':
        block.append(cell('dch-wide dch-gap'));
        break;
      case 'heading':
        block.append(cell('dch-wide dch-heading', span('dch-title', row.title), ...(row.hint ? [span('dch-hint', row.hint)] : [])));
        break;
      case 'command':
        block.append(
          cell('dch-left', span('dch-name', row.name), ...(row.args ? [' ', span('dch-args', row.args)] : [])),
          cell('dch-right', row.summary, ...(row.taints ? [' ', span('dch-taints', 'taints')] : [])),
        );
        break;
      case 'field':
        block.append(cell('dch-left dch-label', row.label), cell('dch-right', row.text));
        break;
      case 'code':
        block.append(cell('dch-wide dch-code', row.text));
        break;
    }
  }
  return block;
}
