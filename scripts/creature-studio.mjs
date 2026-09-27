// Creature studio: the real creature rig + art pipeline, staged in a small
// world (floor, ledge, wall, pool, a directional lamp), rendered as frame
// strips at zoom. Iterate on look and motion without playing to the monster.
// Usage: node scripts/creature-studio.mjs [url] --kind spitter [--scenes idle,walk,aim] [--zoom 3] [--frames 4] [--every 12] [--out dir]
// Scenes also include die (the remains fall, settle and curl) and buried (sand
// pours over the body behind the head, which walks on — a spine must follow).
import { mkdirSync } from 'node:fs';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';

const args = process.argv.slice(2);
const url = args[0] && !args[0].startsWith('--') ? args[0] : 'http://localhost:5173/';
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const kinds = opt('kind', 'spitter').split(',');
const scenes = opt('scenes', 'idle,walk,alert,aim,spit,fall').split(',');
const zoom = Number(opt('zoom', '3'));
const frames = Number(opt('frames', '4'));
const every = Number(opt('every', '10'));
const out = opt('out', 'verify-out/creature-studio');
const lamp = opt('lamp', 'left');
const tag = opt('tag', '');
const cw = Number(opt('cw', '72')), ch = Number(opt('ch', '44'));
mkdirSync(out, { recursive: true });

const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await waitForConsoleApi(page);
  for (const kind of kinds) {
    const info = await page.evaluate(async ({ kind, scenes, zoom, frames, every, lamp, cw, ch }) => {
      const { World } = await import('/src/sim/World.ts');
      const { Cell } = await import('/src/sim/CellType.ts');
      const { drawCreatureSprite } = await import('/src/render/sprites/CreatureArt.ts');
      const { createDefaultStatus } = await import('/src/entities/status.ts');
      const { ensureCreatureMind } = await import('/src/creatures/perception.ts');
      const { tickCreaturePose } = await import('/src/creatures/pose.ts');
      const { ENEMY_DEFS } = await import('/src/content/enemyDefs.ts');
      const { tickWeaverLocomotion } = await import('/src/entities/weaverLocomotion.ts');
      const { addCorpse, updateCorpses } = await import('/src/creatures/corpses.ts');
      const source = window.__game.ctx;
      const CW = cw, CH = ch; // crop in cells
      const W = 360, H = 170, FLOOR = 130;
      const cols = frames, rows = scenes.length;
      const fw = CW * 2, fh = CH * 2; // fine pixels per crop
      const canvas = document.createElement('canvas');
      canvas.width = cols * fw * zoom + (cols + 1) * 8; canvas.height = rows * (fh * zoom + 26) + 30;
      canvas.id = 'creature-studio';
      canvas.style.cssText = 'position:fixed;left:0;top:0;z-index:10000;image-rendering:pixelated;background:#000';
      document.getElementById('creature-studio')?.remove();
      document.body.appendChild(canvas);
      const g = canvas.getContext('2d');
      g.fillStyle = '#0b1114'; g.fillRect(0, 0, canvas.width, canvas.height);
      g.fillStyle = '#cfd8c4'; g.font = '16px system-ui';
      g.fillText(`${kind} · creature studio · ${zoom}× fine pixels · lamp ${lamp}`, 10, 20);
      const tile = document.createElement('canvas'); tile.width = fw; tile.height = fh;
      const tg = tile.getContext('2d');
      for (let row = 0; row < rows; row++) {
        const scene = scenes[row];
        const world = new World(W, H);
        const stone = (x, y) => world.replaceCellAt(world.idx(x, y), Cell.Stone, 0x3d4447 + ((x * 7 + y * 3) % 4) * 0x040404);
        for (let y = FLOOR + 1; y < H; y++) for (let x = 0; x < W; x++) stone(x, y);
        // A ledge (step up) to the right, a wall far right, a pool on the left.
        for (let y = FLOOR - 5; y <= FLOOR; y++) for (let x = 232; x < W; x++) stone(x, y);
        for (let y = 20; y <= FLOOR; y++) for (let x = 300; x < 312; x++) stone(x, y);
        const swim = scene.startsWith('swim');
        if (scene === 'roost' || scene === 'ceiling') for (let y = FLOOR - 62; y <= FLOOR - 52; y++) for (let x = 0; x < 300; x++) stone(x, y);
        if (swim) for (let y = FLOOR - 40; y <= FLOOR; y++) for (let x = 20; x < 230; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0x1f4d72);
        const lampX = lamp === 'left' ? 110 : lamp === 'right' ? 250 : 175, lampY = lamp === 'top' ? 70 : 100;
        const field = { sample(x, y) {
          const d2 = (x - lampX) ** 2 + (y - lampY) ** 2;
          const I = 0.62 + 1.25 * Math.exp(-d2 / (2 * 38 * 38));
          return { r: Math.max(.48, Math.min(1.8, I * 1.05)), g: Math.max(.48, Math.min(1.8, I * 0.95)), b: Math.max(.48, Math.min(1.8, I * 0.82)) };
        } };
        const ctx = { ...source, world, state: { ...source.state, frameCount: 0, reduceFlashes: false, mode: 'play' },
          player: { ...source.player, x: 250, y: FLOOR - 6 } };
        const def = ENEMY_DEFS[kind];
        const fly = ['bat', 'imp', 'wisp'].includes(kind);
        const crawler = kind === 'weaver';
        const e = { kind, x: 170, y: fly ? FLOOR - 40 : swim ? FLOOR - 12 : FLOOR, fx: 0, fy: 0, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0,
          timer: 0, attackCd: 80, bobPhase: 0.4, grounded: !fly && !swim, stride: 0, splat: 0, prevG: true, blink: 0,
          jetFuel: 0, jetCd: 0, stuckT: 0, status: createDefaultStatus() };
        const mind = ensureCreatureMind(e, 777); mind.facing = 1;
        if (swim) { e.submerged = true; e.rillWet = 1; }
        const setAlert = (on) => {
          e.alerted = on; mind.visible = on; mind.confidence = on ? 1 : 0; mind.intent = on ? 'hunt' : 'forage';
          mind.targetX = ctx.player.x; mind.targetY = ctx.player.y;
        };
        let dead = false;
        const step = (t) => {
          ctx.state.frameCount = t;
          // die: killed by a blow from the left at t=36, then only the remains move.
          if (scene === 'die' && t === 36) { dead = addCorpse(ctx, e, 1.6, -1.2); }
          if (dead) { updateCorpses(ctx); return; }
          // buried: sand pours over everything behind the head, which walks on out.
          if (scene === 'buried' && t === 30) {
            for (let y = FLOOR - 16; y <= FLOOR; y++) for (let x = e.x - 44; x <= e.x - 3; x++) {
              if (world.types[world.idx(x, y)] === 0) world.replaceCellAt(world.idx(x, y), Cell.Sand, 0xc2a060 - ((x + y) % 3) * 0x080808);
            }
          }
          e.timer = t;
          if (e.flash > 0) e.flash--;
          switch (scene) {
            case 'idle': case 'die': setAlert(false); e.vx = 0; break;
            case 'buried': setAlert(false); e.vx = t < 30 ? 0 : 0.45; break;
            case 'walk': setAlert(false); e.vx = 0.42; break;
            case 'run': setAlert(true); e.vx = 0.9; break;
            case 'turn': setAlert(false); e.vx = t % 120 < 60 ? 0.35 : -0.35; mind.facing = e.vx > 0 ? 1 : -1; break;
            case 'alert': setAlert(true); e.vx = 0; mind.targetY = ctx.player.y - 20 + Math.sin(t * 0.05) * 20; break;
            case 'aim': setAlert(true); e.vx = 0; e.attackCd = 18 - Math.min(17, Math.max(0, t - 20) % 36); break;
            case 'spit': setAlert(true); e.vx = 0; e.attackCd = 100; e.recoil = Math.max(0, 14 - Math.max(0, t - 30) % 50); break;
            case 'hurt': setAlert(true); if (t % 30 === 0) { e.flash = 6; e.hp = Math.max(1, e.hp - def.hp * 0.1); } break;
            case 'fall': setAlert(false); if (t === 10) { e.y -= 30; e.grounded = false; } break;
            case 'swim': setAlert(false); e.vx = 0.5; e.vy = Math.sin(t * 0.05) * 0.3; break;
            case 'swimhunt': setAlert(true); e.vx = 0.8; break;
            case 'sleep': e.sleeping = true; setAlert(false); break;
            case 'hop': {
              setAlert(true); const ph = t % 56;
              if (ph === 0 && e.grounded) e.windup = 9;
              if (ph === 9 && e.grounded) { e.vy = -3.2; e.vx = 0.9; e.grounded = false; e.y -= 1; }
              if (e.grounded && ph > 9) e.vx *= 0.6;
              break;
            }
            case 'fly': setAlert(false); e.vx = Math.sin(t * 0.03) * 0.8; e.vy = Math.sin(t * 0.07) * 0.4; break;
            case 'dart': setAlert(true); { const ph = t % 50; e.windup = ph < 10 ? 10 - ph : 0; e.swoop = ph >= 10 && ph < 22 ? 22 - ph : 0; e.vx = e.swoop > 0 ? 2.2 : 0.1; e.vy = e.swoop > 0 ? 0.6 : -0.1; if (ph === 49) { e.x -= 30; e.y -= 6; } } break;
            case 'roost': e.sleeping = true; setAlert(false); e.vx = 0; e.vy = 0; break;
            case 'tumble': setAlert(true); e.tumble = 10; e.vx = Math.sin(t * 0.2) * 0.4; e.vy = 0.15; if (t % 60 === 0) e.y -= 18; break;
            case 'cast': setAlert(true); e.vx = Math.sin(t * 0.03) * 0.3; e.attackCd = 26 - (t % 44) > 0 ? 26 - (t % 44) : 150; break;
            case 'punch': setAlert(true); e.vx = 0; e.punching = 16 - (t % 40) > 0 ? 16 - (t % 40) : 0; break;
            case 'throw': setAlert(true); e.vx = 0; e.attackCd = (t % 60) === 0 ? 240 : Math.max(0, e.attackCd - 1); break;
            case 'slam': setAlert(true); e.vx = 0; e.attackCd = 22 - (t % 50) > 0 ? 22 - (t % 50) : 150; break;
            case 'telek': setAlert(true); e.vx = 0; e.blink = 20 - (t % 50) > 0 ? 20 - (t % 50) : 0; break;
            case 'swimlunge': case 'lunge': setAlert(true); { const ph = t % 50; e.windup = ph < 16 ? 16 - ph : 0; e.swoop = ph >= 16 && ph < 30 ? 30 - ph : 0; e.vx = e.swoop ? 1.6 : 0.1; } break;
            case 'chew': setAlert(true); e.vx = 0.2; e.mawChewT = 10 - (t % 30) > 0 ? 10 - (t % 30) : 0; break;
            case 'charge': setAlert(true); e.vx = 0.3; e.rillChargeWindup = 18 - (t % 40) > 0 ? 18 - (t % 40) : 0; e.blink = e.rillChargeWindup; break;
            case 'lash': setAlert(true); { const ph = t % 50; e.windup = ph < 13 ? 13 - ph : 0; e.rootLashT = ph >= 13 && ph < 23 ? 23 - ph : 0; e.rootLashX = e.x + 26; e.rootLashY = e.y - 14; } break;
            case 'fuse': setAlert(true); e.fusing = 36 - (t % 44) > 0 ? 36 - (t % 44) : 0; break;
            default:
              // boss-<move>[-bare]: a boss posed from its brain's move clock (creatures/bosses).
              if (scene.startsWith('boss-')) {
                setAlert(true); e.vx = 0;
                const [, move, mod] = scene.split('-');
                const dur = { slam: 74, stomp: 66, throw: 64, vent: 98, quench: 160, dying: 214, lunge: 40, dive: 70, thrash: 40 }[move] ?? 80;
                e.boss ??= { phase: 1, heat: 1, plates: 6, exposed: 0, move: 'march', moveT: 0, waves: [], said: [] };
                e.boss.move = move === 'march' ? 'march' : move; e.boss.moveT = move === 'dying' ? Math.min(t, dur) : t % dur;
                e.boss.heat = move === 'quench' ? 0.15 : 1; e.boss.exposed = move === 'quench' ? 30 : 0;
                e.boss.plates = mod === 'bare' ? 0 : 6;
                if (move === 'march') e.vx = 0.4;
              }
              break;
          }
          if (e.windup > 0) e.windup--;
          // Minimal integration: walkers slide along the floor, fallers fall.
          if (crawler) { /* the surface crawler owns e.x/e.y */ } else if (!fly && !swim) {
            e.vy = e.grounded ? 0 : Math.min(4, e.vy + 0.3);
            e.fy += e.vy;
            while (e.fy >= 1) { if (world.types[world.idx(e.x, e.y + 1)] === 0) { e.y++; e.fy--; } else { e.fy = 0; e.vy = 0; } }
            while (e.fy <= -1) { e.y--; e.fy++; }
            e.grounded = world.types[world.idx(Math.round(e.x), e.y + 1)] !== 0;
          } else { e.fy += e.vy; while (e.fy >= 1) { e.y++; e.fy--; } while (e.fy <= -1) { e.y--; e.fy++; } }
          if (!crawler) e.fx += e.vx;
          while (e.fx >= 1) { e.x++; e.fx--; if (!fly && !swim && world.types[world.idx(e.x + def.halfW, e.y)] !== 0) { let up = 0; while (up < 6 && world.types[world.idx(e.x + def.halfW, e.y - up)] !== 0) up++; e.y -= up; } }
          while (e.fx <= -1) { e.x--; e.fx++; }
          if (Math.abs(e.vx) > 0.12) mind.facing = Math.sign(e.vx);
          if (kind === 'weaver') {
            const moving = Math.abs(e.vx) > 0.05 || scene === 'wall' || scene === 'ceiling';
            const tgt = scene === 'wall' ? { x: 306, y: 40 } : scene === 'ceiling' ? { x: 60, y: FLOOR - 70 } : { x: e.x + Math.sign(e.vx || 1) * 60, y: e.y };
            if (scene === 'wall' || scene === 'ceiling') { e.x = e.weaverLoco ? e.x : e.x; }
            tickWeaverLocomotion(ctx, e, def, { move: moving ? 'toward' : 'hold', tx: tgt.x, ty: tgt.y, urgency: scene === 'run' ? 0.9 : 0.4,
              stance: e.windup > 0 ? 'crouch' : e.sleeping ? 'sleep' : 'normal', speedScale: 1 });
          }
          tickCreaturePose(ctx, e);
        };
        for (let t = 0; t < 30; t++) step(t);
        for (let col = 0; col < cols; col++) {
          for (let k = 0; k < every; k++) step(30 + col * every + k);
          // Crop centred on the creature.
          const cx0 = Math.round(e.x - CW / 2), cy0 = Math.round((fly || swim || (crawler && (scene === 'wall' || scene === 'ceiling')) ? e.y - CH / 2 : FLOOR - CH + Math.min(12, CH * 0.28)));
          const buf = new Float32Array(fw * fh * 3);
          // Background + terrain lit by the field.
          for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
            const wx = cx0 + fx / 2, wy = cy0 + fy / 2;
            const L = field.sample(wx, wy), o = (fy * fw + fx) * 3;
            const cxi = Math.floor(wx), cyi = Math.floor(wy);
            const t = world.inBounds(cxi, cyi) ? world.types[world.idx(cxi, cyi)] : 0;
            if (t === 0) { buf[o] = 0.055 * L.r; buf[o + 1] = 0.075 * L.g; buf[o + 2] = 0.085 * L.b; }
            else {
              const c = world.colors[world.idx(cxi, cyi)];
              const edge = world.inBounds(cxi, cyi - 1) && world.types[world.idx(cxi, cyi - 1)] === 0 ? 1.35 : 1;
              buf[o] = ((c >> 16) & 255) / 255 * L.r * edge; buf[o + 1] = ((c >> 8) & 255) / 255 * L.g * edge; buf[o + 2] = (c & 255) / 255 * L.b * edge;
            }
          }
          const at = (x, y) => { const fx = Math.round((x - cx0) * 2), fy = Math.round((y - cy0) * 2); return fx < 0 || fy < 0 || fx >= fw || fy >= fh ? -1 : (fy * fw + fx) * 3; };
          const surf = { pixelStep: 0.5,
            setFinePx(x, y, r, gg, b) { const o = at(x, y); if (o < 0) return; buf[o] = r; buf[o + 1] = gg; buf[o + 2] = b; },
            addFinePx(x, y, r, gg, b) { const o = at(x, y); if (o < 0) return; buf[o] += r; buf[o + 1] += gg; buf[o + 2] += b; },
            blendFinePx(x, y, r, gg, b, a) { const o = at(x, y); if (o < 0) return; buf[o] = buf[o] * (1 - a) + r; buf[o + 1] = buf[o + 1] * (1 - a) + gg; buf[o + 2] = buf[o + 2] * (1 - a) + b; },
            setPx(x, y, r, gg, b) { for (let dy = 0; dy < 1; dy += .5) for (let dx = 0; dx < 1; dx += .5) this.setFinePx(x + dx, y + dy, r, gg, b); },
            addPx(x, y, r, gg, b) { for (let dy = 0; dy < 1; dy += .5) for (let dx = 0; dx < 1; dx += .5) this.addFinePx(x + dx, y + dy, r, gg, b); },
          };
          drawCreatureSprite(surf, field, ctx, e);
          const img = tg.createImageData(fw, fh);
          for (let i = 0; i < fw * fh; i++) {
            // A gentle filmic shoulder like the game's tonemap, then sRGB bytes.
            for (let c = 0; c < 3; c++) { const v = buf[i * 3 + c]; img.data[i * 4 + c] = Math.round(255 * Math.min(1, v / (1 + v * 0.18) * 1.1)); }
            img.data[i * 4 + 3] = 255;
          }
          tg.putImageData(img, 0, 0);
          g.imageSmoothingEnabled = false;
          const X = 8 + col * (fw * zoom + 8), Y = 30 + row * (fh * zoom + 26);
          g.drawImage(tile, X, Y, fw * zoom, fh * zoom);
          g.fillStyle = '#9fb0a0'; g.font = '13px system-ui';
          g.fillText(`${scene} t=${30 + (col + 1) * every}`, X + 4, Y + fh * zoom + 16);
        }
      }
      return { w: canvas.width, h: canvas.height };
    }, { kind, scenes, zoom, frames, every, lamp, cw, ch });
    const file = `${out}/${kind}${tag ? '-' + tag : ''}.png`;
    await page.locator('#creature-studio').screenshot({ path: file });
    console.log(file, JSON.stringify(info));
  }
  if (errors.length) console.log('ERRORS', errors.slice(0, 10));
} finally {
  await browser.close();
}
