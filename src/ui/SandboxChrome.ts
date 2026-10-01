import type { Ctx } from '@/core/types';
import { editorIcon } from '@/ui/editor/icons';
import { PopoverHost } from '@/ui/editor/PopoverHost';
import { syncAllRangeFills, watchRangeFill } from '@/ui/rangeFill';

const SECTION_STORE_KEY = 'sb-sections';

/**
 * Behaviour for the authoring Sandbox's chrome (markup in index.html, look in
 * styles/sandbox.css): the dock's tabs, collapsible inspector sections, the
 * Developer menu, the workspace switch's pressed state, and the small pieces of
 * glue that make the new layout keyboard-operable.
 *
 * This owns NO feature. Every button it touches is still bound by its owner
 * (Hud, InputManager, BuilderLauncher, ConsoleOverlay, Toolbar, LevelStore...)
 * through the same id it always had: this class moves no element, recreates none
 * and only toggles state on the ones it is given. It is constructed only in an
 * authoring build (Game.ts), so a player's Workshop never sees any of it.
 * Every lookup tolerates a missing node: the standalone editor route
 * (/builder.html) shares the header but has no tool dock.
 */
export class SandboxChrome {
  private readonly disposers: Array<() => void> = [];
  private readonly tips = new PopoverHost();
  private menuOpen = false;

  constructor(private readonly ctx: Ctx) {
    this.fillIcons();
    this.wireTabs();
    this.wireSections();
    this.wireDevMenu();
    this.wireWorkspace();
    this.wireFilterChrome();
    this.wireToolKeys();
    this.wireActions();
    this.wireRanges();
    this.wireTips();
  }

  dispose(): void {
    for (const dispose of this.disposers.splice(0).reverse()) dispose();
    this.tips.dispose();
  }

  private listen<K extends keyof HTMLElementEventMap>(
    target: HTMLElement | null,
    type: K,
    listener: (event: HTMLElementEventMap[K]) => void,
  ): void {
    if (!target) return;
    target.addEventListener(type, listener);
    this.disposers.push(() => target.removeEventListener(type, listener));
  }

  private listenDoc<K extends keyof DocumentEventMap>(type: K, listener: (event: DocumentEventMap[K]) => void, capture = false): void {
    document.addEventListener(type, listener, capture);
    this.disposers.push(() => document.removeEventListener(type, listener, capture));
  }

  /** `<span data-icon="layers">` placeholders become inline line icons (the markup is static HTML). */
  private fillIcons(): void {
    for (const slot of Array.from(document.querySelectorAll<HTMLElement>('[data-icon]'))) {
      const holder = document.createElement('template');
      holder.innerHTML = editorIcon(slot.dataset.icon ?? '', 14);
      const svg = holder.content.firstElementChild;
      if (svg) slot.replaceWith(svg);
    }
  }

  // ===================== Dock tabs =====================

  private wireTabs(): void {
    const bar = document.getElementById('left-toolbar');
    if (!bar) return;
    const tabs = Array.from(bar.querySelectorAll<HTMLButtonElement>('.sb-tabs [role="tab"]'));
    if (tabs.length === 0) return;
    const select = (name: string, focus: boolean): void => {
      bar.dataset.tab = name;
      for (const tab of tabs) {
        const on = tab.dataset.tab === name;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        if (on && focus) tab.focus();
      }
    };
    for (const tab of tabs) {
      this.listen(tab, 'click', () => select(tab.dataset.tab ?? 'materials', false));
      this.listen(tab, 'keydown', (event) => {
        const at = tabs.indexOf(tab);
        let next = -1;
        if (event.key === 'ArrowRight') next = (at + 1) % tabs.length;
        else if (event.key === 'ArrowLeft') next = (at - 1 + tabs.length) % tabs.length;
        else if (event.key === 'Home') next = 0;
        else if (event.key === 'End') next = tabs.length - 1;
        if (next < 0) return;
        event.preventDefault();
        select(tabs[next].dataset.tab ?? 'materials', true);
      });
    }
  }

  // ===================== Collapsible sections =====================

  private readStoredSections(): Record<string, boolean> {
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(SECTION_STORE_KEY) ?? '{}');
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, boolean>) : {};
    } catch {
      return {};
    }
  }

  private wireSections(): void {
    const stored = this.readStoredSections();
    for (const section of Array.from(document.querySelectorAll<HTMLElement>('#left-toolbar .st-section, #right-inspector .st-section'))) {
      const toggle = section.querySelector<HTMLButtonElement>('.st-section-toggle');
      const body = toggle ? document.getElementById(toggle.getAttribute('aria-controls') ?? '') : null;
      const key = section.dataset.section;
      if (!toggle || !body || !key) continue;
      const setOpen = (open: boolean): void => {
        toggle.setAttribute('aria-expanded', String(open));
        body.hidden = !open;
      };
      setOpen(stored[key] ?? section.dataset.default !== 'closed');
      this.listen(toggle, 'click', () => {
        const open = toggle.getAttribute('aria-expanded') !== 'true';
        setOpen(open);
        try {
          localStorage.setItem(SECTION_STORE_KEY, JSON.stringify({ ...this.readStoredSections(), [key]: open }));
        } catch {
          // storage blocked: the section still toggles, it just will not be remembered
        }
      });
    }
  }

  // ===================== Developer menu =====================

  private wireDevMenu(): void {
    const trigger = document.getElementById('dev-menu-btn') as HTMLButtonElement | null;
    const panel = document.getElementById('dev-menu');
    const wrap = trigger?.parentElement ?? null;
    if (!trigger || !panel || !wrap) return;
    const items = (): HTMLButtonElement[] =>
      Array.from(panel.querySelectorAll<HTMLButtonElement>('.sb-menu-item')).filter((item) => !item.disabled);

    const place = (): void => {
      const rect = trigger.getBoundingClientRect();
      panel.style.top = `${Math.round(rect.bottom + 4)}px`;
      panel.style.right = `${Math.max(8, Math.round(window.innerWidth - rect.right))}px`;
    };
    const open = (focusFirst: boolean): void => {
      this.menuOpen = true;
      place();
      panel.hidden = false;
      trigger.setAttribute('aria-expanded', 'true');
      if (focusFirst) items()[0]?.focus();
    };
    const close = (returnFocus: boolean): void => {
      if (!this.menuOpen) return;
      this.menuOpen = false;
      panel.hidden = true;
      trigger.setAttribute('aria-expanded', 'false');
      if (returnFocus) trigger.focus();
    };

    this.listen(trigger, 'click', () => (this.menuOpen ? close(false) : open(false)));
    this.listen(trigger, 'keydown', (event) => {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        open(true);
      }
    });
    // Escape closes the menu wherever focus is: several owners blur their button after a click, and an
    // Escape that then reached the game would open its pause overlay instead. Capture phase on the
    // window runs ahead of every game handler.
    const onEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || !this.menuOpen) return;
      event.preventDefault();
      event.stopPropagation();
      close(true);
    };
    window.addEventListener('keydown', onEscape, true);
    this.disposers.push(() => window.removeEventListener('keydown', onEscape, true));
    this.listen(panel, 'keydown', (event) => {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
      const list = items();
      if (list.length === 0) return;
      event.preventDefault();
      const at = list.indexOf(document.activeElement as HTMLButtonElement);
      let next = at;
      if (event.key === 'ArrowDown') next = (at + 1) % list.length;
      else if (event.key === 'ArrowUp') next = (at - 1 + list.length) % list.length;
      else if (event.key === 'Home') next = 0;
      else next = list.length - 1;
      list[next].focus();
    });
    this.listen(panel, 'click', (event) => {
      const item = (event.target as HTMLElement).closest<HTMLElement>('.sb-menu-item');
      if (!item) return;
      if (item.hasAttribute('data-menu-close')) close(false);
      // The owner's own handler (it ran first) may have blurred the button; keep the keyboard in the menu.
      else if (this.menuOpen && document.activeElement !== item) item.focus({ preventScroll: true });
    });
    // Anything outside the menu dismisses it; focus moving away (Tab) does too. A `blur()` from an
    // item's owner (several call it after a click) has no relatedTarget and must not.
    this.listenDoc('pointerdown', (event) => {
      if (this.menuOpen && !wrap.contains(event.target as Node)) close(false);
    }, true);
    this.listen(wrap, 'focusout', (event) => {
      const to = event.relatedTarget as Node | null;
      if (this.menuOpen && to && !wrap.contains(to)) close(false);
    });
    const onResize = (): void => { if (this.menuOpen) place(); };
    window.addEventListener('resize', onResize);
    this.disposers.push(() => window.removeEventListener('resize', onResize));

    // Owners toggle `.lit` on their own buttons; with the menu shut that would be invisible, so
    // the trigger carries a dot while anything in it is engaged.
    const syncActive = (): void => {
      trigger.classList.toggle('has-active', panel.querySelector('.sb-menu-item.lit') !== null);
    };
    syncActive();
    if (typeof MutationObserver !== 'undefined') {
      const observer = new MutationObserver(syncActive);
      observer.observe(panel, { attributes: true, attributeFilter: ['class'], subtree: true });
      this.disposers.push(() => observer.disconnect());
    }
  }

  // ===================== Workspace switch =====================

  /**
   * Hud.ts keeps `.active` on Sandbox/Play and Builder keeps it on its own button; while the Builder
   * is open Sandbox is still the "mode" underneath. The switch should show ONE workspace, and
   * assistive tech should hear which, so `aria-pressed` is derived from those classes here.
   */
  private wireWorkspace(): void {
    const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.sb-workspace > button'));
    if (buttons.length === 0) return;
    // In a workspace switch, "Sandbox" while the Builder is open means "back to the Sandbox". The
    // button alone only sets a mode that is already 'build', so a real click also closes the Builder
    // the way its own button does (which asks about unsaved work). Synthetic clicks are the Builder
    // bouncing the mode itself and must not loop back into it.
    this.listen(document.getElementById('mode-build-btn'), 'click', (event) => {
      if (!event.isTrusted || !document.body.classList.contains('builder-open')) return;
      (document.getElementById('mode-builder-btn') as HTMLButtonElement | null)?.click();
    });
    const sync = (): void => {
      const builderOpen = document.body.classList.contains('builder-open');
      for (const button of buttons) {
        const pressed = button.classList.contains('active') && !(button.id === 'mode-build-btn' && builderOpen);
        button.setAttribute('aria-pressed', String(pressed));
      }
    };
    sync();
    if (typeof MutationObserver === 'undefined') return;
    const observer = new MutationObserver(sync);
    for (const button of buttons) observer.observe(button, { attributes: true, attributeFilter: ['class'] });
    observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });
    this.disposers.push(() => observer.disconnect());
  }

  // ===================== Search =====================

  /**
   * Toolbar filters the tool buttons; this reports the result: a count on each tab that has
   * matches (so a search typed on Materials still says "1 in Spells"), and an empty state on a
   * tab with none. Arrow-down / Enter / Escape make the search box a one-handed picker.
   */
  private wireFilterChrome(): void {
    const filter = document.getElementById('toolbar-filter') as HTMLInputElement | null;
    const bar = document.getElementById('left-toolbar');
    if (!filter || !bar) return;
    const panels = Array.from(bar.querySelectorAll<HTMLElement>('.sb-panel[data-panel="materials"], .sb-panel[data-panel="spells"]'));
    const visibleTools = (panel: HTMLElement): HTMLButtonElement[] =>
      Array.from(panel.querySelectorAll<HTMLButtonElement>('.tool-btn')).filter((btn) => btn.style.display !== 'none');
    const report = (): void => {
      const q = filter.value.trim();
      const hits = new Map<string, number>();
      for (const panel of panels) hits.set(panel.dataset.panel ?? '', visibleTools(panel).length);
      for (const panel of panels) {
        const name = panel.dataset.panel ?? '';
        const tab = document.getElementById(`sb-tab-${name}`);
        const count = hits.get(name) ?? 0;
        if (tab) {
          if (q && count > 0) tab.dataset.hits = String(count);
          else delete tab.dataset.hits;
        }
        const empty = panel.querySelector<HTMLElement>('.sb-empty');
        if (empty) {
          const other = panels.filter((p) => p !== panel).reduce((n, p) => n + (hits.get(p.dataset.panel ?? '') ?? 0), 0);
          const noun = name === 'spells' ? 'spell' : 'material';
          empty.textContent = `No ${noun} matches “${q}”.` + (other > 0 ? ` ${other} in the other tab.` : '');
          empty.hidden = !(q && count === 0);
        }
      }
    };
    this.listen(filter, 'input', report);
    const activePanel = (): HTMLElement | null => bar.querySelector<HTMLElement>(`.sb-panel[data-panel="${bar.dataset.tab ?? 'materials'}"]`);
    this.listen(filter, 'keydown', (event) => {
      if (event.key === 'Escape' && filter.value !== '') {
        event.preventDefault();
        event.stopPropagation();
        filter.value = '';
        filter.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (event.key === 'ArrowDown' || event.key === 'Enter') {
        const panel = activePanel();
        const first = panel ? visibleTools(panel)[0] : undefined;
        if (!first) return;
        event.preventDefault();
        if (event.key === 'Enter') first.click();
        else first.focus();
      }
    });
  }

  /** Arrow keys move between tiles by position, so the grid reads like a grid to a keyboard. */
  private wireToolKeys(): void {
    const bar = document.getElementById('left-toolbar');
    if (!bar) return;
    this.listen(bar, 'keydown', (event) => {
      const from = (event.target as HTMLElement).closest<HTMLButtonElement>('.tool-btn');
      if (!from || !event.key.startsWith('Arrow')) return;
      const panel = from.closest<HTMLElement>('.sb-panel');
      if (!panel) return;
      const tools = Array.from(panel.querySelectorAll<HTMLButtonElement>('.tool-btn')).filter((btn) => btn.style.display !== 'none' && btn.offsetParent !== null);
      const at = tools.indexOf(from);
      if (at < 0) return;
      const r = from.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      let best: HTMLButtonElement | null = null;
      let bestScore = Infinity;
      for (const btn of tools) {
        if (btn === from) continue;
        const b = btn.getBoundingClientRect();
        const dx = b.left + b.width / 2 - cx;
        const dy = b.top + b.height / 2 - cy;
        const sameRow = Math.abs(dy) < r.height / 2;
        let score = Infinity;
        if (event.key === 'ArrowRight' && sameRow && dx > 0) score = dx;
        else if (event.key === 'ArrowLeft' && sameRow && dx < 0) score = -dx;
        else if (event.key === 'ArrowDown' && dy > r.height / 2) score = dy * 4 + Math.abs(dx);
        else if (event.key === 'ArrowUp' && dy < -r.height / 2) score = -dy * 4 + Math.abs(dx);
        if (score < bestScore) { bestScore = score; best = btn; }
      }
      // Left/Right wrap to the neighbouring row, like reading order.
      if (!best && event.key === 'ArrowRight') best = tools[at + 1] ?? null;
      if (!best && event.key === 'ArrowLeft') best = tools[at - 1] ?? null;
      if (!best) return;
      event.preventDefault();
      best.focus();
    });
  }

  // ===================== Small actions =====================

  private wireActions(): void {
    // "Edit in Builder" is the header's Builder button, one click away from where the level is
    // being shaped: the Builder adopts the scene on screen.
    this.listen(document.getElementById('btn-edit-in-builder'), 'click', () => {
      (document.getElementById('mode-builder-btn') as HTMLButtonElement | null)?.click();
    });
    // The hidden file input is reachable only through a real button, so Import is a tab stop.
    this.listen(document.getElementById('btn-level-import-pick'), 'click', () => {
      (document.getElementById('level-import') as HTMLInputElement | null)?.click();
    });
  }

  // ===================== Sliders =====================

  private wireRanges(): void {
    for (const id of ['right-inspector', 'left-toolbar']) {
      const root = document.getElementById(id);
      if (root) this.disposers.push(watchRangeFill(root));
    }
    // Every programmatic slider write (a reset, a console `param`, a resync) is followed by this.
    this.disposers.push(
      this.ctx.events.on('paramsChanged', () => {
        for (const id of ['right-inspector', 'left-toolbar']) {
          const root = document.getElementById(id);
          if (root) syncAllRangeFills(root);
        }
      }),
    );
  }

  // ===================== Tooltips for icon-only controls =====================

  /** No native `title=` on these: a popover with the label (and, for toggles, the state). */
  private wireTips(): void {
    const sound = document.getElementById('sound-toggle');
    if (!sound) return;
    const text = (): string =>
      sound.getAttribute('aria-pressed') === 'false' ? 'Sound off · click to turn on' : 'Sound on · click to mute';
    const show = (): void => {
      this.tips.show({
        id: 'sb-tip',
        anchor: sound,
        preferredSide: 'bottom',
        gap: 6,
        className: 'sb-tip',
        render: (el) => { el.textContent = text(); },
      });
    };
    const hide = (): void => this.tips.hide('sb-tip');
    this.listen(sound, 'mouseenter', show);
    this.listen(sound, 'mouseleave', hide);
    this.listen(sound, 'focus', () => { if (sound.matches(':focus-visible')) show(); });
    this.listen(sound, 'blur', hide);
    this.listen(sound, 'click', () => { if (sound.matches(':hover')) show(); });
  }
}
