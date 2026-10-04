// Preview of the Foundry UI kit (public/assets/arena/ui/kit.json) through the CSS the game uses: controls, menus and HUD
// pieces assembled into real screens, every frame stretched over its fill, every state, ornaments, word art, textures.
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
/** A filled plate: border-image with fill; its fixed side (height, or width for a vertical one) at its own size; each
 * state other than normal is a class that swaps the source. */
const plateCss = (name) => {
  const p = P[name], [t, r, b, l] = p.slice;
  const st = p.states ?? { normal: p.file };
  const fixed = p.repeat === 'round' ? '' : p.repeat.startsWith('stretch') ? `width: ${px(p.size[0])};` : `height: ${px(p.size[1])};`;
  return `.${name} { box-sizing: border-box; ${fixed} display: inline-flex; align-items: center; justify-content: center;
  border-style: solid; border-width: ${px(t)} ${px(r)} ${px(b)} ${px(l)};
  border-image: url(${U}${st.normal}) ${t} ${r} ${b} ${l} fill / ${px(t)} ${px(r)} ${px(b)} ${px(l)} ${p.repeat};
  image-rendering: pixelated; }
${Object.entries(st).filter(([k]) => k !== 'normal').map(([k, file]) => `.${name}.${k} { border-image-source: url(${U}${file}); }`).join('\n')}`;
};
const img = (name, extra = '') => `<img class="px" src="${U}${P[name]?.file ?? name + '.png'}" style="width:${px((P[name]?.size ?? [0])[0])};${extra}">`;
const imgFile = (file, w, extra = '') => `<img class="px" src="${U}${file}" style="width:${px(w)};${extra}">`;

const stateImg = (name, state, extra = '') => imgFile(P[name].states[state], P[name].size[0], extra);

const frames = ['panel-large', 'panel-small', 'card', 'card-teal', 'slot', 'picture-frame'];
const sizes = {
  'panel-large': [[240, 150], [360, 220], [520, 300], [700, 420]], 'panel-small': [[120, 80], [200, 110], [300, 160]],
  'card': [[200, 70], [300, 90], [420, 130]], 'card-teal': [[200, 70], [300, 90], [420, 130]],
  'slot': [[160, 30], [320, 40], [560, 50]], 'picture-frame': [[90, 140], [120, 180], [160, 240]],
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
${frames.map(f => frameCss(f, f === 'slot' ? 'fill-worn' : 'fill-iron')).join('\n')}
${Object.keys(P).filter(n => P[n].kind === 'plate').map(plateCss).join('\n')}
.abs { position: absolute; } .rel { position: relative; }
.small { font: 700 13px/1.2 Georgia, serif; letter-spacing: .14em; color: #e8d9c0; }
.slider { position: relative; height: ${px(P['slider-track'].size[1])}; }
.slider > .slider-track { width: 100%; }
.slider > .slider-fill { position: absolute; left: ${px(8)}; top: ${px(4)}; }
.slider > img { position: absolute; top: ${px((P['slider-track'].size[1] - P['slider-handle'].size[1]) / 2)}; }
.meter > img { position: absolute; top: ${px(3 - 5)}; }
</style></head><body>
<section id="controls"><h2>Controls: an options panel built from the kit, then each control's states and stretch</h2>
<div class="row" style="align-items:flex-start">
<div class="rel" style="padding-top:${px(13)}">
  <div class="title-plate abs" style="width:${px(130)};left:50%;top:0;transform:translateX(-50%);z-index:2"><span class="copper-text" style="font:700 ${11 * S}px/1 Georgia,serif;letter-spacing:.08em">OPTIONS</span></div>
  <div class="panel-large" style="width:${px(340)};padding-top:${px(38)}">
    <div class="row" style="gap:0;margin-bottom:${px(4)}">${['AUDIO', 'VIDEO', 'CONTROLS'].map((t, i) => `<div class="tab ${i === 0 ? 'active' : ''}" style="width:${px(66)}"><span class="small" style="${i === 0 ? 'color:#fff1d6' : 'color:#b9a88e'}">${t}</span></div>`).join('')}</div>
    <div style="display:flex;gap:${px(8)}"><div style="flex:1">
    ${[['MUSIC', 0.7, 'normal'], ['EFFECTS', 0.45, 'hot'], ['VOICE', 1, 'normal']].map(([t, v, st]) => `<div style="display:flex;align-items:center;gap:${px(8)};margin:${px(7)} 0"><span class="small" style="width:${px(52)}">${t}</span>
      <div class="slider" style="width:${px(150)}"><div class="slider-track"></div><div class="slider-fill" style="width:${px(Math.max(8, Math.round(v * 134)))}"></div>${stateImg('slider-handle', st, `left:${px(Math.round(8 + v * 134 - 11))}`)}</div></div>`).join('')}
    <div style="display:flex;align-items:center;gap:${px(8)};margin:${px(8)} 0"><span class="small" style="width:${px(112)}">SCREEN SHAKE</span>${stateImg('toggle', 'on')}</div>
    <div style="display:flex;align-items:center;gap:${px(8)};margin:${px(8)} 0"><span class="small" style="width:${px(112)}">SHOW HITBOXES</span>${stateImg('toggle', 'off')}</div>
    <div style="display:flex;align-items:center;gap:${px(5)};margin:${px(8)} 0">${stateImg('checkbox', 'on')}<span class="small">SUBTITLES</span><span style="width:${px(10)}"></span>${stateImg('checkbox', 'off')}<span class="small">FEWER FLASHES</span></div>
    </div>
    <div class="rel"><div class="scroll-track" style="height:${px(116)}"></div>${stateImg('scroll-thumb', 'hot', `position:absolute;left:0;top:${px(12)}`)}</div></div>
  </div>
</div>
<div>
  <div class="row" style="align-items:center">${stateImg('slider-handle', 'normal')}${stateImg('slider-handle', 'hot')}${stateImg('toggle', 'off')}${stateImg('toggle', 'on')}${stateImg('checkbox', 'off')}${stateImg('checkbox', 'on')}${stateImg('scroll-thumb', 'normal')}${stateImg('scroll-thumb', 'hot')}</div>
  <div class="label">slider handle normal / hot, toggle off / on, checkbox off / on, scroll thumb normal / hot</div>
  <div class="row" style="margin-top:16px">${[60, 120, 200].map(w => `<div class="slider" style="width:${px(w)}"><div class="slider-track"></div><div class="slider-fill" style="width:${px(Math.round((w - 16) / 2))}"></div></div>`).join('')}</div>
  <div class="label">slider track and fill at three widths (fill at half)</div>
  <div class="row" style="margin-top:16px">${[24, 60, 110].map(h => `<div class="scroll-track" style="height:${px(h)}"></div>`).join('')}</div>
  <div class="label">scroll track at three heights</div>
</div>
</div>
</section>
<section id="menus"><h2>Menus: a dialog with its title plate, a list with the cursor row, tabs, tooltips</h2>
<div class="row" style="align-items:flex-start">
<div class="rel" style="padding-top:${px(13)}">
  <div class="title-plate abs" style="width:${px(160)};left:50%;top:0;transform:translateX(-50%);z-index:2"><span class="copper-text" style="font:700 ${10 * S}px/1 Georgia,serif;letter-spacing:.08em">QUIT TO TITLE?</span></div>
  <div class="panel-small" style="width:${px(230)};padding-top:${px(32)};text-align:center">
    <div class="small" style="margin:${px(2)} 0 ${px(10)}">THE MATCH WILL BE LOST.</div>
    <div class="row" style="justify-content:center;gap:${px(8)}"><div class="button-primary" style="width:${px(80)}"><span class="btn-text">QUIT</span></div><div class="button-secondary" style="width:${px(80)}"><span class="btn-text">STAY</span></div></div>
  </div>
</div>
<div class="panel-large" style="width:${px(250)}">
  ${['RESUME MATCH', 'RESTART MATCH', 'CHANGE FIGHTERS', 'CONTROLS', 'QUIT TO TITLE'].map((t, i) => `<div class="list-row ${i === 0 ? 'hot' : ''}" style="width:100%;margin-bottom:${px(4)}"><span class="btn-text" style="font-size:19px;${i === 0 ? '' : 'color:#cbbba0'}">${t}</span></div>`).join('')}
</div>
<div>
  <div class="row" style="gap:0">${['MOVES', 'COMBOS', 'TRIVIA'].map((t, i) => `<div class="tab ${i === 1 ? 'active' : ''}" style="width:${px(64)}"><span class="small">${t}</span></div>`).join('')}</div>
  <div style="margin-top:20px" class="tooltip"><span class="small" style="padding:0 6px">HOLD TO CHARGE. RELEASE TO THROW.</span></div>
  <div style="margin-top:12px;width:${px(150)}" class="tooltip"><span class="small" style="padding:4px 6px;line-height:1.5">SAVED. YOUR LOADOUT IS READY FOR THE NEXT DESCENT.</span></div>
  <div class="row" style="margin-top:16px">${[30, 70, 110].map(w => `<div class="list-row" style="width:${px(w)}"></div>`).join('')}</div>
  <div class="label">list row at three widths</div>
</div>
</div>
</section>
<section id="hud"><h2>HUD and plates: player cards (portrait behind the window), meter, nameplates, hanging sign, ribbon</h2>
${(() => {
  const meter = cells => `<div class="meter rel" style="width:${px(12 + 13 * cells.length)}">${cells.map((c, k) => c ? imgFile(`meter-cell${c === 'teal' ? '-teal' : ''}.png`, 11, `left:${px(1 + 13 * k)}`) : '').join('')}</div>`;
  const beads = (b, n) => Array.from({ length: 3 }, (_, k) => img(k < n ? b : b + '-spent')).join('');
  const card = (name, bust, who, color, beadRow, pct, cells) => {
    const wnd = P[name].window, side = wnd.left !== undefined ? `left:${px(wnd.left)}` : `right:${px(wnd.right)}`;
    return `<div class="rel" style="isolation:isolate;width:${px(220)}">
      <div class="abs" style="${side};top:${px(wnd.top)};width:${px(wnd.width)};height:${px(wnd.height)};z-index:-1;background:#0d1117 url(/assets/arena/fighters/${bust}/bust.webp) center 15% / cover"></div>
      <div class="${name}" style="width:100%;flex-direction:column;align-items:stretch;justify-content:space-between;padding:0 ${px(4)}">
        <span class="small" style="color:${color}">${who}</span>
        <div style="display:flex;align-items:center;justify-content:space-between"><div class="row" style="gap:${px(2)}">${beadRow}</div><span class="copper-text" style="font:700 ${20 * S}px/1 Georgia,serif">${pct}</span></div>
        <div style="display:flex;align-items:center;gap:${px(4)}"><span class="small" style="font-size:11px">SPECIAL</span>${meter(cells)}</div>
      </div></div>`;
  };
  return `<div class="row">${card('hud-card', 'nox-calder', 'P1 NOX', '#f2b35e', beads('bead', 3), '0%', ['gold', 'gold', null])}
    ${card('hud-card-teal', 'brann-rook', 'P2 BRANN', '#6fd6d0', beads('bead-teal', 2), '47%', ['gold', 'teal', null])}</div>
  <div class="row" style="margin-top:16px;align-items:center">${[1, 3, 6].map(n => meter(Array.from({ length: n }, (_, k) => k < n - 1 ? 'gold' : null))).join('')}
    ${[110, 160, 260].map(w => `<div class="hud-card" style="width:${px(w)}"></div>`).join('')}</div>
  <div class="label">meter with 1, 3 and 6 cells (width 12 + 13n); the card body at three widths</div>`;
})()}
<div class="row" style="margin-top:24px;align-items:flex-end">
  <div class="nameplate" style="width:${px(100)};flex-direction:column"><span class="copper-text" style="font:700 ${12 * S}px/1 Georgia,serif">NOX</span><span class="small" style="font-size:11px">LAMPBLACK</span></div>
  <div class="row" style="gap:0;align-items:flex-end">${img('lantern', 'margin-right:-4px')}<div class="nameplate-hanging" style="width:${px(130)};align-items:flex-end"><span class="btn-text" style="font-size:17px;padding-bottom:2px">P1 · PRESS ENTER</span></div>${img('lantern', 'margin-left:-4px')}</div>
  <div style="text-align:center"><div><span class="copper-text" style="font:700 ${26 * S}px/1 Georgia,serif">CONNECT</span></div>
    <div class="ribbon" style="width:${px(210)}"><span class="small">SAME NETWORK. SAME SERVER.</span></div></div>
</div>
</section>
<section id="frames"><h2>Frames, stretched (fill behind, frame over)</h2>
${frames.map(f => `<div class="row" style="margin-bottom:24px">${sizes[f].map(([w, h]) => `<div><div class="${f}" style="width:${w * S}px;height:${h * S}px">${
  f === 'picture-frame' ? '' : `<span class="label">${f} ${w}x${h} art px</span>`}</div><div class="label">${f} ${w}x${h}</div></div>`).join('')}</div>`).join('\n')}
</section>
<section id="buttons"><h2>Buttons: normal, hot, pressed, at three widths</h2>
${['button-primary', 'button-secondary'].map(b => ['', 'hot', 'pressed'].map(st => `<div class="row" style="margin-bottom:12px">${[90, 150, 230].map(w =>
  `<div class="${b} ${st}" style="width:${w * S}px"><span class="btn-text">${b === 'button-primary' ? 'READY' : 'CHANGE FIGHTERS'}</span></div>`).join('')}<span class="label">${b} ${st || 'normal'}</span></div>`).join('')).join('\n')}
<div class="row" style="align-items:center">
  <div class="stack">${img('keycap-square')}<div class="over" style="font:700 13px monospace;color:#e8d9c0">A</div></div><div class="keycap" style="width:${px(26)}"><span style="font:700 13px monospace;color:#e8d9c0">Esc</span></div>
  <div class="keycap" style="width:${px(40)}"><span style="font:700 13px monospace;color:#e8d9c0">Enter</span></div>
  ${img('arrow-left')}${img('arrow-right')}${img('arrow-left-hot')}${img('arrow-right-hot')}${img('gear-small')}
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
  <div class="stack">${img('medallion')}<div class="over">${img('word-vs', `width:${px(46)}`)}</div></div>
  ${img('seal')}${img('seal-teal')}
  <div class="row" style="gap:6px">${img('bead')}${img('bead')}${img('bead-spent')}</div>
  <div class="row" style="gap:6px">${img('bead-teal')}${img('bead-teal')}${img('bead-teal-spent')}</div>
</div>
<div class="row" style="margin-top:24px;align-items:center">
  <div class="stack">${img('hanging-sign')}<div class="over" style="font:700 ${18 * S}px/1 Georgia,serif;margin-top:${px(3)}"><span class="iron-text" style="background-image:url(${U}text-copper.png)">6:00</span></div></div>
  <div class="stack">${img('banner-plate')}<div class="over">${img('word-fight', `width:${px(270)}`)}</div></div>
</div>
</section>
<section id="words"><h2>Word art</h2>
<div class="row" style="align-items:flex-end">${['word-fight', 'word-game', 'word-time', 'word-vs', 'word-3', 'word-2', 'word-1'].map(w => img(w)).join('')}</div>
</section>
<section id="type"><h2>Text textures (background-clip: text) on the dark iron fill</h2>
<div class="panel-large" style="width:${px(420)};height:auto">
  <div style="text-align:center;font:700 ${30 * S}px/1.1 Georgia,serif;letter-spacing:.04em"><span class="copper-text">DUEL</span></div>
  <div style="text-align:center;font:700 ${15 * S}px/1.1 Georgia,serif"><span class="copper-text">CHOOSE A STAGE</span></div>
  <div style="text-align:center;font:700 ${8 * S}px/1.6 Georgia,serif;letter-spacing:.3em"><span class="iron-text">TWO ALCHEMISTS. A DEEPER TRUTH.</span></div>
  <div class="divider" style="margin:16px 0">${img('divider-cap-left')}<div class="line"></div>${img('divider-diamond')}<div class="line"></div>${img('divider-cap-right')}</div>
  <div class="row" style="justify-content:center"><div class="button-primary" style="width:${px(140)}"><span class="btn-text">REMATCH</span></div>
  <div class="button-secondary hot" style="width:${px(170)}"><span class="btn-text">CHANGE FIGHTERS</span></div></div>
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
    for (const id of ['controls', 'menus', 'hud', 'frames', 'buttons', 'divider', 'ornaments', 'words', 'type', 'fills']) {
      await page.locator(`#${id}`).screenshot({ path: `verify-out/ui-kit/preview-${id}.png` });
    }
    console.log('screenshots in verify-out/ui-kit/');
  } finally { await browser.close(); }
}
