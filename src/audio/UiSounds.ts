import type { AudioApi } from '@/core/types';
import type { EventBus } from '@/core/events';
import type { SfxId } from '@/content/audio/sfxCues';

/**
 * The interface's sounds, without touching any UI module:
 *
 * - Every button-like element in the page gets a soft brass hover tick and a
 *   click (delegated listeners on the document), a close/back button a
 *   softer knock, a card in the offer overlay its own decisive "chosen".
 *   Elements that already sound their own action (the wand bench's card
 *   tiles) or opt out with `data-sfx="none"` stay quiet, and so does the
 *   Builder (an authoring tool, not the game's interface).
 * - Overlays announce themselves: the pause menu closes a steam valve and
 *   opens it again on resume; the Grimoire, Handbook and settings open and
 *   close like a ledger (a MutationObserver watches their visibility).
 * - Run events: toasts tick, a new objective arrives by pneumatic tube,
 *   a card offer fans its cards, a hint turns a page, the bench drawer slides
 *   out, the level curtain sweeps.
 *
 * Hovering never creates the AudioContext (it is not a gesture); until the
 * first click there is simply nothing to hear.
 */
const BUTTONISH = 'button, [role="button"], a[href], summary, select, input[type="checkbox"], input[type="range"], .menu-item';
/** The Builder is an authoring tool: its panels stay quiet. */
const QUIET_ZONES = '#builder-root';
/** Clicks that already make their own sound. */
const OWN_SOUND = '[data-sfx="none"], .wb-shell button:not(.menu-close), .wb-shell [role="button"], .card-offer-card';
const BACKISH = '.menu-close, [id*="close"], [id*="cancel"], [class*="close"], [aria-label*="close" i], [data-sfx="back"]';

interface OverlayWatch { selector: string; isOpen: (el: Element) => boolean; open: SfxId; close: SfxId }
const OVERLAYS: OverlayWatch[] = [
  { selector: '#pause-overlay', isOpen: (el) => el.classList.contains('visible'), open: 'ui.pause', close: 'ui.resume' },
  { selector: '#grimoire-overlay', isOpen: (el) => el.classList.contains('open'), open: 'ui.open', close: 'ui.close' },
  { selector: '#help-overlay', isOpen: (el) => el.classList.contains('visible'), open: 'ui.open', close: 'ui.close' },
  { selector: '#player-settings', isOpen: (el) => el.hasAttribute('open'), open: 'ui.open', close: 'ui.close' },
];

export function installUiSounds(events: EventBus, audio: Pick<AudioApi, 'sfx'>, doc: Document | null = typeof document !== 'undefined' ? document : null): () => void {
  let lastEventCue = -1e9;
  const eventCue = (id: SfxId, quietAfterOther = false): void => {
    const now = performance.now();
    // A toast that lands with a bigger cue (a key pickup, an objective) stays quiet.
    if (quietAfterOther && now - lastEventCue < 300) return;
    lastEventCue = now;
    audio.sfx(id);
  };
  const off = [
    events.on('toast', () => eventCue('ui.toast', true)),
    events.on('objectiveChanged', () => eventCue('ui.objective')),
    events.on('hintTeach', () => eventCue('ui.hint')),
    events.on('grimoireEntryDiscovered', () => eventCue('ui.grimoire')),
    events.on('cardOfferRequested', () => eventCue('ui.card.reveal')),
    events.on('benchOpened', () => eventCue('ui.bench')),
    events.on('runLedger', ({ open }) => eventCue(open ? 'ui.open' : 'ui.close')),
    events.on('levelCurtain', ({ visible }) => { if (visible) eventCue('ui.curtain'); }),
  ];
  if (!doc) return () => { for (const dispose of off) dispose(); };

  let hovered: Element | null = null;
  const buttonAt = (target: EventTarget | null): Element | null => {
    const el = target instanceof Element ? target.closest(BUTTONISH) : null;
    if (!el || (el as HTMLButtonElement).disabled || el.getAttribute('aria-disabled') === 'true') return null;
    if (el.closest(QUIET_ZONES)) return null;
    return el;
  };
  const onOver = (e: Event): void => {
    const el = buttonAt(e.target);
    if (!el || el === hovered) return;
    hovered = el;
    if (!el.matches('[data-sfx="none"]')) audio.sfx('ui.hover');
  };
  const onOut = (e: Event): void => {
    if (hovered && !(e instanceof MouseEvent && e.relatedTarget instanceof Node && hovered.contains(e.relatedTarget))) hovered = null;
  };
  const onClick = (e: Event): void => {
    const el = buttonAt(e.target);
    if (!el) return;
    if (el.matches('.card-offer-card')) { audio.sfx('ui.card.choose'); return; }
    if (el.closest(OWN_SOUND)) return;
    audio.sfx(el.matches(BACKISH) ? 'ui.back' : 'ui.click');
  };
  doc.addEventListener('pointerover', onOver, { passive: true });
  doc.addEventListener('pointerout', onOut, { passive: true });
  doc.addEventListener('click', onClick, true);

  // Overlay open/close, by watching the elements' own visibility state.
  const observers: MutationObserver[] = [];
  const attach = (): void => {
    for (const w of OVERLAYS) {
      const el = doc.querySelector(w.selector);
      if (!el || (el as HTMLElement).dataset.sfxWatched) continue;
      (el as HTMLElement).dataset.sfxWatched = '1';
      let open = w.isOpen(el);
      const mo = new MutationObserver(() => {
        const now = w.isOpen(el);
        if (now === open) return;
        open = now;
        audio.sfx(now ? w.open : w.close);
      });
      mo.observe(el, { attributes: true, attributeFilter: ['class', 'open', 'hidden'] });
      observers.push(mo);
    }
  };
  attach();
  // Some overlays are built lazily; look again a few times.
  const retry = setInterval(attach, 2000);
  const stopRetry = setTimeout(() => clearInterval(retry), 60_000);

  return () => {
    for (const dispose of off) dispose();
    doc.removeEventListener('pointerover', onOver);
    doc.removeEventListener('pointerout', onOut);
    doc.removeEventListener('click', onClick, true);
    for (const mo of observers) mo.disconnect();
    clearInterval(retry);
    clearTimeout(stopRetry);
  };
}
