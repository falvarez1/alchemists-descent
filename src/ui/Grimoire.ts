import '@/styles/alchemy.css';
import type { Ctx } from '@/core/types';
import { loadClues, loadDiscoveredInteractions, loadExperiments } from '@/core/grimoireStore';
import { GRIMOIRE_INTERACTIONS } from '@/content/grimoireInteractions';
import { CLUES, cluesFor } from '@/content/alchemyClues';
import { elixirDef } from '@/content/elixirs';
import { MATERIAL_SWATCHES } from '@/content/materialPalette';
import { RECIPES, loadDiscoveredRecipes, type Recipe } from '@/game/Brewing';
import { MATERIAL_LORE, discoveredLore } from '@/game/lore';
import { MATERIAL_PARAMS } from '@/config/params';
import { titleCaseName } from '@/core/strings';
import type { StoryJournalPage } from '@/core/story';
import { SPEAKER_NAMES } from '@/content/story/types';

/** The Journal tab's own dress (the book's shared styles stay untouched). */
const JOURNAL_STYLE = `
.grimoire-tabs { position: absolute; top: 12.5%; left: 50%; transform: translateX(-50%); display: flex; gap: 1vh; z-index: 2; }
.grimoire-tabs button {
  padding: 0.5vh 1.4vh 0.6vh; border: 1px solid #6a4a26; border-radius: 0.5vh 0.5vh 0 0; background: #c9b083; color: #3a2614;
  font: 600 1.4vh/1 Georgia, serif; letter-spacing: 0.07em; cursor: pointer; box-shadow: 0 -2px 6px #0004 inset;
}
.grimoire-tabs button.on { background: #ecdcb4; box-shadow: none; }
.grimoire-tabs button:focus-visible { outline: 2px solid #8a5a20; }
.gj-group { margin: 1.1vh 0 0.4vh; font-size: 1.35vh; letter-spacing: 0.14em; text-transform: uppercase; opacity: 0.7; text-align: center; }
.gj-item { display: block; width: 100%; text-align: left; padding: 0.35vh 0.4vh; border: 0; background: none; color: inherit; font: inherit; cursor: pointer; border-radius: 0.3vh; }
.gj-item:hover, .gj-item.on { background: #6a4a2622; }
.gj-item.locked { opacity: 0.4; font-style: italic; cursor: default; }
.gj-item.unknown { opacity: 0.62; font-style: italic; }
.gj-item.unknown.on { opacity: 0.9; }
.gj-item small { opacity: 0.6; margin-left: 0.4vh; }
.gj-line { margin: 0 0 0.9vh; }
.gj-line b { display: block; font-size: 1.2vh; letter-spacing: 0.12em; text-transform: uppercase; opacity: 0.6; }
.gj-line span { font-style: italic; }
.gj-hear { margin-top: 0.6vh; padding: 0.5vh 1.2vh; border: 1px solid #6a4a26; border-radius: 0.4vh; background: #d8c296; color: #3a2614; font: 600 1.35vh/1 Georgia, serif; cursor: pointer; }
.gj-hear:hover { background: #ecdcb4; }
.gj-missing { font-size: 1.3vh; font-style: italic; opacity: 0.6; margin-top: 0.8vh; }
/* A previous reader's note in the margin of a studied material: a little off the line, in a browner ink. */
.gr-margin { margin: 0.35vh 0 0 1.1vh; padding-left: 0.9vh; border-left: 1px solid #6b3f1e66; font-size: 1.25vh; font-style: italic; color: #6b3f1e; transform: rotate(-0.5deg); transform-origin: left center; }
/* The pages lay out as a column: the head stays put, the list or the page's
   lines scroll between it and the foot, and the scroll SHOWS (a fade and a "more"
   mark) — QA found the right page clipped and "Hear it again" below the fold. */
#grimoire-overlay .grimoire-page { display: flex; flex-direction: column; overflow: hidden; height: 48%; }
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

type Tab = 'elixirs' | 'experiments' | 'lore' | 'journal';
const TABS: ReadonlyArray<readonly [Tab, string]> = [
  ['elixirs', 'Elixirs'],
  ['experiments', 'Experiments'],
  ['lore', 'Lore'],
  ['journal', 'Journal'],
];

const SWATCH = new Map(MATERIAL_SWATCHES.map((s) => [s.id, s.color]));
const esc = (t: string): string => t.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
/** Frames in a full bowl's worth of drinking (the bowl holds 13 or so cells of product). */
const FULL_BOWL = 13;

/**
 * The wizard's Grimoire — an in-world book (toggle with `J`) drawn onto the
 * authored book art. ELIXIRS: the recipes (a discovered one is inscribed, an
 * undiscovered one is a name-less page with only the margin notes play has earned);
 * EXPERIMENTS: every failed mix tried at a cauldron and what came of it; LORE: what
 * examining the world has taught (`I`); JOURNAL: the story's pages.
 */
export class Grimoire {
  private readonly overlay: HTMLDivElement;
  private readonly left: HTMLDivElement;
  private readonly right: HTMLDivElement;
  private open = false;
  /** Sim pause state captured on open, restored on close (nests under the pause menu). */
  private wasPaused = false;
  private tab: Tab = 'elixirs';
  private journalPick: string | null = null;
  private recipePick: string | null = null;
  private readonly tabs: HTMLDivElement;
  private readonly style = document.createElement('style');
  private readonly offs: Array<() => void> = [];

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
    this.style.textContent = JOURNAL_STYLE;
    document.head.appendChild(this.style);
    this.tabs = document.createElement('div');
    this.tabs.className = 'grimoire-tabs';
    this.tabs.setAttribute('role', 'tablist');
    for (const [id, label] of TABS) {
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
      const target = e.target as HTMLElement;
      const item = target.closest<HTMLButtonElement>('.gj-item:not(.locked)');
      if (item?.dataset.page) { this.journalPick = item.dataset.page; this.render(); }
      if (item?.dataset.recipe) { this.recipePick = item.dataset.recipe; this.render(); }
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
    // A note that lands while the book is open writes itself in.
    this.offs.push(this.ctx.events.on('clueUnlocked', () => { if (this.open) this.render(); }));
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
      const at = TABS.findIndex(([id]) => id === this.tab);
      const next = (at + (e.code === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length;
      this.showTab(TABS[next][0]);
    }
  };

  private showTab(tab: Tab): void {
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

  /** Show a tab from outside (the bowl panel's "see the log", a probe). */
  openTo(tab: Tab): void {
    this.tab = tab;
    if (!this.open) this.toggle();
    else this.render();
  }

  private render(): void {
    this.overlay.classList.add('journal');
    for (const b of this.tabs.querySelectorAll<HTMLButtonElement>('button')) {
      const on = b.dataset.tab === this.tab;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', String(on));
    }
    if (this.tab === 'journal') this.renderJournal();
    else if (this.tab === 'experiments') this.renderExperiments();
    else if (this.tab === 'lore') this.renderLore();
    else this.renderElixirs();
    this.left.querySelector<HTMLElement>('.gj-item.on')?.scrollIntoView({ block: 'nearest' });
    for (const el of this.overlay.querySelectorAll<HTMLElement>('.gj-scroll')) this.markMore(el);
  }

  private matName(cell: number): string {
    return MATERIAL_PARAMS[cell]?.name ?? `#${cell}`;
  }

  // ---------------------------------------------------------------- Elixirs
  private renderElixirs(): void {
    const known = loadDiscoveredRecipes();
    const have = loadClues();
    const discovered = RECIPES.filter((r) => known[r.id]).length;
    const notes = CLUES.filter((c) => have[c.id] && RECIPES.some((r) => r.id === c.recipe && !known[r.id])).length;
    if (!this.recipePick || !RECIPES.some((r) => r.id === this.recipePick)) {
      this.recipePick = (RECIPES.find((r) => known[r.id]) ?? RECIPES[0]).id;
    }
    const swatch = (r: Recipe): string => `<i class="gr-swatch" style="background:${SWATCH.get(r.elixir) ?? '#888'}"></i>`;
    const list = RECIPES.map((r) => {
      const on = r.id === this.recipePick ? ' on' : '';
      if (known[r.id]) return `<button type="button" class="gj-item${on}" data-recipe="${r.id}">${swatch(r)}${esc(titleCaseName(r.name))}</button>`;
      const clues = cluesFor(r.id);
      const found = clues.filter((c) => have[c.id]).length;
      return `<button type="button" class="gj-item unknown${on}" data-recipe="${r.id}">&#10022; an unknown elixir<small>${found}/${clues.length}</small></button>`;
    }).join('');
    this.left.innerHTML =
      `<div class="gj-head"><div class="gr-head">Elixirs</div><div class="gr-section">${discovered} of ${RECIPES.length} known &middot; ${notes} marginal ${notes === 1 ? 'note' : 'notes'}</div></div>` +
      `<div class="gj-scroll">${list}</div><div class="gj-foot"><span class="gj-more">more below &#9662;</span></div>`;
    const r = RECIPES.find((x) => x.id === this.recipePick)!;
    if (known[r.id]) {
      const def = elixirDef(r.elixir);
      const needs = r.needs.map((n) => `${n.min}&times; ${esc(this.matName(n.cell))}`).join(', ');
      const secs = def ? Math.round((FULL_BOWL * def.framesPerCell) / 60) : 0;
      this.right.innerHTML =
        `<div class="gj-head"><div class="gr-head">${esc(titleCaseName(r.name))}</div></div>` +
        `<div class="gj-scroll"><div class="gr-entry"><div class="gr-title">Needs ${needs}</div>` +
        (def ? `<div class="gr-effect">Drinking it grants ${esc(def.does)}. A full bowl lasts about ${secs} seconds.</div>` : '') +
        `<div class="gr-sub">${esc(r.page)}</div></div></div><div class="gj-foot"><span class="gj-more">more below &#9662;</span></div>`;
    } else {
      const clues = cluesFor(r.id);
      const found = clues.filter((c) => have[c.id]);
      this.right.innerHTML =
        `<div class="gj-head"><div class="gr-head">An Unknown Elixir</div></div>` +
        `<div class="gj-scroll">` +
        (found.length
          ? found.map((c) => `<div class="gr-margin">${esc(c.text)}</div>`).join('')
          : `<div class="gr-empty">Nothing is written about this one yet. Look about you: the book remembers what it is told.</div>`) +
        `<div class="gj-missing">${found.length} of ${clues.length} notes found. Brew a mix in a cauldron: one that is close will shimmer.</div>` +
        `</div><div class="gj-foot"><span class="gj-more">more below &#9662;</span></div>`;
    }
  }

  // ------------------------------------------------------------ Experiments
  private renderExperiments(): void {
    const log = loadExperiments().slice().reverse();
    const known = loadDiscoveredRecipes();
    const verdictWord = (v: string, closeTo?: string): string => {
      const target = closeTo ? RECIPES.find((r) => r.id === closeTo) : undefined;
      const named = target && known[target.id] ? ` &mdash; short of ${esc(titleCaseName(target.name))}` : '';
      if (v === 'close') return `it shimmered${named}`;
      if (v === 'muddy') return `it clouded${named}`;
      return 'nothing stirred';
    };
    const rows = log
      .map((e) => {
        const cells = Object.keys(e.counts)
          .map(Number)
          .sort((a, b) => e.counts[String(b)] - e.counts[String(a)] || a - b)
          .map((cell) => {
            const feel = e.feel?.[String(cell)] ?? '';
            return `<span class="${feel}"><i style="background:${SWATCH.get(cell) ?? '#888'}"></i>${e.counts[String(cell)]} ${esc(this.matName(cell))}</span>`;
          })
          .join('');
        return `<div class="gr-log-row ${e.verdict}"><span class="gr-log-mix">${cells}</span><span class="gr-log-verdict">${verdictWord(e.verdict, e.closeTo)}</span>${e.tries > 1 ? `<span class="gr-log-tries">&times;${e.tries}</span>` : ''}</div>`;
      })
      .join('');
    this.left.innerHTML =
      `<div class="gj-head"><div class="gr-head">Experiments</div><div class="gr-section">${log.length} ${log.length === 1 ? 'mix' : 'mixes'} tried</div></div>` +
      `<div class="gj-scroll">${rows || `<div class="gr-empty">Nothing tried yet. Heat a mix in a cauldron long enough to judge, and it is written here.</div>`}</div>` +
      `<div class="gj-foot"><span class="gj-more">more below &#9662;</span></div>`;
    const have = loadClues();
    const total = RECIPES.filter((r) => !known[r.id]).reduce((n, r) => n + cluesFor(r.id).length, 0);
    const found = CLUES.filter((c) => have[c.id] && RECIPES.some((r) => r.id === c.recipe && !known[r.id])).length;
    this.right.innerHTML =
      `<div class="gj-head"><div class="gr-head">How the cauldron judges</div></div>` +
      `<div class="gj-scroll">` +
      `<p class="gj-line"><b>Nothing stirred</b><span>Nothing in the bowl answers anything.</span></p>` +
      `<p class="gj-line"><b>It shimmered</b><span>The right things are in, in the wrong amounts. A reagent underlined solid belongs and is enough; underlined dotted, it belongs and wants more; faded, it has no part in it.</span></p>` +
      `<p class="gj-line"><b>It clouded</b><span>The amounts are right but something foreign spoils the mix.</span></p>` +
      `<p class="gj-missing">${RECIPES.filter((r) => known[r.id]).length} of ${RECIPES.length} elixirs known; ${found} of ${total} notes found for the rest.</p>` +
      `</div><div class="gj-foot"><span class="gj-more">more below &#9662;</span></div>`;
  }

  // ------------------------------------------------------------------- Lore
  private renderLore(): void {
    const lore = discoveredLore();
    const loreEntries = Object.entries(MATERIAL_LORE).filter(([id]) => lore[id]);
    const total = Object.keys(MATERIAL_LORE).length;
    const interactions = loadDiscoveredInteractions();
    const interactionEntries = GRIMOIRE_INTERACTIONS.filter((entry) => interactions[entry.id]);
    this.left.innerHTML =
      `<div class="gj-head"><div class="gr-head">Material Lore</div><div class="gr-section">${loreEntries.length} of ${total} studied</div></div>` +
      `<div class="gj-scroll">` +
      (loreEntries.length
        ? loreEntries
            .map(([, e]) => `<div class="gr-entry"><div class="gr-title">${esc(e!.title)}</div><div class="gr-sub">${esc(e!.body)}</div>${e!.margin ? `<div class="gr-margin">${esc(e!.margin)}</div>` : ''}</div>`)
            .join('')
        : `<div class="gr-empty">Examine the world (press <b>I</b>) to record what its materials do.</div>`) +
      `</div><div class="gj-foot"><span class="gj-more">more below &#9662;</span></div>`;
    this.right.innerHTML =
      `<div class="gj-head"><div class="gr-head">Interactions</div><div class="gr-section">${interactionEntries.length} of ${GRIMOIRE_INTERACTIONS.length} witnessed</div></div>` +
      `<div class="gj-scroll">` +
      (interactionEntries.length
        ? interactionEntries.map((entry) => `<div class="gr-entry"><div class="gr-title">${esc(entry.title)}</div><div class="gr-sub">${esc(entry.body)}</div></div>`).join('')
        : `<div class="gr-empty">Watch what the materials do to one another; the book writes down what it sees.</div>`) +
      `</div><div class="gj-foot"><span class="gj-more">more below &#9662;</span></div>`;
  }

  // ---------------------------------------------------------------- Journal
  /** The Journal: every page the Works have given this player, re-readable in their voices. */
  private renderJournal(): void {
    const pages: StoryJournalPage[] = this.ctx.story?.journal() ?? [];
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
  }

  /** A scrolling column with more below its fold fades out at the foot and says so. */
  private markMore(el: HTMLElement): void {
    const more = el.scrollHeight - el.scrollTop - el.clientHeight > 4;
    el.classList.toggle('more', more);
    el.parentElement?.querySelector('.gj-more')?.classList.toggle('on', more);
  }

  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    window.removeEventListener('keydown', this.onKey);
    this.overlay.remove();
    this.style.remove();
  }
}
