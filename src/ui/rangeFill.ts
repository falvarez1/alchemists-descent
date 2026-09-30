/**
 * Paints the filled part of a `.st-range` slider (styles/studio.css).
 *
 * A native range input cannot style "the part left of the thumb" in Chromium
 * (Firefox has ::-moz-range-progress), so the track is a gradient that stops at
 * `--p`, the thumb's position in percent. This keeps `--p` true: on the user's
 * own drags (an `input` event bubbles up to the watched root), on sliders that
 * are added later (Inspector rebuilds its rows for each selection), and on a
 * programmatic `value =` write, which fires no event at all — callers pass those
 * through `syncRangeFill` / `syncAllRangeFills` (the Sandbox chrome does so on
 * `paramsChanged`, which is what every such write is followed by).
 */

export function syncRangeFill(input: HTMLInputElement): void {
  const min = parseFloat(input.min === '' ? '0' : input.min);
  const max = parseFloat(input.max === '' ? '100' : input.max);
  const value = parseFloat(input.value);
  const span = max - min;
  const pct = span > 0 && Number.isFinite(value) ? Math.min(100, Math.max(0, ((value - min) / span) * 100)) : 0;
  input.style.setProperty('--p', `${pct.toFixed(2)}%`);
}

export function syncAllRangeFills(root: ParentNode): void {
  for (const input of Array.from(root.querySelectorAll<HTMLInputElement>('input.st-range'))) syncRangeFill(input);
}

/**
 * Adopt every range slider under `root` (now and as they appear): give it the
 * `st-range` look and keep its fill current. Returns a disposer.
 */
export function watchRangeFill(root: HTMLElement): () => void {
  const adopt = (scope: ParentNode): void => {
    for (const input of Array.from(scope.querySelectorAll<HTMLInputElement>('input[type="range"]'))) {
      input.classList.add('st-range');
      syncRangeFill(input);
    }
  };
  adopt(root);
  const onInput = (event: Event): void => {
    const target = event.target;
    if (target instanceof HTMLInputElement && target.classList.contains('st-range')) syncRangeFill(target);
  };
  root.addEventListener('input', onInput);
  const observer =
    typeof MutationObserver === 'undefined'
      ? null
      : new MutationObserver((records) => {
          for (const record of records) {
            for (const node of Array.from(record.addedNodes)) {
              if (!(node instanceof HTMLElement)) continue;
              if (node instanceof HTMLInputElement && node.type === 'range') {
                node.classList.add('st-range');
                syncRangeFill(node);
              } else {
                adopt(node);
              }
            }
          }
        });
  observer?.observe(root, { childList: true, subtree: true });
  return () => {
    root.removeEventListener('input', onInput);
    observer?.disconnect();
  };
}
