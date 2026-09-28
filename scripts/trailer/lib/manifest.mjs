// shots.json (the editor's index) and contact-sheet.png, rebuilt from the
// per-shot sidecars (<id>.json) so partial re-records never lose other shots.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import { marksFrom } from './marks.mjs';

export function writeManifest(out, registry) {
  const order = new Map(registry.map((s, i) => [s.id, i]));
  const sidecars = readdirSync(out)
    .filter((f) => f.endsWith('.json') && f !== 'shots.json')
    .map((f) => JSON.parse(readFileSync(join(out, f), 'utf8')))
    .filter((s) => s && s.id && existsSync(join(out, s.file)))
    .sort((a, b) => (order.get(a.id) ?? 1e9) - (order.get(b.id) ?? 1e9) || a.id.localeCompare(b.id));
  // Marks are re-derived from the event log, so label rules apply to every
  // sidecar that kept its manual marks apart.
  for (const s of sidecars) if (Array.isArray(s.manualMarks)) s.marks = marksFrom(s.events, s.manualMarks);
  const manifest = sidecars.map((s) => ({
    id: s.id,
    file: s.file,
    durationS: s.durationS,
    fps: s.fps,
    level: s.level,
    description: s.description,
    bestWindow: s.bestWindow,
    marks: s.marks,
    events: s.events,
    priority: s.priority,
    ...(s.slowmo ? { slowmo: s.slowmo } : {}),
  }));
  writeFileSync(join(out, 'shots.json'), JSON.stringify(manifest, null, 2));
  return sidecars;
}

const HERO_KINDS = ['impact', 'kill', 'callout', 'boss', 'light', 'action', 'creature', 'beat'];

export function heroTime(s) {
  if (typeof s.hero === 'number') return s.hero;
  const { startS, endS } = s.bestWindow;
  for (const kind of HERO_KINDS) {
    const m = s.marks.find((mark) => mark.kind === kind && mark.t >= startS && mark.t <= endS);
    if (m) return Math.min(endS, m.t + 0.25);
  }
  return (startS + endS) / 2;
}

function grab(file, t, png) {
  spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(Math.max(0, t)), '-i', file,
    '-frames:v', '1', '-vf', 'scale=480:270:flags=lanczos', png]);
  return existsSync(png);
}

export async function writeContactSheet(out, sidecars) {
  const dir = join(tmpdir(), 'trailer-contact');
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cells = [];
  for (const s of sidecars) {
    const file = join(out, s.file);
    const times = [
      ['start', s.bestWindow.startS],
      ['hero', heroTime(s)],
      ['end', Math.min(s.bestWindow.endS, s.durationS - 0.05)],
    ];
    const imgs = [];
    for (const [name, t] of times) {
      const png = join(dir, `${s.id}-${name}.png`);
      if (grab(file, t, png)) imgs.push({ src: pathToFileURL(png).href, label: `${name} ${t.toFixed(2)}s` });
    }
    cells.push({ id: s.id, level: s.level, dur: s.durationS, priority: s.priority, imgs });
  }
  const esc = (v) => String(v).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const html = `<!doctype html><meta charset="utf-8"><style>
    body { margin: 0; padding: 24px; background: #0d1417; color: #e6dfca; font: 14px/1.3 ui-monospace, Consolas, monospace; width: 3040px; }
    h1 { font: 600 28px Georgia, serif; margin: 0 0 18px; color: #c8ad7c; }
    .grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 18px 28px; }
    .shot { background: #152024; padding: 10px; border-radius: 6px; }
    .head { display: flex; gap: 14px; align-items: baseline; margin: 0 0 8px; }
    .id { font-size: 20px; color: #fff; font-weight: 700; }
    .meta { color: #9fb2a8; }
    .row { display: flex; gap: 8px; }
    figure { margin: 0; }
    img { display: block; width: 480px; height: 270px; background: #000; }
    figcaption { color: #9fb2a8; font-size: 12px; margin-top: 3px; }
  </style><h1>Breathing Works trailer footage (${cells.length} shots)</h1><div class="grid">${cells.map((c) => `
    <div class="shot"><div class="head"><span class="id">${esc(c.id)}</span><span class="meta">${esc(c.priority ?? '')} / ${esc(c.level)} / ${c.dur.toFixed(2)}s</span></div>
    <div class="row">${c.imgs.map((i) => `<figure><img src="${i.src}"><figcaption>${esc(i.label)}</figcaption></figure>`).join('')}</div></div>`).join('')}
  </div>`;
  const htmlFile = join(dir, 'sheet.html');
  writeFileSync(htmlFile, html);
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 3088, height: 800 } });
    await page.goto(pathToFileURL(htmlFile).href);
    await page.waitForLoadState('load');
    await page.screenshot({ path: join(out, 'contact-sheet.png'), fullPage: true });
  } finally {
    await browser.close();
  }
}
