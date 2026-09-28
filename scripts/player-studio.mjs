// Player studio: every action the alchemist can take, posed by the real
// pose + costume physics (ticked so cloth and hat settle or swing) and drawn
// by the production sprite entry, at zoom, over a lit floor.
// Usage: node scripts/player-studio.mjs [url] [--zoom 4] [--only idle,run] [--out file]
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (n, f) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : f; };
const zoom = Number(opt('zoom', '4'));
const only = opt('only', '');
const outFile = opt('out', 'verify-out/player-studio/poses.png');
mkdirSync('verify-out/player-studio', { recursive: true });

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await waitForConsoleApi(page);
  const info = await page.evaluate(async ({ zoom, only }) => {
    const { World } = await import('/src/sim/World.ts');
    const { Cell } = await import('/src/sim/CellType.ts');
    const { drawPlayerSprite } = await import('/src/render/sprites/PlayerSprite.ts');
    const { stepPlayerCostume } = await import('/src/entities/playerCostume.ts');
    const source = window.__game.ctx;
    // The chill (entities/chill): a body at a given cold, its rime caught up (or held higher while it thaws).
    const chill = (level, extra = {}) => ({ chill: { level, rime: level, shell: 0, cracks: 0, cooldown: 0, moveK: 1, jumpK: 1, screen: 0,
      musicRate: 1, musicCutoff: 20000, thawAt: -1, crackle: 0, deep: level >= 0.6,
      breathAt: -1, breathX: 0, breathY: 0, breathDir: 1, breathK: 0, ...extra } });
    const V = [
      ['idle', {}, {}],
      ['idle · breath', {}, { t0: 40 }],
      ['walk', { _svx: 0.9, vx: 0.9, run: 0.9 }, {}],
      ['run · contact', { _svx: 2.1, vx: 2.1, run: 2.1 }, { phase: Math.PI / 2 }],
      ['run · passing', { _svx: 2.1, vx: 2.1, run: 2.1 }, { phase: Math.PI }],
      ['skid', { skidT: 9, _svx: 1.2, vx: 1.2 }, {}],
      ['jump rise', { grounded: false, vy: -3.2, stretchT: 6, _svy: -3 }, {}],
      ['apex', { grounded: false, vy: 0.05 }, {}],
      ['fall', { grounded: false, vy: 3.1, _svy: 3 }, {}],
      ['levitate', { grounded: false, vy: -0.8, levitating: true, _svy: -0.6 }, {}],
      ['land', { landTimer: 9 }, {}],
      ['crouch', { crouchT: 10 }, {}],
      ['crawl', { crawling: true, crawlT: 10, crawlSlope: -0.1, stridePhase: 1.1 }, {}],
      ['climb', { climbing: true, climbT: 10, climbDir: 1, climbPhase: 1.4 }, {}],
      ['wall grab', { wallGrabT: 10, wallGrabDir: 1 }, {}],
      ['cast', { firing: true, recoilT: 5, aimAngle: -0.45 }, {}],
      ['cast up', { firing: true, aimAngle: -1.2 }, {}],
      ['kick', { kickT: 7 }, {}],
      ['dive', { diveT: 8, grounded: false, vy: 2 }, {}],
      ['hurt', { staggerT: 9, staggerDir: -1 }, {}],
      ['lever pull', { pullT: 14, pullDir: 1 }, {}],
      ['swim', { inLiquid: true, grounded: false, vy: 0.1 }, {}],
      ['drink', {}, { input: { drinkHeld: true } }],
      ['siphon', { aimAngle: 0.35 }, { input: { siphonHeld: true } }],
      ['throw', { throwT: 7 }, {}],
      ['commune', { recharge: 30 }, {}],
      ['wand swap', { swapT: 7 }, {}],
      ['burning', { status: { burning: 60 } }, {}],
      ['chill 0.25', chill(0.25), {}],
      ['chill 0.5', chill(0.5), {}],
      ['chill 0.75', chill(0.75), {}],
      ['chill 1', chill(1), {}],
      ['chill · walk 0.75', { ...chill(0.75), _svx: 0.9, vx: 0.9, run: 0.9 }, {}],
      ['chill · cast 0.75', { ...chill(0.75), firing: true, aimAngle: -0.45 }, {}],
      ['chill · crawl 0.75', { ...chill(0.75), crawling: true, crawlT: 10, crawlSlope: -0.1, stridePhase: 1.1 }, {}],
      ['chill · thawing', chill(0.3, { rime: 0.62 }), {}],
      ['chill · breath', chill(0.7, { breathAt: 146, breathX: 152.6, breathY: 75.7, breathDir: 1, breathK: 0.75 }), {}],
      ['frozen solid', chill(1, { shell: 40 }), {}],
      ['frozen · cracked', chill(1, { shell: 20, cracks: 4 }), {}],
    ].filter(([n]) => !only || only.split(',').some(o => n.startsWith(o)));
    const COLS = 7, CW = 44, CH = 32, fw = CW * 2, fh = CH * 2;
    const rows = Math.ceil(V.length / COLS);
    const canvas = document.createElement('canvas');
    canvas.width = COLS * (fw * zoom + 6) + 6; canvas.height = rows * (fh * zoom + 24) + 28;
    canvas.id = 'player-studio'; canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:10000;image-rendering:pixelated';
    document.getElementById('player-studio')?.remove(); document.body.appendChild(canvas);
    const g = canvas.getContext('2d'); g.fillStyle = '#0b1114'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.fillStyle = '#cfd8c4'; g.font = '15px system-ui'; g.fillText(`alchemist · player studio · ${zoom}× fine pixels`, 8, 18);
    const tile = document.createElement('canvas'); tile.width = fw; tile.height = fh; const tg = tile.getContext('2d');
    for (let vi = 0; vi < V.length; vi++) {
      const [name, patch, extra] = V[vi];
      const world = new World(300, 120), FLOOR = 90;
      for (let y = FLOOR + 1; y < 120; y++) for (let x = 0; x < 300; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x3d4447);
      if (name.startsWith('climb') || name.startsWith('wall')) for (let y = 30; y <= FLOOR; y++) for (let x = 154; x < 170; x++) world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x3d4447);
      if (name.startsWith('swim')) for (let y = 50; y <= FLOOR; y++) for (let x = 0; x < 300; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0x1f4d72);
      const baseY = name.startsWith('climb') || name.startsWith('wall') ? FLOOR - 12 : name.startsWith('swim') || name.startsWith('lev') || name.startsWith('jump') || name.startsWith('apex') || name.startsWith('fall') || name.startsWith('dive') ? FLOOR - 16 : FLOOR;
      const field = { sample(x, y) { const d2 = (x - 120) ** 2 + (y - 60) ** 2, I = 0.66 + 1.1 * Math.exp(-d2 / (2 * 40 * 40)); return { r: I * 1.04, g: I * 0.96, b: I * 0.84 }; } };
      const player = { ...source.player, x: 150, y: baseY, fx: 0, fy: 0, vx: 0, vy: 0, _svx: 0, _svy: 0, _px: 150, _py: baseY,
        facing: 1, grounded: true, dead: false, invuln: 0, crawling: false, climbing: false, wallGrabT: 0, crouchT: 0,
        landTimer: 0, stretchT: 0, skidT: 0, staggerT: 0, kickT: 0, pullT: 0, diveT: 0, recharge: 0, inLiquid: false,
        firing: false, recoilT: 0, swapT: 0, bloodStain: 0, blinkTimer: 0, aimAngle: -0.25, levitating: false, throwT: 0, legClub: undefined,
        hat: { ...source.player.hat }, robe: { ...source.player.robe }, costume: undefined,
        status: { ...source.player.status, ...(patch.status ?? {}) }, ...patch };
      delete player.run;
      const input = { ...source.input, keys: { ...source.input.keys }, drinkHeld: false, siphonHeld: false, pourHeld: false, ...(extra.input ?? {}) };
      const ctx = { ...source, world, player, input, state: { ...source.state, mode: 'play', frameCount: 100, reduceFlashes: false },
        flask: { ...source.flask, state: { material: Cell.Water, count: 40 } },
        spells: { ...source.spells, wandTip: () => ({ x: player.x + Math.cos(player.aimAngle) * 13, y: player.y - 9 + Math.sin(player.aimAngle) * 13 }) },
        physics: { ...source.physics, entityFree: () => true }, rigidBodies: { ...source.rigidBodies, playerRagdoll: null } };
      const run = patch.run ?? 0;
      const ticks = 60 + (extra.t0 ?? 0);
      for (let t = 0; t < ticks; t++) {
        ctx.state.frameCount = 100 + t;
        if (run) { player.x += run * 0.5; player.stridePhase = (extra.phase ?? 0) + (t - ticks) * run * 0.16; }
        if (extra.phase !== undefined && run) player.stridePhase = extra.phase + (t - ticks + 1) * run * 0.16;
        stepPlayerCostume(ctx, player, null);
      }
      const cx0 = Math.round(player.x - CW / 2), cy0 = Math.round(player.y - CH + 7);
      const buf = new Float32Array(fw * fh * 3);
      for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
        const wx = cx0 + fx / 2, wy = cy0 + fy / 2, L = field.sample(wx, wy), o = (fy * fw + fx) * 3;
        const tt = world.inBounds(Math.floor(wx), Math.floor(wy)) ? world.types[world.idx(Math.floor(wx), Math.floor(wy))] : 0;
        const c = tt === 0 ? [0.05, 0.07, 0.08] : tt === 2 ? [0.12, 0.3, 0.45] : [0.24, 0.27, 0.28];
        buf[o] = c[0] * L.r; buf[o + 1] = c[1] * L.g; buf[o + 2] = c[2] * L.b;
      }
      const at = (x, y) => { const fx = Math.round((x - cx0) * 2), fy = Math.round((y - cy0) * 2); return fx < 0 || fy < 0 || fx >= fw || fy >= fh ? -1 : (fy * fw + fx) * 3; };
      const surf = { pixelStep: 0.5,
        setFinePx(x, y, r, gg, b) { const o = at(x, y); if (o < 0) return; buf[o] = r; buf[o + 1] = gg; buf[o + 2] = b; },
        addFinePx(x, y, r, gg, b) { const o = at(x, y); if (o < 0) return; buf[o] += r; buf[o + 1] += gg; buf[o + 2] += b; },
        blendFinePx(x, y, r, gg, b, a) { const o = at(x, y); if (o < 0) return; buf[o] = buf[o] * (1 - a) + r; buf[o + 1] = buf[o + 1] * (1 - a) + gg; buf[o + 2] = buf[o + 2] * (1 - a) + b; },
        setPx(x, y, r, gg, b) { for (let dy = 0; dy < 1; dy += 0.5) for (let dx = 0; dx < 1; dx += 0.5) this.setFinePx(x + dx, y + dy, r, gg, b); },
        addPx(x, y, r, gg, b) { for (let dy = 0; dy < 1; dy += 0.5) for (let dx = 0; dx < 1; dx += 0.5) this.addFinePx(x + dx, y + dy, r, gg, b); } };
      drawPlayerSprite(surf, field, ctx);
      const img = tg.createImageData(fw, fh);
      for (let i = 0; i < fw * fh; i++) { for (let c = 0; c < 3; c++) img.data[i * 4 + c] = Math.round(255 * Math.min(1, buf[i * 3 + c] / (1 + buf[i * 3 + c] * 0.18) * 1.1)); img.data[i * 4 + 3] = 255; }
      tg.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      const col = vi % COLS, row = Math.floor(vi / COLS);
      const X = 6 + col * (fw * zoom + 6), Y = 26 + row * (fh * zoom + 24);
      g.drawImage(tile, X, Y, fw * zoom, fh * zoom);
      g.fillStyle = '#9fb0a0'; g.font = '13px system-ui'; g.fillText(name, X + 4, Y + fh * zoom + 16);
    }
    return { n: V.length };
  }, { zoom, only });
  await page.locator('#player-studio').screenshot({ path: outFile });
  console.log(outFile, JSON.stringify(info), errors.length ? errors.slice(0, 5) : '');
} finally { await browser.close(); }
