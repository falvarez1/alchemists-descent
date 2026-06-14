export type FocusSurface =
  | 'app-dialog'
  | 'builder-help'
  | 'command-palette'
  | 'menu'
  | 'interactive-popover'
  | 'console-input'
  | 'text-entry'
  | 'console-open'
  | 'builder-workspace'
  | 'game';

export interface FocusRouterState {
  appDialogOpen?: boolean;
  builderHelpOpen?: boolean;
  commandPaletteOpen?: boolean;
  menuOpen?: boolean;
  interactivePopoverOpen?: boolean;
  consoleOpen?: boolean;
  consoleInputFocused?: boolean;
  builderOpen?: boolean;
  target?: EventTarget | null;
}

export interface FocusClaimResult {
  claimed: boolean;
  surface: FocusSurface;
  reason: string;
}

export class FocusRouter {
  claimKeyDown(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey'>, state: FocusRouterState): FocusClaimResult {
    return this.claimKey(event, state);
  }

  claimKeyUp(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey'>, state: FocusRouterState): FocusClaimResult {
    return this.claimKey(event, state);
  }

  isTextEntryTarget(target: EventTarget | null): boolean {
    return isEditorTextEntryTarget(target);
  }

  activeSurface(state: FocusRouterState): FocusSurface {
    if (state.appDialogOpen) return 'app-dialog';
    if (state.builderHelpOpen) return 'builder-help';
    if (state.commandPaletteOpen) return 'command-palette';
    if (state.menuOpen) return 'menu';
    if (state.interactivePopoverOpen) return 'interactive-popover';
    if (state.consoleInputFocused) return 'console-input';
    if (isEditorTextEntryTarget(state.target ?? null)) return 'text-entry';
    if (state.consoleOpen) return 'console-open';
    if (state.builderOpen) return 'builder-workspace';
    return 'game';
  }

  private claimKey(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey'>, state: FocusRouterState): FocusClaimResult {
    const surface = this.activeSurface(state);
    if (surface === 'console-open' && state.builderOpen && isPlainBuilderHelpKey(event)) {
      return {
        claimed: false,
        surface: 'builder-workspace',
        reason: 'Builder workspace may open help while console is unfocused',
      };
    }
    if (surface === 'builder-workspace' || surface === 'game') {
      return { claimed: false, surface, reason: `${surface} owns unclaimed input` };
    }
    return { claimed: true, surface, reason: `${surface} has input priority` };
  }
}

export function isEditorTextEntryTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.closest?.('[contenteditable="true"]')) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  const type =
    typeof input.getAttribute === 'function' ? (input.getAttribute('type') ?? 'text').toLowerCase() : 'text';
  return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(type);
}

function isPlainBuilderHelpKey(event: Pick<KeyboardEvent, 'code' | 'altKey' | 'ctrlKey' | 'metaKey'>): boolean {
  return event.code === 'KeyH' && !event.altKey && !event.ctrlKey && !event.metaKey;
}
