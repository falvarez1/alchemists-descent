/**
 * The foundry UI kit (public/assets/arena/ui, kit.json; foundry-ui.css): a stylesheet only fetches an image the first
 * time something paints with it, so a Duel screen would open with its frames, words and signs still arriving. Every
 * piece is fetched once the game is idle instead (about 330 KB, all small PNGs) and held, so they are in the cache.
 */
const PIECES = [
  'panel-large', 'card', 'card-teal', 'slot', 'picture-frame', 'fill-iron', 'fill-worn', 'text-copper', 'text-iron',
  'button-primary', 'button-primary-hot', 'button-primary-pressed', 'button-secondary', 'button-secondary-hot', 'button-secondary-pressed',
  'keycap', 'gear-crest', 'medallion', 'word-vs', 'seal', 'seal-teal', 'arrow-left', 'arrow-left-hot', 'arrow-right', 'arrow-right-hot',
  'divider-line', 'divider-diamond', 'divider-cap-left', 'divider-cap-right', 'chain', 'lantern', 'lantern-glow', 'gear-small',
  'hanging-sign', 'banner-plate', 'band', 'word-fight', 'word-game', 'word-time', 'word-3', 'word-2', 'word-1',
  'bead', 'bead-spent', 'bead-teal', 'bead-teal-spent',
  'list-row', 'list-row-hot', 'ribbon', 'nameplate', 'nameplate-hanging', 'hud-card', 'hud-card-teal', 'meter', 'meter-cell', 'meter-cell-teal',
] as const;

const held: HTMLImageElement[] = [];
let started = false;

/** Fetch every kit piece when the page is next idle (once; a no-op without a DOM). */
export function preloadFoundryKit(): void {
  if (started || typeof Image === 'undefined' || typeof window === 'undefined') return;
  started = true;
  const load = (): void => {
    for (const name of PIECES) {
      const img = new Image();
      img.decoding = 'async';
      img.src = `${import.meta.env.BASE_URL}assets/arena/ui/${name}.png`;
      held.push(img);
    }
  };
  if ('requestIdleCallback' in window) window.requestIdleCallback(load, { timeout: 3000 });
  else setTimeout(load, 500);
}
