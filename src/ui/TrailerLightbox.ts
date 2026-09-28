import type { Ctx } from '@/core/types';

/** The launch trailer (public/trailer): a web encode of the 1080p60 master, under the host's 25 MiB file cap. */
export const TRAILER_SRC = '/trailer/breathing-works-trailer.mp4';
export const TRAILER_POSTER = '/trailer/poster.jpg';

/**
 * Play the trailer over the title in a modal. The game's own sound holds its
 * breath meanwhile (the AudioContext is suspended, which silences the score,
 * the narrator and every cue) and comes back exactly as it was on close.
 * Esc, the Close button, a click outside the picture or the trailer ending all
 * close it; focus returns to whatever opened it.
 */
export function openTrailer(ctx: Ctx, returnFocus?: HTMLElement | null): void {
  if (document.getElementById('trailer-lightbox')) return;
  const hushed = ctx.audio.enabled;
  if (hushed) ctx.audio.toggle();

  const root = document.createElement('div');
  root.id = 'trailer-lightbox';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Breathing Works: the trailer');
  root.innerHTML = `<div class="tl-frame">
      <button type="button" class="tl-close">Close <kbd>Esc</kbd></button>
      <video controls autoplay playsinline preload="auto" poster="${TRAILER_POSTER}" src="${TRAILER_SRC}"></video>
    </div>`;
  const video = root.querySelector('video')!;

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    e.stopImmediatePropagation();
    close();
  };
  const close = (): void => {
    video.pause();
    root.remove();
    window.removeEventListener('keydown', onKey, true);
    if (hushed && !ctx.audio.enabled) ctx.audio.toggle();
    returnFocus?.focus();
  };

  root.addEventListener('click', (e) => { if (e.target === root) close(); });
  root.querySelector('.tl-close')!.addEventListener('click', close);
  video.addEventListener('ended', close);
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  video.focus();
}
