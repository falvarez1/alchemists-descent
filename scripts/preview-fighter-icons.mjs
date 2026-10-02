// A static contact sheet of the fighters' ability icons (src/ui/fighterIcons.ts): every glyph at
// 64 and 32 px tinted in its fighter's accent and labelled with the ability's name, a 16/24/40 px
// ladder for the smallest sizes, an unlabelled 10 x 3 grid (the "can two be confused" test), and
// the role and slot glyphs. Needs no dev server: the TypeScript is bundled with esbuild into a
// temp module and the page is set with `page.setContent`.
//
// Writes verify-out/fighter-icons/sheet.png (everything), small.png (the 16/24/40 px ladder at 1x),
// tiny.png (all thirty at 16 px, 1x) and small-loupe.png (tiny.png blown up 4x, nearest-neighbour,
// to read the real pixels) and grid@2x.png (the labelled-by-position 72 px grid at 2x).
// Usage: node scripts/preview-fighter-icons.mjs [--out verify-out/fighter-icons]
import { build } from 'esbuild';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchBrowser } from './browser-launch.mjs';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const outArg = argv.indexOf('--out');
const outDir = resolve(repoRoot, outArg >= 0 ? argv[outArg + 1] : 'verify-out/fighter-icons');

const SLOTS = ['passive', 'tactical', 'ultimate'];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function loadModules() {
  const tmp = await mkdtemp(join(tmpdir(), 'ad-fighter-icons-'));
  const entryPath = join(tmp, 'entry.ts');
  await writeFile(
    entryPath,
    `export * from '@/ui/fighterIcons';\nexport { FIGHTER_DEFS, FIGHTER_ORDER, FIGHTER_ROLES } from '@/content/fighters';\n`,
    'utf8',
  );
  const bundlePath = join(tmp, 'bundle.mjs');
  await build({
    entryPoints: [entryPath],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile: bundlePath,
    logLevel: 'silent',
    alias: { '@': join(repoRoot, 'src') },
    define: { 'import.meta.env.DEV': 'false', 'import.meta.env.BASE_URL': '"/"' },
  });
  const mod = await import(pathToFileURL(bundlePath).href);
  return { mod, cleanup: () => rm(tmp, { recursive: true, force: true }) };
}

function buildHtml(mod) {
  const { abilityIcon, roleIcon, slotIcon, FIGHTER_DEFS, FIGHTER_ORDER, FIGHTER_ROLES } = mod;

  const rows = FIGHTER_ORDER.map((id) => {
    const def = FIGHTER_DEFS[id];
    const cells = SLOTS.map((slot) => {
      const ab = def[slot];
      return `<div class="cell" title="${esc(ab.description)}">
        <div class="pair"><span class="big">${abilityIcon(id, slot, 64)}</span><span class="mid">${abilityIcon(id, slot, 32)}</span></div>
        <div class="lab"><b>${esc(ab.name)}</b><i>${slot}</i></div>
      </div>`;
    }).join('');
    return `<div class="fighter" style="--accent:${def.accent}">
      <div class="who"><b>${esc(def.name)}</b><i>${esc(def.role)}</i></div>${cells}
    </div>`;
  }).join('');

  const ladder = (size, gap) =>
    `<div class="ladder" style="gap:${gap}px"><span class="size">${size}px</span>` +
    FIGHTER_ORDER.map((id) => {
      const accent = FIGHTER_DEFS[id].accent;
      return `<span class="trio" style="color:${accent}">${SLOTS.map((s) => abilityIcon(id, s, size)).join('')}</span>`;
    }).join('') +
    `</div>`;

  const hudChips = FIGHTER_ORDER.map((id) => {
    const def = FIGHTER_DEFS[id];
    return `<span class="chip-row" style="--accent:${def.accent}">${SLOTS.map(
      (s) => `<span class="chip">${abilityIcon(id, s, 28)}</span>`,
    ).join('')}</span>`;
  }).join('');

  // The confusability grid: columns = fighters, rows = slots, no labels, all in one tint.
  const grid = (color, size) =>
    `<div class="grid" style="color:${color}">` +
    SLOTS.map(
      (slot) =>
        `<div class="grow">${FIGHTER_ORDER.map((id) => `<span class="gcell">${abilityIcon(id, slot, size)}</span>`).join('')}</div>`,
    ).join('') +
    `</div>`;

  // the 16 px reading test: two rows of fifteen, fighter pairs kept together
  const tinyCells = FIGHTER_ORDER.flatMap((id) => SLOTS.map((s) => ({ id, s })));
  const tinyRow = (cells) =>
    `<div class="tr">${cells.map(({ id, s }) => `<span style="color:${FIGHTER_DEFS[id].accent}">${abilityIcon(id, s, 16)}</span>`).join('')}</div>`;
  const tiny = tinyRow(tinyCells.slice(0, 15)) + tinyRow(tinyCells.slice(15));

  const roles = FIGHTER_ROLES.map((r) => `<span class="rcell">${roleIcon(r, 40)}<i>${r}</i></span>`).join('');
  const slots = SLOTS.map((s) => `<span class="rcell">${slotIcon(s, 40)}<i>${s}</i></span>`).join('');
  const roles16 = FIGHTER_ROLES.map((r) => `<span style="margin-right:10px">${roleIcon(r, 16)}</span>`).join('') +
    SLOTS.map((s) => `<span style="margin-right:10px">${slotIcon(s, 16)}</span>`).join('');

  return `<!doctype html><html><head><meta charset="utf-8"><title>Fighter ability icons</title>
<style>
  :root { --bg:#0b0d12; --panel:#12151c; --edge:#262b36; --ink:#c9cfdb; --dim:#7b8392; }
  * { box-sizing: border-box; }
  body { margin:0; padding:24px 28px 40px; background:var(--bg); color:var(--ink); font:13px/1.35 'Segoe UI', system-ui, sans-serif; width:1560px; }
  h2 { margin:26px 0 10px; font:600 12px/1 'Segoe UI', system-ui, sans-serif; letter-spacing:.14em; text-transform:uppercase; color:var(--dim); }
  h2:first-child { margin-top:0; }
  svg { display:block; }
  .sheet { display:grid; grid-template-columns: 1fr 1fr; gap:10px 14px; }
  .fighter { display:grid; grid-template-columns: 104px repeat(3, 1fr); gap:6px; align-items:center; background:var(--panel); border:1px solid var(--edge); border-left:3px solid var(--accent); border-radius:8px; padding:10px 10px 10px 12px; }
  .who { display:flex; flex-direction:column; gap:2px; }
  .who b { color:var(--accent); font-size:13px; } .who i, .lab i { font-style:normal; color:var(--dim); font-size:11px; }
  .cell { display:flex; flex-direction:column; gap:6px; align-items:flex-start; }
  .pair { display:flex; align-items:flex-end; gap:10px; color:var(--accent); }
  .lab { display:flex; flex-direction:column; } .lab b { font-weight:600; font-size:12px; }
  .ladder { display:flex; align-items:center; margin:6px 0; } .size { width:44px; color:var(--dim); font-size:11px; }
  .trio { display:inline-flex; gap:3px; margin-right:9px; }
  .chips { display:flex; gap:10px; flex-wrap:wrap; }
  .chip-row { display:inline-flex; gap:5px; padding:5px; background:var(--panel); border:1px solid var(--edge); border-radius:8px; }
  .chip { display:grid; place-items:center; width:40px; height:40px; color:var(--accent); background:#0c0f15; border:1px solid color-mix(in srgb, var(--accent) 55%, #000); border-radius:6px; }
  .grid { display:flex; flex-direction:column; gap:8px; margin:4px 0 8px; } .grow { display:flex; gap:8px; }
  .gcell { display:grid; place-items:center; min-width:48px; padding:8px 10px; background:var(--panel); border:1px solid var(--edge); border-radius:6px; }
  .rcell { display:inline-flex; flex-direction:column; align-items:center; gap:6px; width:96px; color:#d8dde8; } .rcell i { font-style:normal; font-size:11px; color:var(--dim); }
  .row { display:flex; gap:12px; align-items:flex-start; }
  #small { padding:10px 12px; background:var(--bg); display:inline-block; }
  #small .ladder:first-child { margin-top:0; }
  .tint { color:#e7d9a6; }
  #tiny { display:inline-block; padding:8px; background:var(--bg); } .tr { display:flex; gap:8px; margin:6px 0; }
</style></head><body>
<h2>Abilities: 64 px and 32 px in each fighter's accent (hover = description)</h2>
<div class="sheet">${rows}</div>

<h2>Ladder: 16, 24 and 40 px, grouped by fighter (passive, tactical, ultimate)</h2>
<div id="small">${ladder(16, 0)}${ladder(24, 0)}${ladder(40, 0)}</div>

<h2>Loupe source: all 30 at 16 px, 1x (blown up 4x in small-loupe.png)</h2>
<div id="tiny">${tiny}</div>

<h2>HUD chips, 28 px in a bordered tile (how the dossier will use them)</h2>
<div class="chips">${hudChips}</div>

<h2>Grid, no labels (columns = fighters, rows = passive / tactical / ultimate): any two confusable?</h2>
<div class="row"><div>${grid('#dfe3ec', 72)}</div><div>${grid('#dfe3ec', 32)}</div></div>

<h2>Roles and slots</h2>
<div class="row"><div>${roles}</div><div style="width:40px"></div><div>${slots}</div><div style="width:40px"></div><div class="tint" style="display:flex;align-items:center">${roles16}</div></div>
</body></html>`;
}

const { mod, cleanup } = await loadModules();
let browser;
try {
  await mkdir(outDir, { recursive: true });
  const html = buildHtml(mod);
  await writeFile(join(outDir, 'sheet.html'), html, 'utf8');

  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 1620, height: 1000 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: 'load' });
  await page.screenshot({ path: join(outDir, 'sheet.png'), fullPage: true });
  await page.locator('#small').screenshot({ path: join(outDir, 'small.png') });

  // the 72 px grid again at 2x, for judging outlines up close
  const hi = await browser.newPage({ viewport: { width: 1620, height: 1000 }, deviceScaleFactor: 2 });
  await hi.setContent(html, { waitUntil: 'load' });
  await hi.locator('.grid').first().screenshot({ path: join(outDir, 'grid@2x.png') });
  const tiny = await page.locator('#tiny').screenshot({ path: join(outDir, 'tiny.png') });

  // The loupe: the 1x 16 px sheet, nearest-neighbour at 4x, so the real pixels can be judged.
  const loupe = await browser.newPage({ viewport: { width: 1700, height: 400 }, deviceScaleFactor: 1 });
  await loupe.setContent(
    `<body style="margin:0;background:#0b0d12"><img id="i" style="image-rendering:pixelated" src="data:image/png;base64,${tiny.toString('base64')}"></body>`,
    { waitUntil: 'load' },
  );
  await loupe.evaluate(() => {
    const img = document.getElementById('i');
    img.style.width = img.naturalWidth * 4 + 'px';
  });
  await loupe.screenshot({ path: join(outDir, 'small-loupe.png'), fullPage: true });
  console.log(`wrote ${join(outDir, 'sheet.png')} (+ small.png, tiny.png, small-loupe.png, grid@2x.png)`);
} finally {
  if (browser) await browser.close();
  await cleanup();
}
