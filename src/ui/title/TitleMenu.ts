import '@/styles/title-menu.css';
import { KIT_DEFS } from '@/content/kits';
import { cardIconName, makeIconCanvas } from '@/ui/icons';
import {
  keyHints,
  moveFocusIndex,
  type DetailSpec,
  type ItemIcon,
  type ItemKind,
  type MenuItem,
  type MenuPage,
} from '@/ui/title/titleMenuModel';

export type MenuCue = 'move' | 'step' | 'back' | 'refuse';

/**
 * The title screen's menu engine: a stack of pages, a list of items, a detail card for the focused one, a hint
 * line and the footer's key legend. It knows nothing about the game; ExpeditionEntry hands it pages
 * (ui/title/titleMenuModel) and it draws them, walks them with the keyboard (Up / Down / Home / End, Left /
 * Right on a choice row, Enter, Escape or Backspace for back) and with the mouse (hover focuses, click
 * confirms). The gamepad rides the same keys: InputManager dispatches them.
 *
 * Mouse hover is voiced by installUiSounds (every button gets a tick); keyboard moves make their own through
 * `cue`.
 */
export class TitleMenu {
  readonly root = document.createElement('div');
  /** The footer's key legend: the entry puts it in its footer. */
  readonly keys = document.createElement('div');
  private readonly pages = new Map<string, MenuPage>();
  private readonly bodies = new Map<string, HTMLElement>();
  /** The item each page last had focused: a page you came back to opens where you left it. */
  private readonly memory = new Map<string, string>();
  private readonly stack: string[] = [];
  private readonly stage = document.createElement('div');
  private readonly head = document.createElement('div');
  private readonly eyebrow = document.createElement('p');
  private readonly title = document.createElement('h2');
  private readonly body = document.createElement('div');
  private readonly list = document.createElement('nav');
  private readonly note = document.createElement('p');
  private readonly hint = document.createElement('p');
  private readonly detail = document.createElement('aside');
  private items: MenuItem[] = [];
  private focusedId = '';
  private detailKey = '';
  private pointer = { x: -1, y: -1 };
  private pointerMoved = false;
  /**
   * When a page changes under a resting pointer the browser replays a move at the same spot; that must not pull the
   * selection off the row the page opened on. Seen first (window, capture), it records whether this move went anywhere.
   */
  private readonly trackPointer = (event: PointerEvent): void => {
    this.pointerMoved = event.clientX !== this.pointer.x || event.clientY !== this.pointer.y;
    this.pointer = { x: event.clientX, y: event.clientY };
  };
  private pad = false;

  constructor(private readonly cue: (cue: MenuCue) => void = () => undefined) {
    this.root.className = 'tm';
    this.stage.className = 'tm-page';
    this.head.className = 'tm-page-head';
    this.eyebrow.className = 'tm-eyebrow';
    this.title.className = 'tm-title';
    this.title.id = 'tm-page-title';
    this.head.append(this.eyebrow, this.title);
    this.body.className = 'tm-body';
    this.list.className = 'tm-list';
    this.list.setAttribute('role', 'menu');
    this.list.setAttribute('aria-labelledby', 'expedition-title');
    this.note.className = 'tm-note';
    this.note.setAttribute('aria-live', 'polite');
    this.hint.className = 'tm-hint';
    this.hint.setAttribute('role', 'status');
    this.detail.className = 'tm-detail';
    this.detail.hidden = true;
    this.detail.setAttribute('aria-live', 'polite');
    this.stage.append(this.head, this.body, this.list, this.note, this.hint);
    this.root.append(this.stage, this.detail);
    this.keys.className = 'tm-keys';
    this.keys.setAttribute('aria-hidden', 'true');
    window.addEventListener('pointermove', this.trackPointer, { capture: true, passive: true });
    this.root.addEventListener('keydown', (event) => this.onKey(event));
    this.root.addEventListener('focusin', (event) => this.onFocusIn(event));
  }

  dispose(): void {
    window.removeEventListener('pointermove', this.trackPointer, { capture: true });
    this.root.remove();
    this.keys.remove();
  }

  get depth(): number { return Math.max(0, this.stack.length - 1); }
  get pageId(): string { return this.stack[this.stack.length - 1] ?? ''; }
  get focused(): string { return this.focusedId; }

  register(page: MenuPage): void {
    this.pages.set(page.id, page);
  }

  /** Is a gamepad driving? The key legend names its buttons instead. */
  setPad(pad: boolean): void {
    if (pad === this.pad) return;
    this.pad = pad;
    this.renderKeys(this.items.find((item) => item.id === this.focusedId)?.kind ?? null);
  }

  /** Back to a single page, no animation (the title appears). */
  open(pageId: string, focusId?: string): void {
    this.stack.length = 0;
    this.stack.push(pageId);
    this.render('open', focusId ?? this.memory.get(pageId));
  }

  push(pageId: string, focusId?: string): void {
    this.memory.set(this.pageId, this.focusedId);
    this.stack.push(pageId);
    this.render('forward', focusId);
  }

  /** Leave the page. False at the main page (there is nowhere to go). */
  pop(): boolean {
    if (this.stack.length < 2) return false;
    this.stack.pop();
    this.render('back', this.memory.get(this.pageId));
    return true;
  }

  /** Rebuild the page after the state under it changed; focus stays on the same item. */
  refresh(): void {
    this.render('none', this.focusedId);
  }

  focusItem(id: string): void {
    this.buttons().find((button) => button.dataset.entry === id)?.focus({ preventScroll: false });
  }

  private page(): MenuPage | undefined { return this.pages.get(this.pageId); }

  private buttons(): HTMLButtonElement[] {
    return Array.from(this.list.querySelectorAll<HTMLButtonElement>('.tm-item'));
  }

  private render(dir: 'none' | 'open' | 'forward' | 'back', focusId?: string): void {
    const page = this.page();
    if (!page) return;
    this.items = page.items();
    this.root.dataset.depth = String(this.depth);
    this.root.dataset.page = page.id;
    this.head.hidden = page.title === '';
    this.eyebrow.textContent = page.eyebrow ?? '';
    this.eyebrow.hidden = !page.eyebrow;
    this.title.textContent = page.title;
    this.list.setAttribute('aria-labelledby', page.title ? 'tm-page-title' : 'expedition-title');
    if (page.body) {
      let cached = this.bodies.get(page.id);
      if (!cached) { cached = page.body(); this.bodies.set(page.id, cached); }
      if (this.body.firstChild !== cached) this.body.replaceChildren(cached);
    } else this.body.replaceChildren();
    this.body.hidden = !page.body;
    this.list.replaceChildren(...this.items.map((item, index) => this.makeItem(item, index)));
    this.note.textContent = page.note?.() ?? '';
    if (dir !== 'none') {
      this.stage.dataset.dir = dir;
      this.stage.classList.remove('tm-enter');
      void this.stage.offsetWidth;
      this.stage.classList.add('tm-enter');
    }
    // A page with a field of its own (the seed) opens in the field; Up from the first row returns to it.
    const lead = dir === 'forward' ? page.lead?.() ?? null : null;
    const pageFocus = typeof page.focus === 'function' ? page.focus() : page.focus;
    const wanted = focusId ?? pageFocus ?? this.items[0]?.id ?? '';
    const target = this.buttons().find((button) => button.dataset.entry === wanted) ?? this.buttons()[0];
    this.focusedId = target?.dataset.entry ?? '';
    // Rebuilt under the user's hands: put focus back only if it was on an item (a dialog may be open over the menu, a field may be being typed in).
    const active = document.activeElement;
    if (dir !== 'none' || !active || active === document.body || active.closest('.tm-item') || !active.isConnected) {
      target?.focus({ preventScroll: true });
    }
    for (const button of this.buttons()) button.tabIndex = button === target ? 0 : -1;
    if (lead && !focusId) lead.focus({ preventScroll: true });
    this.describe(this.items.find((item) => item.id === this.focusedId) ?? null);
  }

  private makeItem(item: MenuItem, index: number): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `tm-item tm-${item.kind}${item.primary ? ' tm-primary' : ''}`;
    button.dataset.entry = item.id;
    button.tabIndex = -1;
    button.style.setProperty('--i', String(index));
    button.setAttribute('role', item.kind === 'option' ? 'menuitemradio' : item.kind === 'toggle' ? 'menuitemcheckbox' : 'menuitem');
    if (item.kind === 'option' || item.kind === 'toggle') button.setAttribute('aria-checked', String(item.checked === true));
    if (item.kind === 'drill' || item.kind === 'choice') button.setAttribute('aria-haspopup', 'true');
    if (item.locked) { button.setAttribute('aria-disabled', 'true'); button.classList.add('locked'); }
    if (item.checked) button.classList.add('checked');
    for (const [name, value] of Object.entries(item.attrs ?? {})) button.setAttribute(name, value);
    if (item.icon) {
      const icon = document.createElement('span');
      icon.className = 'tm-icon';
      icon.append(iconNode(item.icon));
      button.append(icon);
    }
    const text = document.createElement('span');
    text.className = 'tm-text';
    const label = document.createElement('span');
    label.className = 'tm-label';
    label.textContent = item.label;
    text.append(label);
    if (item.sub) {
      const sub = document.createElement('span');
      sub.className = 'tm-sub';
      sub.textContent = item.sub;
      text.append(sub);
    }
    button.append(text);
    if (item.value !== undefined) {
      const value = document.createElement('span');
      value.className = 'tm-value';
      value.textContent = item.value;
      button.append(value);
    }
    const mark = document.createElement('span');
    mark.className = 'tm-mark';
    mark.setAttribute('aria-hidden', 'true');
    button.append(mark);
    button.addEventListener('click', () => {
      if (item.locked) { this.refuse(button); return; }
      item.activate();
    });
    // The pointer moves the selection like the keys do (a mouse, not a touch: a tap is a click). Only a pointer that
    // really moved counts (see trackPointer).
    button.addEventListener('pointermove', (event) => {
      if (event.pointerType === 'touch' || !this.pointerMoved || document.activeElement === button) return;
      button.focus({ preventScroll: true });
    });
    return button;
  }

  private refuse(button: HTMLButtonElement): void {
    button.focus({ preventScroll: true });
    button.classList.remove('refused');
    void button.offsetWidth;
    button.classList.add('refused');
    this.cue('refuse');
  }

  private onFocusIn(event: FocusEvent): void {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.tm-item') : null;
    const item = button ? this.items.find((entry) => entry.id === button.dataset.entry) ?? null : null;
    if (!button || !item) return;
    this.focusedId = item.id;
    for (const other of this.buttons()) other.tabIndex = other === button ? 0 : -1;
    this.describe(item);
  }

  /** The hint line, the detail card and the key legend follow the focused item. */
  private describe(item: MenuItem | null): void {
    this.hint.textContent = item?.hint ?? '';
    const spec = item?.detail ?? null;
    if (spec) {
      // A new card fades in; the same card rebuilt (a refresh) does not flicker.
      const key = `${this.pageId}|${item?.id}|${spec.heading}|${spec.body ?? ''}|${spec.locked ? 1 : 0}`;
      this.detail.replaceChildren(detailNode(spec));
      if (key !== this.detailKey) {
        this.detailKey = key;
        this.detail.classList.remove('tm-swap');
        void this.detail.offsetWidth;
        this.detail.classList.add('tm-swap');
      }
    }
    this.detail.hidden = !spec;
    this.root.classList.toggle('has-detail', spec !== null);
    this.renderKeys(item?.kind ?? null);
  }

  private renderKeys(kind: ItemKind | null): void {
    const nodes = keyHints(kind, this.depth, this.pad).map((hint) => {
      const group = document.createElement('span');
      group.className = 'tm-key';
      for (const key of hint.keys) {
        const cap = document.createElement('kbd');
        cap.className = 'key';
        cap.textContent = key;
        group.append(cap);
      }
      const label = document.createElement('span');
      label.textContent = hint.label;
      group.append(label);
      return group;
    });
    this.keys.replaceChildren(...nodes);
  }

  private onKey(event: KeyboardEvent): void {
    if (event.altKey || event.ctrlKey || event.metaKey || event.defaultPrevented) return;
    const target = event.target instanceof HTMLElement ? event.target : null;
    const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
    const key = event.key;
    const page = this.page();
    const buttons = this.buttons();
    const lead = page?.lead?.() ?? null;
    const stops: HTMLElement[] = lead ? [lead, ...buttons] : buttons;
    const at = target ? stops.indexOf(target) : -1;
    if (key === 'ArrowUp' || key === 'ArrowDown' || ((key === 'Home' || key === 'End') && !typing)) {
      if (typing && key === 'ArrowUp' && at === 0) return;
      event.preventDefault();
      event.stopPropagation();
      const next = stops[moveFocusIndex(at, stops.length, key)];
      if (next && next !== target) { next.focus(); this.cue('move'); }
      return;
    }
    if ((key === 'ArrowLeft' || key === 'ArrowRight') && !typing) {
      const item = this.items.find((entry) => entry.id === target?.dataset.entry);
      if (item?.step) {
        event.preventDefault();
        event.stopPropagation();
        item.step(key === 'ArrowRight' ? 1 : -1);
        this.cue('step');
      }
      return;
    }
    if (key === 'Escape' || (key === 'Backspace' && !typing)) {
      if (this.depth === 0) return;
      event.preventDefault();
      event.stopPropagation();
      this.pop();
      this.cue('back');
    }
  }
}

function iconNode(icon: ItemIcon): Node {
  if (icon.kind === 'kit') {
    const canvas = makeIconCanvas(cardIconName(KIT_DEFS[icon.kit].wands[0][0] ?? 'spark'), 2);
    if (canvas) return canvas;
    return document.createTextNode('');
  }
  if (icon.kind === 'portrait') {
    const frame = document.createElement('span');
    frame.className = 'tm-portrait';
    frame.style.setProperty('--fighter-accent', icon.accent);
    const img = document.createElement('img');
    img.src = icon.src;
    img.alt = '';
    img.decoding = 'async';
    frame.append(img);
    return frame;
  }
  const glyph = document.createElement('span');
  glyph.className = 'tm-glyph';
  glyph.textContent = icon.text;
  return glyph;
}

function detailNode(spec: DetailSpec): HTMLElement {
  const card = document.createElement('div');
  card.className = 'tm-card';
  if (spec.locked) card.classList.add('locked');
  if (spec.icon) {
    const art = document.createElement('div');
    art.className = `tm-card-art tm-card-art-${spec.icon.kind}`;
    if (spec.icon.kind === 'kit') {
      const canvas = makeIconCanvas(cardIconName(KIT_DEFS[spec.icon.kit].wands[0][0] ?? 'spark'), 4);
      if (canvas) art.append(canvas);
    } else art.append(iconNode(spec.icon));
    card.append(art);
  }
  const text = (tag: 'p' | 'h3' | 'div', className: string, value: string): HTMLElement => {
    const el = document.createElement(tag);
    el.className = className;
    el.textContent = value;
    return el;
  };
  if (spec.eyebrow) card.append(text('p', 'tm-card-eyebrow', spec.eyebrow));
  card.append(text('h3', 'tm-card-heading', spec.heading));
  if (spec.sub) card.append(text('p', 'tm-card-sub', spec.sub));
  if (spec.body) card.append(text('p', 'tm-card-body', spec.body));
  if (spec.lines?.length) {
    const lines = document.createElement('dl');
    lines.className = 'tm-card-lines';
    for (const line of spec.lines) {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const cap = document.createElement('kbd');
      cap.className = 'key';
      cap.textContent = line.label;
      term.append(cap);
      const def = document.createElement('dd');
      const name = document.createElement('b');
      name.textContent = line.name;
      def.append(name, document.createTextNode(` ${line.text}`));
      row.append(term, def);
      lines.append(row);
    }
    card.append(lines);
  }
  return card;
}
