import type { Ctx } from '@/core/types';
import { isRunLauncherOpen } from '@/ui/RunLauncher';
import { getBindings, keyLabel, type BindingAction } from '@/input/bindings';

interface HandbookPage {
  id: string;
  title: string;
  /** One line under the title: what this page is for. */
  lead: string;
  /** HTML body; {action} becomes the player's current key for that binding. */
  body: string;
}

const PAGES: readonly HandbookPage[] = [
  {
    id: 'descent', title: 'The descent',
    lead: 'Where you are going, and what happens when it goes wrong.',
    body: `
      <p>You start in <b>the Breathing Works</b>, a flooded refinery. Its lower gate answers only to a <b>brass bell</b>,
      and the only thing that makes one is the <b>Bell &amp; Tea Engine</b>. Its crank sits caged in the Intake behind a
      cold lock; find a way to open it and pull the crank. Walk the catwalk under the engine as it runs: three of its
      stations stick, and a wand shot, a kick or your water flask sets each going again (left alone, each has a slow
      backup). Collect the bell from the end of the catwalk and carry it down to the lower gate.</p>
      <p>Deeper depths are wilder caves. Each hides a <b>key</b> that opens its exit portal, and between depths the
      <b>Sanctum</b> trades boons and provisions for the gold you carry.</p>
      <h4>Resting and dying</h4>
      <ul>
        <li>Stand still at the <b>Warm Refuge</b> to heal fully and refill your glowseeds. It also becomes your return point.</li>
        <li>Elsewhere, light a <b>waystone</b> by holding fire on the bowl at its base.</li>
        <li>When you die you wake at your last lit waystone. The world stays exactly as you left it; some of the gold you
        carried stays where you fell.</li>
      </ul>`,
  },
  {
    id: 'moving', title: 'Moving',
    lead: 'The alchemist climbs, crawls and kicks. The keys below are your current bindings.',
    body: `
      <dl class="hb-keys">
        <dt>{left} {right}</dt><dd>Walk and run</dd>
        <dt>{jump}</dt><dd>Jump. Hold it in the air to levitate while the gold bar lasts</dd>
        <dt>{down}</dt><dd>Crouch and crawl into low tunnels. In the air: a diving slam</dd>
        <dt>{climb} + {up} {down}</dt><dd>Grab a wall and climb it</dd>
        <dt>{kick}</dt><dd>Kick crates, creatures and loose rubble</dd>
        <dt>{carry}</dt><dd>Pick up and throw a crate, a body or a severed limb</dd>
        <dt>{interact}</dt><dd>Turn valves and cranks, pull levers, siphon liquid</dd>
      </dl>
      <p>Remap any of these from <b>Pause → Controls &amp; comfort</b>.</p>`,
  },
  {
    id: 'wands', title: 'Wands and spells',
    lead: 'A wand is a sentence of spell cards, read left to right.',
    body: `
      <dl class="hb-keys">
        <dt>Left click</dt><dd>Cast the wand's next group of cards</dd>
        <dt>Wheel · 1 · 2</dt><dd>Swap between your two wands</dd>
        <dt>B</dt><dd>Open the Wandsmith's bench to arrange cards</dd>
      </dl>
      <ul>
        <li><b>Projectiles</b> are the spell itself: Spark Bolt, Frost Shard, Chain Lightning.</li>
        <li><b>Modifiers</b> change the projectile after them: heavier, faster, bouncing, trailing water.</li>
        <li><b>Multicast</b> cards fire the next two or three projectiles as one volley.</li>
        <li>After the last card the wand <b>recharges</b> and starts over. A group that costs more mana than the tank holds will not fire.</li>
      </ul>
      <p>Spell <b>tomes</b> found in the caves let you choose a new card. It goes to your collection: slot it at the bench.</p>`,
  },
  {
    id: 'alchemy', title: 'Flasks and alchemy',
    lead: 'Your flasks carry real cells of the world, and put them back.',
    body: `
      <dl class="hb-keys">
        <dt>3 – 6</dt><dd>Choose a flask</dd>
        <dt>Hold {interact}</dt><dd>Siphon liquid or loose powder into it</dd>
        <dt>{pour}</dt><dd>Pour it out</dd>
        <dt>{drink}</dt><dd>Drink it</dd>
        <dt>Right click</dt><dd>Throw the whole bottle</dd>
      </dl>
      <ul>
        <li><b>Water</b> douses fire and conducts electricity. <b>Nitrogen</b> freezes water to ice. <b>Oil</b> burns long and hot.</li>
        <li>Drop ingredients into a heated <b>cauldron</b> to brew elixirs; every recipe you discover is written into your <b>Grimoire</b> (J).</li>
        <li>A <b>heart</b> grows your vessel at once, but refilling it is a communion: you are rooted and unarmed while it runs.</li>
      </ul>`,
  },
  {
    id: 'locks', title: 'Locks made of physics',
    lead: 'Every lock reads real material. Give it what it measures.',
    body: `
      <ul>
        <li><b>Plates</b> want weight. <b>Levers</b> flip with {interact}, or with a blast. <b>Braziers</b> want fire.</li>
        <li>A <b>sand scale</b> wants material poured onto its pan; a <b>sluice</b> wants its basin flooded; a <b>charge coil</b> wants one spark.</li>
        <li><b>Ice probes</b> count ice, not water. The Intake's cold lock opens when both probes in its cistern read enough ice: freeze it with Frost Shard or anything colder.</li>
        <li><b>Rune glyphs</b> open distant vaults when any spell strikes them.</li>
      </ul>
      <p>Wreck a mechanism and its gate groans open about half a minute later. Physics never locks you out for good.</p>`,
  },
  {
    id: 'creatures', title: 'Creatures',
    lead: 'They see, hear and feel the world the way you do. Use that.',
    body: `
      <ul>
        <li>Sight needs light and a creature facing you. Crouching makes you harder to see.</li>
        <li>Casting is loud. Footsteps carry through rock, and wading carries even further through water.</li>
        <li>The <b>Stone Maw</b> is blind, but feels any body a few lengths away, in the dark or behind it. It chews through soft rock, not metal.</li>
        <li>A <b>Rillback</b> is fast and electric in water and clumsy on land. Drain its pool and it flounders.</li>
        <li>A <b>Weaver</b> can lose legs to aimed shots. Pick one up with {carry} and it is a whip.</li>
        <li><b>Glowseeds</b> ({lure}) draw lantern insects, and hungry creatures follow the insects.</li>
      </ul>`,
  },
  {
    id: 'map', title: 'The map',
    lead: 'Everything you have seen is charted as you go.',
    body: `
      <dl class="hb-keys">
        <dt>M</dt><dd>Open the chart</dd>
        <dt>Click</dt><dd>Set a waypoint on a place or on charted ground</dd>
        <dt>Right click</dt><dd>Clear the waypoint</dd>
      </dl>
      <p>The chart lists the places you have found, nearest first; click one to steer by it. A compass at the edge of
      the screen points to your waypoint and counts down the distance.</p>`,
  },
  {
    id: 'clips', title: 'Keeping a moment',
    lead: 'The Works keeps the last ten seconds on a glass plate, in case something splendid happens.',
    body: `
      <dl class="hb-keys">
        <dt>{clip}</dt><dd>Save the last ten seconds as a looping GIF</dd>
        <dt>View</dt><dd>The same, from a controller</dd>
        <dt>Death screen</dt><dd><b>Save the last seconds</b> keeps the fall itself</dd>
      </dl>
      <p>The clip develops in the corner while you play on: download it, or copy a still. Recording pauses with the
      game and can be switched off in <b>Pause → Controls &amp; comfort</b>.</p>`,
  },
];

/**
 * The Alchemist's Handbook (H): a paused, readable field guide. One page at a
 * time, chosen from a list, with keys drawn from the player's live bindings.
 */
export class HelpOverlay {
  private visible = false;
  /** Pause state to restore on close (the Sanctum owns its own pause). */
  private pausedBefore = false;
  private page = PAGES[0].id;
  private readonly root: HTMLElement | null;
  private readonly nav: HTMLElement;
  private readonly article: HTMLElement;

  constructor(private ctx: Ctx) {
    window.addEventListener('keydown', this.onKeyDown);
    this.root = document.getElementById('help-overlay');
    const shell = document.createElement('div');
    shell.className = 'hb-shell';
    shell.setAttribute('role', 'dialog');
    shell.setAttribute('aria-modal', 'true');
    shell.setAttribute('aria-labelledby', 'hb-title');
    shell.innerHTML = `
      <div class="hb-head">
        <div>
          <h2 class="menu-title" id="hb-title">The Alchemist's Handbook</h2>
          <p class="menu-sub">Everything here is real material. If it looks like it should burn, flow, freeze or break, try it.</p>
        </div>
        <button type="button" class="menu-close hb-close"><kbd class="key">H</kbd>Close</button>
      </div>
      <div class="hb-body">
        <nav class="hb-nav" role="tablist" aria-orientation="vertical" aria-label="Handbook pages"></nav>
        <article class="hb-page" role="tabpanel" tabindex="0"></article>
      </div>
      <div class="hb-foot"><span><kbd class="key">↑</kbd><kbd class="key">↓</kbd>choose a page</span><span><kbd class="key">H</kbd><kbd class="key">Esc</kbd>close</span></div>`;
    this.nav = shell.querySelector('.hb-nav')!;
    this.article = shell.querySelector('.hb-page')!;
    shell.querySelector('.hb-close')?.addEventListener('click', () => { if (this.visible) this.toggle(); });
    for (const page of PAGES) {
      const tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'hb-tab';
      tab.id = 'hb-tab-' + page.id;
      tab.setAttribute('role', 'tab');
      tab.textContent = page.title;
      tab.addEventListener('click', () => this.show(page.id));
      this.nav.appendChild(tab);
    }
    this.nav.addEventListener('keydown', this.onNavKey);
    this.root?.replaceChildren(shell);
  }

  private readonly onNavKey = (e: KeyboardEvent): void => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const at = PAGES.findIndex((p) => p.id === this.page);
    const next = PAGES[(at + (e.key === 'ArrowDown' ? 1 : -1) + PAGES.length) % PAGES.length];
    this.show(next.id);
    document.getElementById('hb-tab-' + next.id)?.focus();
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented) return;
    if (isRunLauncherOpen() && !this.visible) return;
    if ((document.getElementById('builder-intent-modal') || document.querySelector('.app-dialog-root')) && !this.visible) return;
    if (document.body.classList.contains('builder-open') && !this.visible) return;
    if (e.code === 'KeyH' && !e.repeat && !this.ctx.sanctum.isOpen) {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    } else if (e.code === 'Escape' && this.visible) {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    } else if (this.visible && (e.key === 'ArrowDown' || e.key === 'ArrowUp') && !this.nav.contains(document.activeElement)) {
      this.onNavKey(e);
    }
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
  }

  /** Render one page with the player's live key bindings. */
  private show(id: string): void {
    const page = PAGES.find((p) => p.id === id) ?? PAGES[0];
    this.page = page.id;
    for (const tab of this.nav.querySelectorAll<HTMLElement>('.hb-tab')) {
      const on = tab.id === 'hb-tab-' + page.id;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
    }
    const bindings = getBindings();
    const body = page.body.replace(/\{(\w+)\}/g, (match, action: string) => {
      const code = (bindings as Record<string, string>)[action as BindingAction];
      return code ? '<kbd class="key">' + keyLabel(code) + '</kbd>' : match;
    });
    this.article.setAttribute('aria-labelledby', 'hb-tab-' + page.id);
    this.article.innerHTML = `<h3>${page.title}</h3><p class="hb-lead">${page.lead}</p>${body}`;
    this.article.scrollTop = 0;
  }

  private toggle(): void {
    this.visible = !this.visible;
    this.root?.classList.toggle('visible', this.visible);
    if (this.visible) {
      this.pausedBefore = this.ctx.state.paused;
      this.ctx.state.paused = true;
      this.show(this.page);
      document.getElementById('hb-tab-' + this.page)?.focus({ preventScroll: true });
    } else {
      this.ctx.state.paused = this.pausedBefore;
    }
  }
}
