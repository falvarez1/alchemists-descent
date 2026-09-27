import type { ClipOverlayMessage } from '@/app/clipProtocol';

/**
 * Clip overlays drawn with the document's fonts (workers do not share them):
 * the maker's mark on every frame and, for a death, the title card over the
 * closing frames. Rendered once per clip on the main thread as small RGBA
 * sprites; the worker composites them into the frames.
 */

const SERIF = "'Cormorant Garamond', Georgia, serif";

async function fontReady(spec: string, ms = 500): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return;
  await Promise.race([document.fonts.load(spec).then(() => undefined, () => undefined), new Promise<void>((r) => setTimeout(r, ms))]);
}

/**
 * "Breathing Works · The Bellows", set small in the house serif at the
 * bottom-right: brass over a one-pixel hard shadow. A soft blur would smear
 * into the palette; a hard pixel shadow stays legible over any cave.
 */
export async function renderWatermark(title: string, place: string, frameW: number, frameH: number): Promise<ClipOverlayMessage | null> {
  if (typeof document === 'undefined') return null;
  const scale = Math.max(0.75, frameW / 480);
  const titlePx = Math.round(15 * scale);
  const placePx = Math.round(13 * scale);
  const titleFont = `600 ${titlePx}px ${SERIF}`;
  const placeFont = `italic 500 ${placePx}px ${SERIF}`;
  await Promise.all([fontReady(titleFont), fontReady(placeFont)]);

  const canvas = document.createElement('canvas');
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  const sep = '  ·  ';
  g.font = titleFont;
  const titleW = Math.ceil(g.measureText(title).width);
  g.font = placeFont;
  const sepW = Math.ceil(g.measureText(sep).width);
  const placeW = place ? Math.ceil(g.measureText(place).width) : 0;
  const padX = 3;
  const w = padX * 2 + titleW + (place ? sepW + placeW : 0) + 1;
  const h = Math.round(titlePx * 1.35) + 1;
  canvas.width = w;
  canvas.height = h;
  const baseline = Math.round(titlePx * 1.02);

  const draw = (dx: number, dy: number, colors: { title: string; sep: string; place: string }): void => {
    let x = padX + dx;
    g.textBaseline = 'alphabetic';
    g.font = titleFont;
    g.fillStyle = colors.title;
    g.fillText(title, x, baseline + dy);
    x += titleW;
    if (!place) return;
    g.font = placeFont;
    g.fillStyle = colors.sep;
    g.fillText(sep, x, baseline + dy);
    x += sepW;
    g.fillStyle = colors.place;
    g.fillText(place, x, baseline + dy);
  };
  const shadow = 'rgba(8, 15, 18, 0.82)';
  draw(1, 1, { title: shadow, sep: shadow, place: shadow });
  draw(0, 0, { title: 'rgba(238, 222, 176, 0.96)', sep: 'rgba(189, 148, 96, 0.9)', place: 'rgba(214, 222, 205, 0.9)' });

  const rgba = g.getImageData(0, 0, w, h).data;
  const margin = Math.round(6 * scale);
  return {
    rgba: rgba.buffer,
    w,
    h,
    x: Math.max(0, frameW - w - margin),
    y: Math.max(0, frameH - h - Math.round(margin * 0.6)),
  };
}

/**
 * A death clip ends the way the death does in game: the title card. Spaced
 * capitals in the house serif over a soft band of shade, the obituary in
 * italics beneath, fading in over the clip's closing frames. The in-game card
 * is DOM (never in the canvas), so without this a shared death reads as a
 * stumble rather than an ending.
 */
export async function renderDeathCard(
  title: string,
  line: string,
  frameW: number,
  frameH: number,
  lastFrames: number,
  fadeFrames: number,
): Promise<ClipOverlayMessage | null> {
  if (typeof document === 'undefined' || !title.trim()) return null;
  const scale = Math.max(0.75, frameW / 480);
  const titlePx = Math.round(21 * scale);
  const linePx = Math.round(12 * scale);
  const titleFont = `500 ${titlePx}px ${SERIF}`;
  const lineFont = `italic 500 ${linePx}px ${SERIF}`;
  await Promise.all([fontReady(titleFont), fontReady(lineFont)]);

  const canvas = document.createElement('canvas');
  const w = frameW;
  const h = Math.round(titlePx * 3.6);
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  // Shade so the letters hold over fire as well as over rock.
  const band = g.createLinearGradient(0, 0, 0, h);
  band.addColorStop(0, 'rgba(4, 7, 9, 0)');
  band.addColorStop(0.35, 'rgba(4, 7, 9, 0.5)');
  band.addColorStop(0.72, 'rgba(4, 7, 9, 0.5)');
  band.addColorStop(1, 'rgba(4, 7, 9, 0)');
  g.fillStyle = band;
  g.fillRect(0, 0, w, h);

  const spaced = g as CanvasRenderingContext2D & { letterSpacing?: string };
  const canSpace = 'letterSpacing' in spaced;
  g.textAlign = 'center';
  g.textBaseline = 'alphabetic';
  g.font = titleFont;
  if (canSpace) spaced.letterSpacing = `${Math.round(titlePx * 0.16)}px`;
  const titleY = Math.round(h * 0.5);
  g.shadowColor = 'rgba(0, 0, 0, 0.85)';
  g.shadowBlur = Math.round(6 * scale);
  g.shadowOffsetY = Math.round(2 * scale);
  g.fillStyle = '#eadfc2';
  g.fillText(title.toUpperCase(), w / 2, titleY, w - 24);
  if (canSpace) spaced.letterSpacing = '0px';
  if (line.trim()) {
    g.font = lineFont;
    g.shadowBlur = Math.round(4 * scale);
    g.shadowOffsetY = Math.round(1 * scale);
    g.fillStyle = '#c9cfc0';
    g.fillText(line, w / 2, titleY + Math.round(linePx * 1.7), w - 32);
  }

  const rgba = g.getImageData(0, 0, w, h).data;
  // Where the in-game card sits: a little below centre.
  const y = Math.max(0, Math.min(frameH - h, Math.round(frameH * 0.6 - h * 0.5)));
  return { rgba: rgba.buffer, w, h, x: 0, y, fromEnd: lastFrames, fadeFrames };
}
