import type { Ctx } from '@/core/types';
import { loadDiscoveredInteractions } from '@/core/grimoireStore';
import { GRIMOIRE_INTERACTIONS } from '@/content/grimoireInteractions';
import { RECIPES, loadDiscoveredRecipes, type Recipe } from '@/game/Brewing';
import { MATERIAL_LORE, discoveredLore } from '@/game/lore';
import { MATERIAL_PARAMS } from '@/config/params';
import type { StoryJournalPage } from '@/core/story';
import { SPEAKER_NAMES } from '@/content/story/types';

/** The Journal tab's own dress (the book's shared styles stay untouched). */
const JOURNAL_STYLE = `
.grimoire-tabs { position: absolute; top: 12.5%; left: 50%; transform: translateX(-50%); display: flex; gap: 1.2vh; z-index: 2; }
.grimoire-tabs button {
  padding: 0.5vh 1.6vh 0.6vh; border: 1px solid #6a4a26; border-radius: 0.5vh 0.5vh 0 0; background: #c9b083; color: #3a2614;
  font: 600 1.45vh/1 Georgia, serif; letter-spacing: 0.08em; cursor: pointer; box-shadow: 0 -2px 6px #0004 inset;
}
.grimoire-tabs button.on { background: #ecdcb4; box-shadow: none; }
.grimoire-tabs button:focus-visible { outline: 2px solid #8a5a20; }
.gj-group { margin: 1.1vh 0 0.4vh; font-size: 1.35vh; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.7; text-align: center; }
.gj-item { display: block; width: 100%; text-align: left; padding: 0.35vh 0.4vh; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; border-radius: 0.3vh; }
.gj-item:hover, .gj-item.on { background: #6a4a2622; }
.gj-item.locked { opacity: 0.4; font-style: italic; cursor: default; }
.gj-item small { opacity: 0.6; margin-left: 0.4vh; }
.gj-line { margin: 0 0 0.9vh; }
.gj-line b { display: block; font-size: 1.2vh; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.6; }
.gj-line span { font-style: italic; }
.gj-hear { margin-top: 0.6vh; padding: 0.5vh 1.2vh; border: 1px solid #6a4a26; border-radius: 0.4vh; background: #d8c296; color: #3a2614; font: 600 1.35vh/1 Georgia, serif; cursor: pointer; }
.gj-hear:hover { background: #ecdcb4; }
.gj-missing { font-size: 1.3vh; font-style: italic; opacity: 0.6; margin-top: 0.8vh; }
/* The Journal's pages lay out as a column: the head stays put, the list or the page's
   lines scroll between it and the foot, and the scroll SHOWS (a fade and a "more"
   mark) — QA found the right page clipped and "Hear it again" below the fold. */
#grimoire-overlay.journal .grimoire-page { display: flex; flex-direction: column; overflow: hidden; height: 48%; }
.gj-head { flex: none; }
.gj-head .gr-head { font-size: 2.05vh; line-height: 1.15; margin-bottom: 0.5vh; }
.gj-scroll { flex: 1 1 auto; min-height: 0; overflow-y: auto; overflow-x: hidden; padding-right: 0.4vh; position: relative;
  scrollbar-width: thin; scrollbar-color: rgba(90, 60, 30, 0.55) transparent; }
.gj-scroll.more { -webkit-mask-image: linear-gradient(#000 82%, transparent); mask-image: linear-gradient(#000 82%, transparent); }
.gj-foot { flex: none; display: flex; align-items: center; gap: 1vh; padding-top: 0.6vh; min-height: 3.2vh; }
.gj-foot .gj-hear { margin-top: 0; }
.gj-more { font-size: 1.3vh; font-style: italic; opacity: 0; transition: opacity 0.2s; margin-left: auto; white-space: nowrap; }
.gj-more.on { opacity: 0.75; }
`;

// Bundled like the backdrop layers (new URL → Vite asset). The authored book art,
// WebP q92 (212 KB; the PNG was 1.97 MB). Not fetched at boot: the <img> carries
// it as data-src and toggle() assigns src the first time the book opens.
const GRIMOIRE_SRC = new URL('../../assets/grimoire-open-straight.webp', import.meta.url).href;

/**
 * The wizard's Grimoire — an in-world book (toggle with `J`) drawn onto the
 * authored book art. Phase 1: the persistent brewing recipes (discovered =
 * inscribed, undiscovered = "? ? ?"). The right-page "Material Lore" section is
 * the home for the Examine discoveries (#5) as that system lands.
 */
export class Grimoire {
  private readonly overlay: HTMLDivElement;
  private readonly left: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private open = false;
  /** Sim pause state captured on open, restored on close (nests under the pause menu). */
  private wasPaused = false;
  /** The Grimoire's recipes and lore, or the story's Journal. */
  private tab: 'grimoire' | 'journal' = 'grimoire';
  private journalPick: string | null = null;
  private readonly tabs: HTMLDivElement;
  private readonly style = document.createElement('style');

  constructor(private readonly ctx: Ctx) {
    this.overlay = document.createElement('div');
    this.overlay.id = 'grimoire-overlay';
    this.overlay.innerHTML = `
      <div class="grimoire-book">
        <img class="grimoire-img" data-src="${GRIMOIRE_SRC}" alt="Grimoire" draggable="false">
        <div class="grimoire-page grimoire-left"></div>
        <div class="grimoire-page grimoire-right"></div>
      </div>`;
    (document.getElementById('canvas-holder') ?? document.body).appendChild(this.overlay);
    this.left = this.overlay.querySelector('.grimoire-left') as HTMLDivElement;
    this.right = this.overlay.querySelector('.grimoire-right') as HTMLDivElement;
    // STORY (wave 3): the Journal tab — lore pages, echoes and Pell's map pages, across runs.
    this.style.textContent = JOURNAL_STYLE;
    document.head.appendChild(this.style);
    this.tabs = document.createElement('div');
    this.tabs.className = 'grimoire-tabs';
    this.tabs.setAttribute('role', 'tablist');
    for (const [id, label] of [['grimoire', 'Grimoire'], ['journal', 'Journal']] as const) {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.tab = id;
      b.setAttribute('role', 'tab');
      b.textContent = label;
      b.addEventListener('click', (e) => { e.stopPropagation(); this.showTab(id); });
      this.tabs.appendChild(b);
    }
    this.overlay.querySelector('.grimoire-book')?.appendChild(this.tabs);
    this.right.addEventListener('click', (e) => {
      const hear = (e.target as HTMLElement).closest<HTMLButtonElement>('.gj-hear');
      if (hear?.dataset.page) this.ctx.story?.readJournal(hear.dataset.page);
    });
    this.left.addEventListener('click', (e) => {
      const item = (e.target as HTMLElement).closest<HTMLButtonElement>('.gj-item:not(.locked)');
      if (item?.dataset.page) { this.journalPick = item.dataset.page; this.render(); }
    });
    // A scrolled page drops its "more" fade once its end is in view.
    this.overlay.addEventListener('scroll', (e) => {
      const el = e.target as HTMLElement;
      if (el.classList?.contains('gj-scroll')) this.markMore(el);
    }, true);
    // Click the dimmed backdrop (not the book) to close.
    this.overlay.addEventListener('click', (e) => {
      if (e.target === this.overlay) this.toggle();
    });
    window.addEventListener('keydown', this.onKey);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.code === 'KeyJ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      this.toggle();
    } else if (e.code === 'Escape' && this.open) {
      e.preventDefault();
      this.toggle();
    } else if (this.open && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')) {
      e.preventDefault();
      this.showTab(this.tab === 'grimoire' ? 'journal' : 'grimoire');
    }
  };

  private showTab(tab: 'grimoire' | 'journal'): void {
    if (tab === this.tab) return;
    this.tab = tab;
    this.ctx.story?.stopReading();
    this.render();
  }

  toggle(): void {
    this.open = !this.open;
    this.overlay.classList.toggle('open', this.open);
    if (this.open) {
      const image = this.overlay.querySelector<HTMLImageElement>('.grimoire-img');
      if (image && !image.hasAttribute('src')) image.src = image.dataset.src!;
      this.wasPaused = this.ctx.state.paused;
      this.ctx.state.paused = true; // reading the book pauses the world
      this.render();
    } else {
      this.ctx.state.paused = this.wasPaused;
      this.ctx.story?.stopReading();
    }
  }

  private render(): void {
    this.overlay.classList.toggle('journal', this.tab === 'journal');
    for (const b of this.tabs.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    if (this.tab === 'journal') { this.renderJournal(); return; }
    const known = loadDiscoveredRecipes();
    const matName = (c: number): string => MATERIAL_PARAMS[c]?.name ?? `#${c}`;
    const entry = (r: Recipe): string => {
      if (!known[r.id]) {
        return `<div class="gr-entry gr-locked"><div class="gr-title">&#10022; Unknown Elixir</div><div class="gr-sub">brew its recipe to inscribe it</div></div>`;
      }
      const needs = r.needs.map((n) => `${n.min}&times; ${matName(n.cell)}`).join(', ');
      return `<div class="gr-entry"><div class="gr-title">${r.name}</div><div class="gr-sub">Needs ${needs}</div></div>`;
    };
    const discovered = RECIPES.filter((r) => known[r.id]).length;
    this.left.innerHTML =
      `<div class="gr-head">Grimoire</div>` +
      `<div class="gr-section">Elixirs &mdash; ${discovered} / ${RECIPES.length} known</div>` +
      RECIPES.map(entry).join('');
    const lore = discoveredLore();
    const loreEntries = Object.entries(MATERIAL_LORE).filter(([id]) => lore[id]);
    const total = Object.keys(MATERIAL_LORE).length;
    const interactions = loadDiscoveredInteractions();
    const interactionEntries = GRIMOIRE_INTERACTIONS.filter((entry) => interactions[entry.id]);
    this.right.innerHTML =
      `<div class="gr-head">Material Lore</div>` +
      (loreEntries.length || interactionEntries.length
        ? `<div class="gr-section">Materials &mdash; ${loreEntries.length} / ${total} studied</div>` +
          loreEntries
            .map(([, e]) => `<div class="gr-entry"><div class="gr-title">${e!.title}</div><div class="gr-sub">${e!.body}</div></div>`)
            .join('') +
          `<div class="gr-section">Interactions &mdash; ${interactionEntries.length} / ${GRIMOIRE_INTERACTIONS.length} witnessed</div>` +
          interactionEntries
            .map((entry) => `<div class="gr-entry"><div class="gr-title">${entry.title}</div><div class="gr-sub">${entry.body}</div></div>`)
            .join('')
        : `<div class="gr-empty">Examine the world (press <b>I</b>) to record what its materials do, and brew in a cauldron to inscribe new elixirs.</div>`);
  }

  /** The Journal: every page the Works have given this player, re-readable in their voices. */
  private renderJournal(): void {
    const pages: StoryJournalPage[] = this.ctx.story?.journal() ?? [];
    const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
    const found = pages.filter(p => p.unlocked).length;
    if (!this.journalPick || !pages.some(p => p.id === this.journalPick && p.unlocked)) this.journalPick = pages.find(p => p.unlocked)?.id ?? null;
    let list = '';
    let group = '';
    for (const p of pages) {
      if (p.group !== group) { group = p.group; list += `<div class="gj-group">${esc(group)}</div>`; }
      list += p.unlocked
        ? `<button type="button" class="gj-item${p.id === this.journalPick ? ' on' : ''}" data-page="${p.id}">${esc(p.title)}${p.missing > 0 && p.kind === 'docent' ? `<small>${p.lines.length}/${p.lines.length + p.missing}</small>` : ''}</button>`
        : `<button type="button" class="gj-item locked" tabindex="-1">— an unread page —</button>`;
    }
    this.left.innerHTML = `<div class="gj-head"><div class="gr-head">Journal</div><div class="gr-section">${found} of ${pages.length} pages found</div></div>` +
      `<div class="gj-scroll">${list}</div><div class="gj-foot"><span class="gj-more">more below ▾</span></div>`;
    const page = pages.find(p => p.id === this.journalPick);
    if (!page) {
      this.right.innerHTML = `<div class="gj-head"><div class="gr-head">Unwritten</div></div><div class="gj-scroll"><div class="gr-empty">Listen at the brass speaking-pipes, turn the resonant valves, and sit a while with Pell. The Works remember; this book remembers what they tell you.</div></div>`;
    } else {
      // The page: its title, its lines scrolling between, and "Hear it again" always in view at the foot.
      this.right.innerHTML = `<div class="gj-head"><div class="gr-head">${esc(page.title)}</div></div>` +
        `<div class="gj-scroll">` +
        page.lines.map(l => `<p class="gj-line"><b>${esc(SPEAKER_NAMES[l.speaker])}</b><span>${esc(l.text)}</span></p>`).join('') +
        (page.missing > 0 && page.kind === 'docent' ? `<div class="gj-missing">${page.missing} more ${page.missing === 1 ? 'line waits' : 'lines wait'} in the pipes of this floor.</div>` : '') +
        `</div><div class="gj-foot"><button type="button" class="gj-hear" data-page="${page.id}">Hear it again</button><span class="gj-more">more below ▾</span></div>`;
    }
    // Keep the chosen page in view in the list, and mark whichever side has more below.
    this.left.querySelector<HTMLElement>('.gj-item.on')?.scrollIntoView({ block: 'nearest' });
    for (const el of this.overlay.querySelectorAll<HTMLElement>('.gj-scroll')) this.markMore(el);
  }

  /** A scrolling Journal column with more below its fold fades out at the foot and says so. */
  private markMore(el: HTMLElement): void {
    const more = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
    el.classList.toggle('more', more);
    el.parentElement?.querySelector('.gj-more')?.classList.toggle('on', more);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.overlay.remove();
    this.style.remove();
  }
}
