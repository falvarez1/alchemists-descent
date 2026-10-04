// Preview of the Foundry UI kit (public/assets/arena/ui/kit.json) through the same CSS the Duel screens use: every frame
// stretched to several sizes over its fill, every button state, the divider, ornaments, word art and text textures.
// Writes verify-out/ui-kit/preview.html (served by the dev server at /verify-out/ui-kit/preview.html) and, with a URL,
// screenshots it (one shot per section plus the whole page).
//
// Usage: node scripts/arena-sprites/preview-ui-kit.mjs [http://127.0.0.1:5242/]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

const kit = JSON.parse(readFileSync('public/assets/arena/ui/kit.json', 'utf8'));
const P = kit.pieces, S = kit.scale, U = '/assets/arena/ui/';
const px = v => `${v * S}px`;

/** A hollow frame: fill behind (reaching the band), the frame drawn on ::after above, content inside the slice. */
const frameCss = (name, fill = 'fill-iron') => {
  const p = P[name], [t, r, b, l] = p.slice, [bt, br, bb, bl] = p.band;
  return `.${name} { position: relative; isolation: isolate; box-sizing: border-box; padding: ${px(t)} ${px(r)} ${px(b)} ${px(l)}; }
.${name}::before { content: ''; position: absolute; z-index: -1; inset: ${px(bt)} ${px(br)} ${px(bb)} ${px(bl)};
  background: url(${U}${fill}.png) 0 0 / ${px(P[fill].size[0])} auto repeat; image-rendering: pixelated; }
.${name}::after { content: ''; position: absolute; inset: 0; pointer-events: none; border-style: solid;
  border-width: ${px(t)} ${px(r)} ${px(b)} ${px(l)}; border-image: url(${U}${p.file}) ${t} ${r} ${b} ${l} / ${px(t)} ${px(r)} ${px(b)} ${px(l)} round;
  image-rendering: pixelated; }`;
};
/** A filled plate with states (a button): border-image with fill, fixed height. */
const plateCss = (name) => {
  const p = P[name], [t, r, b, l] = p.slice;
  const st = p.states ?? { normal: p.file };
  return `.${name} { box-sizing: border-box; height: ${px(p.size[1])}; display: inline-flex; align-items: center; justify-content: center;
  border-style: solid; border-width: ${px(t)} ${px(r)} ${px(b)} ${px(l)};
  border-image: url(${U}${st.normal}) ${t} ${r} ${b} ${l} fill / ${px(t)} ${px(r)} ${px(b)} ${px(l)} ${p.repeat};
  image-rendering: pixelated; }
${st.hot ? `.${name}.hot { border-image-source: url(${U}${st.hot}); }` : ''}
${st.pressed ? `.${name}.pressed { border-image-source: url(${U}${st.pressed}); }` : ''}`;
};
const img = (name, extra = '') => `<img class="px" src="${U}${P[name]?.file ?? name + '.png'}" style="width:${px((P[name]?.size ?? [0])[0])};${extra}">`;
const imgFile = (file, w, extra = '') => `<img class="px" src="${U}${file}" style="width:${px(w)};${extra}">`;

const frames = ['frame-panel', 'frame-card', 'frame-card-teal', 'frame-slot', 'frame-stage'];
const sizes = {
  'frame-panel': [[240, 150], [360, 220], [520, 300], [700, 420]],
  'frame-card': [[200, 70], [300, 90], [420, 130]], 'frame-card-teal': [[200, 70], [300, 90], [420, 130]],
  'frame-slot': [[160, 30], [320, 40], [560, 50]], 'frame-stage': [[90, 140], [120, 180], [160, 240]],
};
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Foundry UI kit</title>
<style>
body { margin: 0; padding: 24px; background: #0b1016 url(/assets/arena/foundry/backdrop.webp) center top / cover fixed; color: #e8d9c0;
  font: 600 15px/1.3 Georgia, 'Times New Roman', serif; }
body::before { content: ''; position: fixed; inset: 0; background: rgba(8, 11, 16, 0.72); z-index: -2; }
section { margin: 0 0 40px; } h2 { font: 700 13px/1 monospace; letter-spacing: .1em; color: #9fb3c8; margin: 0 0 12px; text-transform: uppercase; }
.row { display: flex; flex-wrap: wrap; gap: 24px; align-items: flex-start; }
.px { image-rendering: pixelated; display: block; }
.label { font: 11px monospace; color: #9fb3c8; margin-top: 6px; }
.copper-text { background: url(${U}text-copper.png) repeat-x 0 0 / auto 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  image-rendering: pixelated; filter: drop-shadow(0 ${px(1)} 0 #120b06) drop-shadow(0 0 1px #000); }
.iron-text { background: url(${U}text-iron.png) repeat-x 0 0 / auto 100%; -webkit-background-clip: text; background-clip: text; color: transparent;
  image-rendering: pixelated; filter: drop-shadow(0 ${px(1)} 0 #05070a); }
.btn-text { font: 700 18px/1 Georgia, serif; letter-spacing: .12em; color: #f6dfb8; text-shadow: 0 2px 0 #1a0d05; }
.divider { display: flex; align-items: center; height: ${px(P.divider.size[1])}; }
.divider .line { flex: 1; height: 100%; background: url(${U}divider-line.png) repeat-x 0 0 / auto 100%; image-rendering: pixelated; }
.chain { width: ${px(P.chain.size[0])}; background: url(${U}chain.png) repeat-y 0 0 / 100% auto; image-rendering: pixelated; }
.stack { position: relative; display: inline-block; }
.stack > .over { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); }
@keyframes flicker { 0%, 100% { opacity: 1; } 20% { opacity: .78; } 45% { opacity: .95; } 60% { opacity: .7; } 80% { opacity: .9; } }
.glow { animation: flicker 1.6s steps(6) infinite; }
${frames.map(f => frameCss(f, f === 'frame-slot' ? 'fill-worn' : 'fill-iron')).join('\n')}
${['button-copper', 'button-iron', 'keycap-wide', 'band'].map(plateCss).join('\n')}
</style></head><body>
<section id="frames"><h2>Frames, stretched (fill behind, frame over)</h2>
${frames.map(f => `<div class="row" style="margin-bottom:24px">${sizes[f].map(([w, h]) => `<div><div class="${f}" style="width:${w * S}px;height:${h * S}px">${
  f === 'frame-stage' ? '' : `<span class="label">${f} ${w}x${h} art px</span>`}</div><div class="label">${f} ${w}x${h}</div></div>`).join('')}</div>`).join('\n')}
</section>
<section id="buttons"><h2>Buttons: normal, hot, pressed, at three widths</h2>
${['button-copper', 'button-iron'].map(b => ['', 'hot', 'pressed'].map(st => `<div class="row" style="margin-bottom:12px">${[90, 150, 230].map(w =>
  `<div class="${b} ${st}" style="width:${w * S}px"><span class="btn-text">${b === 'button-copper' ? 'READY' : 'CHANGE FIGHTERS'}</span></div>`).join('')}<span class="label">${b} ${st || 'normal'}</span></div>`).join('')).join('\n')}
<div class="row" style="align-items:center">
  <div class="stack">${img('keycap')}<div class="over" style="font:700 13px monospace;color:#e8d9c0">A</div></div><div class="keycap-wide" style="width:${px(26)}"><span style="font:700 13px monospace;color:#e8d9c0">Esc</span></div>
  <div class="keycap-wide" style="width:${px(40)}"><span style="font:700 13px monospace;color:#e8d9c0">Enter</span></div>
  ${img('arrow-left')}${img('arrow-right')}${img('arrow-left-hot')}${img('arrow-right-hot')}${img('or-gear')}
</div>
<div style="margin-top:20px">${[300, 520].map(w => `<div class="band" style="width:${w * S}px;margin-bottom:12px"><span class="btn-text" style="font-size:28px">SUPER CUT-IN</span></div>`).join('')}</div>
</section>
<section id="divider"><h2>Divider (cap, line, diamond, line, cap), at two widths</h2>
${[160, 360].map(w => `<div class="divider" style="width:${w * S}px;margin-bottom:16px">${img('divider-cap-left')}<div class="line"></div>${img('divider-diamond')}<div class="line"></div>${img('divider-cap-right')}</div>`).join('')}
</section>
<section id="ornaments"><h2>Ornaments</h2>
<div class="row" style="align-items:flex-end">
  ${img('gear-crest')}
  <div>${img('chain-mount')}<div class="chain" style="height:${px(80)};margin:0 auto"></div></div>
  <div>${img('lantern')}<div class="label">lit</div></div>
  <div>${imgFile('lantern-unlit.png', P.lantern.size[0])}<div class="label">unlit</div></div>
  <div class="stack">${imgFile('lantern-unlit.png', P.lantern.size[0])}${imgFile('lantern-glow.png', P.lantern.size[0], 'position:absolute;inset:0').replace('class="px"', 'class="px glow"')}<div class="label">unlit + glow (flicker)</div></div>
  <div class="stack">${img('vs-medallion')}<div class="over">${img('word-vs', `width:${px(46)}`)}</div></div>
  ${img('seal-copper')}${img('seal-teal')}
  <div class="row" style="gap:6px">${img('bead-copper')}${img('bead-copper')}${img('bead-copper-spent')}</div>
  <div class="row" style="gap:6px">${img('bead-teal')}${img('bead-teal')}${img('bead-teal-spent')}</div>
</div>
<div class="row" style="margin-top:24px;align-items:center">
  <div class="stack">${img('timer-sign')}<div class="over" style="font:700 ${18 * S}px/1 Georgia,serif;margin-top:${px(3)}"><span class="iron-text" style="background-image:url(${U}text-copper.png)">6:00</span></div></div>
  <div class="stack">${img('banner-plate')}<div class="over">${img('word-fight', `width:${px(270)}`)}</div></div>
</div>
</section>
<section id="words"><h2>Word art</h2>
<div class="row" style="align-items:flex-end">${['word-fight', 'word-game', 'word-time', 'word-vs', 'word-3', 'word-2', 'word-1'].map(w => img(w)).join('')}</div>
</section>
<section id="type"><h2>Text textures (background-clip: text) on the dark iron fill</h2>
<div class="frame-panel" style="width:${px(420)};height:auto">
  <div style="text-align:center;font:700 ${30 * S}px/1.1 Georgia,serif;letter-spacing:.04em"><span class="copper-text">DUEL</span></div>
  <div style="text-align:center;font:700 ${15 * S}px/1.1 Georgia,serif"><span class="copper-text">CHOOSE A STAGE</span></div>
  <div style="text-align:center;font:700 ${8 * S}px/1.6 Georgia,serif;letter-spacing:.3em"><span class="iron-text">TWO ALCHEMISTS. A DEEPER TRUTH.</span></div>
  <div class="divider" style="margin:16px 0">${img('divider-cap-left')}<div class="line"></div>${img('divider-diamond')}<div class="line"></div>${img('divider-cap-right')}</div>
  <div class="row" style="justify-content:center"><div class="button-copper" style="width:${px(140)}"><span class="btn-text">REMATCH</span></div>
  <div class="button-iron hot" style="width:${px(170)}"><span class="btn-text">CHANGE FIGHTERS</span></div></div>
</div>
</section>
<section id="fills"><h2>Fill tiles, repeated (seams)</h2>
<div class="row">
  <div style="width:${px(P['fill-iron'].size[0] * 2.5)};height:${px(P['fill-iron'].size[1] * 2.5)};background:url(${U}fill-iron.png) 0 0 / ${px(P['fill-iron'].size[0])} auto repeat;image-rendering:pixelated"></div>
  <div style="width:${px(P['fill-worn'].size[0] * 2.5)};height:${px(P['fill-worn'].size[1] * 1.5)};background:url(${U}fill-worn.png) 0 0 / ${px(P['fill-worn'].size[0])} auto repeat;image-rendering:pixelated"></div>
  <div style="width:${px(96 * 3)};height:${px(170)};background:url(${U}text-copper.png) 0 0 / ${px(96)} auto repeat-x;image-rendering:pixelated"></div>
  <div style="width:${px(96 * 3)};height:${px(170)};background:url(${U}text-iron.png) 0 0 / ${px(96)} auto repeat-x;image-rendering:pixelated"></div>
</div>
</section>
</body></html>`;
mkdirSync('verify-out/ui-kit', { recursive: true });
writeFileSync('verify-out/ui-kit/preview.html', html);
console.log('wrote verify-out/ui-kit/preview.html');

const url = process.argv[2];
if (url) {
  const { launchBrowser } = await import('../browser-launch.mjs');
  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
    await page.goto(new URL('verify-out/ui-kit/preview.html', url).href, { waitUntil: 'networkidle' });
    await page.screenshot({ path: 'verify-out/ui-kit/preview-full.png', fullPage: true });
    for (const id of ['frames', 'buttons', 'divider', 'ornaments', 'words', 'type', 'fills']) {
      await page.locator(`#${id}`).screenshot({ path: `verify-out/ui-kit/preview-${id}.png` });
    }
    console.log('screenshots in verify-out/ui-kit/');
  } finally { await browser.close(); }
}
