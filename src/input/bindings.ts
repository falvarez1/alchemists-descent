export const DEFAULT_BINDINGS = {
  left: 'KeyA', right: 'KeyD', up: 'KeyW', down: 'KeyS', jump: 'Space',
  climb: 'ShiftLeft', interact: 'KeyE', pour: 'KeyQ', drink: 'KeyX', kick: 'KeyF', carry: 'KeyG', lure: 'KeyV',
  clip: 'KeyP', lantern: 'KeyL',
} as const;
export type BindingAction = keyof typeof DEFAULT_BINDINGS;
type Bindings = Record<BindingAction, string>;
const KEY = 'ad-controls-v1';
let cached: Bindings | undefined;
/**
 * Actions added after players already had saved layouts. A saved map that
 * predates one may already use its default key for something else; the new
 * action then takes a free spare key instead of invalidating the whole layout.
 */
const LATE_ACTIONS: readonly BindingAction[] = ['clip', 'lantern'];
const SPARE_KEYS = ['KeyP', 'KeyK', 'KeyL', 'KeyO', 'KeyU', 'KeyY', 'KeyT', 'KeyN', 'KeyZ'];

function allowed(code: unknown): code is string {
  return typeof code === 'string' && /^(Key[A-Z]|Space|ShiftLeft|ShiftRight|Arrow(Left|Right|Up|Down))$/.test(code) &&
    !['KeyH', 'KeyB', 'KeyJ', 'KeyM', 'KeyI', 'KeyR'].includes(code);
}

export function sanitizeBindings(value: unknown): Bindings {
  const result: Bindings = { ...DEFAULT_BINDINGS };
  if (!value || typeof value !== 'object') return result;
  for (const action of Object.keys(DEFAULT_BINDINGS) as BindingAction[]) {
    const code = (value as Partial<Bindings>)[action];
    if (allowed(code)) result[action] = code;
  }
  for (const action of LATE_ACTIONS) {
    if (allowed((value as Partial<Bindings>)[action])) continue;
    const taken = (code: string): boolean => Object.entries(result).some(([other, c]) => other !== action && c === code);
    if (taken(result[action])) result[action] = SPARE_KEYS.find((code) => !taken(code)) ?? result[action];
  }
  // Reject the whole malformed map rather than silently bind two actions to
  // one key when an invalid entry falls back to somebody else's default.
  return new Set(Object.values(result)).size === Object.keys(result).length ? result : { ...DEFAULT_BINDINGS };
}

export function getBindings(): Bindings {
  if (!cached) {
    cached = { ...DEFAULT_BINDINGS };
    try {
      cached = sanitizeBindings(JSON.parse(localStorage.getItem(KEY) ?? '{}'));
    } catch { /* Restricted storage keeps the standard controls. */ }
  }
  return { ...cached };
}

export function setBinding(action: BindingAction, code: string): string | null {
  if (!allowed(code)) return 'That key is reserved for a menu or the browser.';
  const bindings = getBindings();
  for (const [other, value] of Object.entries(bindings)) {
    if (other !== action && value === code) return `Already assigned to ${other}. Choose another key.`;
  }
  bindings[action] = code;
  cached = bindings;
  try { localStorage.setItem(KEY, JSON.stringify(bindings)); } catch { return 'Controls changed for this session; storage is unavailable.'; }
  return null;
}

export function resetBindings(): void {
  cached = { ...DEFAULT_BINDINGS };
  try { localStorage.removeItem(KEY); } catch { /* Session reset still applies. */ }
}

export function keyLabel(code: string): string {
  return code.replace('Key', '').replace('Arrow', '').replace('ShiftLeft', 'Shift').replace('ShiftRight', 'Right Shift');
}

/**
 * The flask belt answers to the digit row after the two wands (1, 2): slot 0
 * is key 3. Every player-facing flask name uses the KEY, so the toast for
 * pressing 5 names the same flask the HUD labels 5.
 */
export function flaskSlotKey(index: number): string {
  return String(index + 3);
}

/** Translate once at the input boundary; all gameplay keeps canonical action codes. */
export function gameplayCode(code: string): string {
  const bindings = getBindings();
  for (const action of Object.keys(DEFAULT_BINDINGS) as BindingAction[]) {
    if (bindings[action] === code) return DEFAULT_BINDINGS[action];
  }
  if ((Object.values(DEFAULT_BINDINGS) as string[]).includes(code)) return 'Unbound';
  return code;
}
