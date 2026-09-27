// Creature action GIFs for the capture library. Every species is staged in a
// small lit world and driven through each of its actions with the real rig,
// pose, corpse and art code (the same pipeline as scripts/creature-studio.mjs):
// one GIF per action plus a captioned loop of all of them, and a manifest the
// gallery's "Creature actions" view reads.
// Usage: node scripts/generate-creature-gifs.mjs [url] [kinds,comma,separated]
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launchBrowser } from './browser-launch.mjs';
import { waitForConsoleApi } from './run-helpers.mjs';
import { refreshScreenshotGallery, SCREENSHOT_ROOT } from './screenshot-archive.mjs';

const A = (id, label, scene = id) => ({ id, label, scene });
const HURT = A('hurt', 'Hurt'), DEATH = A('death', 'Death & remains');
/** Each species' repertoire, in the order a player would meet it. */
const CATALOG = {
  slime: [A('idle', 'At ease'), A('blink', 'Blinking'), A('hop', 'Hopping'), A('land', 'Landing splat'), A('alert', 'Noticing you'), HURT, DEATH],
  acidslime: [A('idle', 'At ease'), A('blink', 'Blinking'), A('hop', 'Hopping'), A('land', 'Landing splat'), A('alert', 'Noticing you'), HURT, DEATH],
  bomber: [A('idle', 'At ease'), A('hop', 'Hopping'), A('fuse', 'Lit fuse'), HURT],
  eggs: [A('idle', 'Incubating'), A('ripe', 'About to hatch'), HURT],
  spitter: [A('idle', 'At ease'), A('walk', 'Walking'), A('run', 'Running'), A('turn', 'Turning'), A('alert', 'Tracking you'), A('aim', 'Acid sac swelling'), A('spit', 'Spitting'), A('fall', 'Falling & landing'), HURT, DEATH],
  bat: [A('roost', 'Roosting'), A('fly', 'Flying'), A('alert', 'Circling'), A('dart', 'Darting strike'), A('tumble', 'Tumbling'), A('gummed', 'Gummed wings'), HURT, DEATH],
  imp: [A('fly', 'Hovering'), A('alert', 'Noticing you'), A('cast', 'Charging a fireball'), A('throw', 'Throwing'), HURT, DEATH],
  wisp: [A('fly', 'Drifting'), A('alert', 'Noticing you'), A('pulse', 'Pulsing'), A('flee', 'Fleeing'), HURT, DEATH],
  mage: [A('idle', 'At ease'), A('walk', 'Walking'), A('alert', 'Noticing you'), A('telek', 'Telekinesis'), HURT, DEATH],
  golem: [A('idle', 'At ease'), A('walk', 'Walking'), A('turn', 'Turning'), A('punch', 'Punching'), A('slam', 'Slam windup'), A('throw', 'Throwing rock'), A('jet', 'Jet boost'), HURT, DEATH],
  colossus: [A('idle', 'At ease'), A('walk', 'Walking'), A('punch', 'Punching'), A('slam', 'Slam windup'), A('throw', 'Hurling magma'), A('cooled', 'Doused'), HURT],
  weaver: [A('idle', 'At ease'), A('walk', 'Walking'), A('stalk', 'Stalking'), A('wall', 'Wall crawling'), A('ceiling', 'Ceiling crawling'), A('rear', 'Rearing'), A('pounce', 'Pouncing'), A('weave', 'Weaving'), A('feed', 'Feeding'), A('sleep', 'Sleeping'), A('limp', 'Limping, leg lost'), A('lost3', 'Three legs lost'), HURT, DEATH],
  rootloper: [A('idle', 'At ease'), A('walk', 'Walking'), A('alert', 'Noticing you'), A('lash', 'Root lash'), A('panic', 'Footing panic'), HURT, DEATH],
  stonemaw: [A('idle', 'At ease'), A('walk', 'Crawling'), A('run', 'Hunting surge'), A('chew', 'Chewing rock'), A('stunned', 'Stunned'), HURT, DEATH],
  rillback: [A('swim', 'Swimming'), A('swimhunt', 'Hunting'), A('swimlunge', 'Lunging bite'), A('charge', 'Electric charge'), A('feed', 'Feeding'), A('beached', 'Beached flop'), HURT, DEATH],
  leviathan: [A('swim', 'Swimming'), A('swimhunt', 'Hunting'), A('swimlunge', 'Lunging bite'), HURT, DEATH],
};
const NAMES = { rootloper: 'Root Loper', stonemaw: 'Stone Maw', acidslime: 'Acid Slime', colossus: 'Kiln Colossus', leviathan: 'Sunken Leviathan', eggs: 'Slime Eggs' };
/** Crop in cells: big bodies get a wider stage. */
const CROP = { colossus: [120, 76], leviathan: [128, 72], weaver: [92, 60], golem: [80, 52], mage: [54, 38], rootloper: [80, 50], rillback: [84, 48], stonemaw: [80, 44],
  spitter: [60, 34], slime: [44, 30], acidslime: [44, 30], bomber: [44, 30], eggs: [36, 24], bat: [48, 34], imp: [48, 34], wisp: [48, 34] };
/** Small bodies get a closer lens so a slime is not a speck. */
const ZOOM = { mage: 4, spitter: 4, slime: 4, acidslime: 4, bomber: 4, eggs: 4, bat: 4, imp: 4, wisp: 4 };

const url = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : 'http://localhost:5173/';
const requested = process.argv[3]?.split(',') ?? Object.keys(CATALOG);
for (const kind of requested) assert.ok(CATALOG[kind], `Unknown creature ${kind}`);
const output = `${SCREENSHOT_ROOT}/creatures`, scratch = 'verify-out/living-descent/gif-frames';
mkdirSync(output, { recursive: true }); mkdirSync(scratch, { recursive: true });
let manifest = [];
try { manifest = JSON.parse(readFileSync(`${output}/manifest.json`, 'utf8')); } catch { /* first generation */ }

const browser = await launchBrowser();
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto(url);
  await waitForConsoleApi(page);
  for (const kind of requested) {
    const name = NAMES[kind] ?? kind[0].toUpperCase() + kind.slice(1);
    const actions = CATALOG[kind];
    const [cw, ch] = CROP[kind] ?? [64, 42];
    const started = Date.now();
    const data = await page.evaluate(renderKind, { kind, name, actions, cw, ch, zoom: ZOOM[kind] ?? 3, warm: 40, ticks: 96, every: 3 });
    // Resting actions may be nearly still; everything else must visibly move.
    const RESTING = new Set(['roost', 'sleep', 'idle', 'ripe', 'gummed', 'stunned', 'cooled']);
    for (const action of data.actions) {
      const unique = new Set(action.frames.map(f => f.length)).size;
      assert.ok(unique > (RESTING.has(action.id) ? 0 : 3), `${kind}/${action.id} must actually move (${unique} distinct frames)`);
    }
    const input = `${scratch}/${kind}.json`;
    writeFileSync(input, JSON.stringify({ kind, band: data.band, actions: data.actions }));
    const result = spawnSync('python', ['scripts/encode-creature-gifs.py', input, `${output}`], { encoding: 'utf8', windowsHide: true, maxBuffer: 1 << 26 });
    if (result.status !== 0) throw new Error(`${kind} GIF encoding failed: ${result.stderr}`);
    const meta = JSON.parse(result.stdout.trim().split('\n').at(-1));
    manifest = manifest.filter(entry => entry.id !== kind);
    manifest.push({ id: kind, name, poses: actions.map(a => a.label), gif: `creatures/${kind}.gif`, poster: `creatures/${kind}.png`,
      frames: meta.frames, durationMs: meta.durationMs, bytes: meta.bytes, loop: 0,
      actions: actions.map(a => ({ id: a.id, name: a.label, gif: `creatures/${kind}/${a.id}.gif`, poster: `creatures/${kind}/${a.id}.png`,
        durationMs: meta.actions[a.id].durationMs, bytes: meta.actions[a.id].bytes })),
      generatedAt: new Date().toISOString() });
    manifest.sort((a, b) => Object.keys(CATALOG).indexOf(a.id) - Object.keys(CATALOG).indexOf(b.id));
    writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2));
    console.log(`${name}: ${actions.length} actions, ${meta.frames} frames, ${(meta.bytes / 1048576).toFixed(2)} MB loop, ${((Date.now() - started) / 1000).toFixed(1)}s`);
  }
  refreshScreenshotGallery();
  if (errors.length) throw new Error(errors.slice(0, 5).join('\n'));
} finally {
  await browser.close();
}

/** Runs in the page: stage, drive and rasterize one species' actions. */
async function renderKind({ kind, name, actions, cw, ch, zoom, warm, ticks, every }) {
  const { World } = await import('/src/sim/World.ts');
  const { Cell } = await import('/src/sim/CellType.ts');
  const { drawCreatureSprite } = await import('/src/render/sprites/CreatureArt.ts');
  const { drawCorpses } = await import('/src/render/creatures/index.ts');
  const { addCorpse, updateCorpses, clearCorpses } = await import('/src/creatures/corpses.ts');
  const { createDefaultStatus } = await import('/src/entities/status.ts');
  const { ensureCreatureMind } = await import('/src/creatures/perception.ts');
  const { tickCreaturePose } = await import('/src/creatures/pose.ts');
  const { ENEMY_DEFS } = await import('/src/content/enemyDefs.ts');
  const { tickWeaverLocomotion, weaverLeap } = await import('/src/entities/weaverLocomotion.ts');
  const source = window.__game.ctx;
  const W = 520, H = 220, FLOOR = 180, START = 150;
  const fw = cw * 2, fh = ch * 2, band = 30;
  const canvas = document.createElement('canvas');
  canvas.width = fw * zoom; canvas.height = fh * zoom + band;
  const g = canvas.getContext('2d');
  const tile = document.createElement('canvas'); tile.width = fw; tile.height = fh;
  const tg = tile.getContext('2d');
  const def = ENEMY_DEFS[kind];
  const fly = ['bat', 'imp', 'wisp'].includes(kind);
  const out = [];
  for (const [index, action] of actions.entries()) {
    const scene = action.scene;
    const world = new World(W, H);
    const stone = (x, y, tone = 0x3d4447) => world.replaceCellAt(world.idx(x, y), Cell.Stone, tone + ((x * 7 + y * 3) % 4) * 0x040404);
    for (let y = FLOOR + 1; y < H; y++) for (let x = 0; x < W; x++) stone(x, y);
    const ceilY = FLOOR - ch + 12;
    const water = ['swim', 'swimhunt', 'swimlunge', 'charge', 'feed'].includes(scene) && (kind === 'rillback' || kind === 'leviathan');
    if (water || (kind === 'rillback' && scene === 'hurt') || (kind === 'rillback' && scene === 'death') || (kind === 'leviathan' && (scene === 'hurt' || scene === 'death'))) {
      for (let y = FLOOR - Math.min(ch - 10, kind === 'leviathan' ? 60 : 34); y <= FLOOR; y++) for (let x = 0; x < W; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0x1f4d72);
    }
    const ceiling = scene === 'roost' || (kind === 'weaver' && scene === 'ceiling');
    if (ceiling) for (let y = ceilY - 6; y <= ceilY; y++) for (let x = 0; x < W; x++) stone(x, y);
    const wallX = START + 24;
    if (kind === 'weaver' && scene === 'wall') for (let y = 0; y <= FLOOR; y++) for (let x = wallX; x < wallX + 10; x++) stone(x, y);
    if (scene === 'chew') for (let y = FLOOR - 24; y <= FLOOR; y++) for (let x = START + 14; x < START + 60; x++) stone(x, y, 0x4a4f4c);
    const lamp = { x: START - 30, y: FLOOR - Math.min(ch * 0.7, 46) };
    const field = { sample(x, y) {
      const d2 = (x - lamp.x) ** 2 + (y - lamp.y) ** 2;
      const I = 0.62 + 1.25 * Math.exp(-d2 / (2 * 44 * 44));
      return { r: Math.max(.5, Math.min(1.8, I * 1.05)), g: Math.max(.5, Math.min(1.8, I * 0.96)), b: Math.max(.5, Math.min(1.8, I * 0.84)) };
    } };
    const ctx = { ...source, world, state: { ...source.state, frameCount: 0, reduceFlashes: false, mode: 'play' },
      player: { ...source.player, x: START + 70, y: FLOOR - 1, dead: false } };
    const swimY = FLOOR - (kind === 'leviathan' ? 24 : 12);
    const flyY = FLOOR - Math.round(Math.min(24, ch * 0.42));
    const e = { kind, x: START, y: fly ? flyY : water ? swimY : FLOOR, fx: 0, fy: 0, vx: 0, vy: 0, hp: def.hp, maxHp: def.hp, flash: 0,
      timer: 0, attackCd: 80, bobPhase: 0.4, grounded: !fly && !water, stride: 0, splat: 0, prevG: true, blink: 0,
      jetFuel: 0, jetCd: 0, stuckT: 0, status: createDefaultStatus(), sourceId: 'gif' };
    if (water) { e.submerged = true; e.rillWet = 1; }
    if (scene === 'roost') { e.y = ceilY + 9; e.sleeping = true; }
    if (kind === 'weaver' && scene === 'ceiling') e.y = ceilY + 16;
    if (kind === 'weaver' && scene === 'wall') e.x = wallX - 12;
    if (kind === 'eggs' && scene === 'ripe') e.timer = 1500;
    const mind = ensureCreatureMind(e, 777); mind.facing = 1;
    const alert = (on) => {
      e.alerted = on; mind.visible = on; mind.confidence = on ? 1 : 0; mind.intent = on ? 'hunt' : 'forage';
      mind.targetX = ctx.player.x; mind.targetY = ctx.player.y;
    };
    let dead = false, camX = e.x;
    const hit = (t, kx = -1.6, amount = 10) => {
      e.flash = 6; e.hitAt = t; e.hitKx = kx; e.hitKy = -0.8; e.hitAmount = amount;
      e.hp = Math.max(def.hp * 0.12, e.hp - def.hp * 0.12);
    };
    const step = (t) => {
      ctx.state.frameCount = t + 600 + index * 97;
      if (kind !== 'eggs' || scene !== 'ripe') e.timer = t;
      else e.timer = 1500 + t;
      if (e.flash > 0) e.flash--;
      const rec = t - warm; // negative while warming up
      switch (scene) {
        case 'idle': alert(false); e.vx = 0; break;
        case 'blink': alert(false); e.vx = 0; e.blink = (rec % 48) < 6 ? 6 - (rec % 48) : 0; break;
        case 'walk': alert(false); e.vx = kind === 'weaver' ? 0.5 : 0.42; break;
        case 'run': alert(true); e.vx = 0.9; break;
        case 'turn': alert(false); e.vx = (rec + 400) % 96 < 48 ? 0.35 : -0.35; mind.facing = e.vx > 0 ? 1 : -1; break;
        case 'alert': alert(true); e.vx = 0; mind.targetY = ctx.player.y - 20 + Math.sin(t * 0.05) * 20;
          if (fly) { e.vx = Math.cos(t * 0.05) * 0.5; e.vy = Math.sin(t * 0.09) * 0.35; } break;
        case 'aim': alert(true); e.vx = 0; e.attackCd = 18 - Math.min(17, Math.max(0, rec + 400) % 48); break;
        case 'spit': alert(true); e.vx = 0; e.attackCd = 100; e.recoil = Math.max(0, 14 - (rec + 400) % 48); break;
        case 'hurt': alert(true); if (fly) e.vy = Math.sin(t * 0.09) * 0.3; if (water) e.vx = 0.2; if (rec >= 0 && rec % 32 === 0) hit(t, rec % 64 === 0 ? -1.8 : 1.4); break;
        case 'fall': alert(false); if (rec >= 0 && rec % 48 === 0) { e.y = FLOOR - 26; e.grounded = false; e.vy = 0; } break;
        case 'swim': alert(false); e.vx = 0.5; e.vy = Math.sin(t * 0.05) * 0.25; break;
        case 'swimhunt': alert(true); e.vx = 0.85; e.vy = Math.sin(t * 0.08) * 0.35; break;
        case 'swimlunge': alert(true); { const ph = (rec + 400) % 48; e.windup = ph < 16 ? 16 - ph : 0; e.swoop = ph >= 16 && ph < 30 ? 30 - ph : 0; e.vx = e.swoop ? 1.6 : 0.12; } break;
        case 'charge': alert(true); e.vx = 0.3; e.rillChargeWindup = 18 - (rec + 400) % 32 > 0 ? 18 - (rec + 400) % 32 : 0; e.blink = e.rillChargeWindup; break;
        case 'feed': alert(false); e.vx = kind === 'weaver' ? 0 : 0.15; e.rillFeedT = 60; e.weaverFeedT = 18; break;
        case 'beached': alert(true); e.rillWet = 0; e.vx = 0; if ((rec + 400) % 34 === 0 && e.grounded) { e.vy = -1.4; e.vx = 0.5; e.grounded = false; } break;
        case 'hop': case 'land': {
          alert(true); const ph = (rec + 400) % 48;
          if (ph === 0 && e.grounded) e.windup = 9;
          if (ph === 9 && e.grounded) { e.vy = scene === 'land' ? -2.0 : -2.5; e.vx = scene === 'land' ? 0 : 0.8; e.grounded = false; e.y -= 1; }
          if (e.grounded && ph > 9) e.vx *= 0.6;
          break;
        }
        case 'fly': alert(false); e.vx = Math.sin(t * 0.03) * 0.7; e.vy = Math.sin(t * 0.07) * 0.35; break;
        case 'flee': alert(true); e.fear = 0.9; mind.intent = 'retreat'; e.vx = -0.7; e.vy = Math.sin(t * 0.11) * 0.4; break;
        case 'dart': alert(true); { const ph = (rec + 400) % 48; e.windup = ph < 10 ? 10 - ph : 0; e.swoop = ph >= 10 && ph < 22 ? 22 - ph : 0; e.vx = e.swoop > 0 ? 2.2 : 0.1; e.vy = e.swoop > 0 ? 0.6 : -0.1; if (ph === 47) { e.x = START; e.y = flyY; e.fy = 0; } } break;
        case 'roost': e.sleeping = true; alert(false); e.vx = 0; e.vy = 0; break;
        case 'tumble': alert(true); e.tumble = 10; e.vx = Math.sin(t * 0.2) * 0.4; e.vy = 0.22; if ((rec + 400) % 48 === 0) { e.y = flyY - 6; e.fy = 0; } break;
        case 'gummed': alert(true); e.slimed = 20; e.vx = 0; break;
        case 'cast': alert(true); e.vx = Math.sin(t * 0.03) * 0.3; e.attackCd = 26 - (rec + 400) % 48 > 0 ? 26 - (rec + 400) % 48 : 150; break;
        case 'throw': alert(true); e.vx = 0; e.attackCd = (rec + 400) % 48 === 0 ? 240 : Math.max(0, e.attackCd - 1); break;
        case 'pulse': alert(true); e.vx = Math.sin(t * 0.04) * 0.3; e.vy = Math.sin(t * 0.08) * 0.2; e.attackCd = 26 - (rec + 400) % 48 > 0 ? 26 - (rec + 400) % 48 : 120; break;
        case 'punch': alert(true); e.vx = 0; e.punching = 16 - (rec + 400) % 40 > 0 ? 16 - (rec + 400) % 40 : 0; break;
        case 'slam': alert(true); e.vx = 0; e.attackCd = 22 - (rec + 400) % 48 > 0 ? 22 - (rec + 400) % 48 : 150; break;
        case 'jet': alert(true); { const ph = (rec + 400) % 64; e.jetFuel = ph < 22 ? 22 - ph : 0; if (e.jetFuel > 0) { e.vy = Math.max(-1.6, e.vy - 0.5); e.grounded = false; } e.vx = 0.2; } break;
        case 'cooled': alert(true); e.status.wet = 60; e.vx = 0.15; break;
        case 'telek': alert(true); e.vx = 0; e.blink = 20 - (rec + 400) % 48 > 0 ? 20 - (rec + 400) % 48 : 0; break;
        case 'chew': alert(true); e.vx = 0.12; e.mawChewT = 10 - (rec + 400) % 30 > 0 ? 10 - (rec + 400) % 30 : 0;
          if (e.mawChewT === 9) for (let y = FLOOR - 12; y <= FLOOR; y++) for (let x = Math.floor(e.x) + 8; x < Math.floor(e.x) + 13; x++) world.clearCellAt(world.idx(x, y));
          break;
        case 'stunned': alert(true); e.vx = 0; e.mawStun = 18; break;
        case 'lash': alert(true); { const ph = (rec + 400) % 48; e.windup = ph < 13 ? 13 - ph : 0; e.rootLashT = ph >= 13 && ph < 23 ? 23 - ph : 0; e.rootLashX = e.x + 26; e.rootLashY = e.y - 14; } break;
        case 'panic': alert(true); e.rootPanic = 20; e.fear = 0.8; e.vx = Math.sin(t * 0.3) * 0.3; break;
        case 'fuse': alert(true); e.fusing = 36 - (rec + 400) % 44 > 0 ? 36 - (rec + 400) % 44 : 0; break;
        case 'ripe': alert(false); break;
        case 'death': alert(true); if (rec < 0) break;
          if (rec === 6) hit(t, -1.8, 30);
          if (rec === 12 && !dead) { dead = addCorpse(ctx, e, -1.8, -1.4); if (!dead) e.hp = 0; }
          break;
        default: alert(false); break;
      }
      if (e.windup > 0 && !['swimlunge', 'dart', 'lash'].includes(scene)) e.windup--;
      if (dead) { updateCorpses(ctx); return; }
      if (kind === 'weaver') {
        e.weaverMissingLegs = scene === 'lost3' ? 0b00110010 : scene === 'limp' ? 0b00000010 : 0;
        e.weaverRetreatT = e.weaverMissingLegs ? 90 : 0;
        e.sleeping = scene === 'sleep';
        e.blink = scene === 'weave' ? 18 : 0;
        if (scene === 'pounce' && rec >= 0 && rec % 48 === 0) weaverLeap(e, e.x + 50, FLOOR - 4);
        if (scene === 'pounce' && rec >= 0 && rec % 48 === 40) { e.x -= 50; if (e.weaverLoco) e.weaverLoco = undefined; }
        const moving = ['walk', 'stalk', 'wall', 'ceiling', 'limp', 'lost3', 'run'].includes(scene);
        const tgt = scene === 'wall' ? { x: wallX, y: FLOOR - 80 } : scene === 'ceiling' ? { x: e.x + 60, y: ceilY } : { x: e.x + 60, y: FLOOR };
        tickWeaverLocomotion(ctx, e, def, { move: moving ? 'toward' : 'hold', tx: tgt.x, ty: tgt.y, urgency: scene === 'stalk' ? 0.25 : 0.45,
          stance: scene === 'sleep' ? 'sleep' : ['stalk', 'feed'].includes(scene) ? 'crouch' : scene === 'rear' ? 'rear' : 'normal', speedScale: scene === 'stalk' ? 0.5 : 1 });
      } else if (!fly && !water) {
        e.vy = e.grounded ? Math.min(0, e.vy) : Math.min(4, e.vy + 0.3);
        e.fy += e.vy;
        while (e.fy >= 1) { if (!world.types[world.idx(Math.round(e.x), e.y + 1)]) { e.y++; e.fy--; } else { e.fy = 0; e.vy = 0; } }
        while (e.fy <= -1) { e.y--; e.fy++; }
        const wasGrounded = e.grounded;
        e.grounded = world.types[world.idx(Math.round(e.x), e.y + 1)] !== 0;
        if (e.grounded && !wasGrounded) e.splat = 8;
        if (e.splat > 0) e.splat--;
      } else { e.fy += e.vy; while (e.fy >= 1) { e.y++; e.fy--; } while (e.fy <= -1) { e.y--; e.fy++; } }
      if (kind !== 'weaver') {
        e.fx += e.vx;
        while (e.fx >= 1) { e.x++; e.fx--; }
        while (e.fx <= -1) { e.x--; e.fx++; }
      }
      if (Math.abs(e.vx) > 0.12) mind.facing = Math.sign(e.vx);
      tickCreaturePose(ctx, e);
    };
    clearCorpses();
    for (let t = 0; t < warm; t++) step(t);
    const frames = [];
    camX = kind === 'weaver' ? (e.weaverLoco?.px ?? e.x) : e.x;
    for (let t = warm; t < warm + ticks; t++) {
      step(t);
      const bodyX = kind === 'weaver' ? (e.weaverLoco?.px ?? e.x) : e.x;
      camX += (bodyX - camX) * 0.18;
      if ((t - warm) % every !== 0) continue;
      const cx0 = Math.round(camX - cw / 2), cy0 = FLOOR - ch + 8;
      const buf = new Float32Array(fw * fh * 3);
      for (let fy = 0; fy < fh; fy++) for (let fx = 0; fx < fw; fx++) {
        const wx = cx0 + fx / 2, wy = cy0 + fy / 2;
        const L = field.sample(wx, wy), o = (fy * fw + fx) * 3;
        const cxi = Math.floor(wx), cyi = Math.floor(wy);
        const type = world.inBounds(cxi, cyi) ? world.types[world.idx(cxi, cyi)] : 0;
        if (type === 0) {
          // A faint back wall so the silhouette reads against depth.
          const brick = ((Math.floor(wx / 8) + Math.floor(wy / 4)) % 2) * 0.006;
          buf[o] = (0.05 + brick) * L.r; buf[o + 1] = (0.07 + brick) * L.g; buf[o + 2] = (0.08 + brick) * L.b;
        } else {
          const c = world.colors[world.idx(cxi, cyi)];
          const liquid = type === Cell.Water;
          const edge = !liquid && world.inBounds(cxi, cyi - 1) && world.types[world.idx(cxi, cyi - 1)] === 0 ? 1.35 : 1;
          const k = liquid ? 0.9 : 1;
          buf[o] = ((c >> 16) & 255) / 255 * L.r * edge * k; buf[o + 1] = ((c >> 8) & 255) / 255 * L.g * edge * k; buf[o + 2] = (c & 255) / 255 * L.b * edge * k;
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
      if (dead) drawCorpses(surf, field, ctx, () => true);
      else drawCreatureSprite(surf, field, ctx, e);
      const img = tg.createImageData(fw, fh);
      for (let i = 0; i < fw * fh; i++) {
        for (let c = 0; c < 3; c++) { const v = buf[i * 3 + c]; img.data[i * 4 + c] = Math.round(255 * Math.min(1, v / (1 + v * 0.18) * 1.1)); }
        img.data[i * 4 + 3] = 255;
      }
      tg.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = false;
      g.drawImage(tile, 0, 0, fw * zoom, fh * zoom);
      g.fillStyle = '#0e1a1f'; g.fillRect(0, fh * zoom, canvas.width, band);
      g.fillStyle = '#e2e7d9'; g.font = '600 15px system-ui'; g.fillText(name, 10, fh * zoom + 20);
      const nameW = g.measureText(name).width;
      g.fillStyle = '#d5b982'; g.font = '14px system-ui'; g.fillText(`· ${action.label}`, 16 + nameW, fh * zoom + 20);
      g.fillStyle = '#7f9590'; g.font = '12px system-ui';
      const tag = `${index + 1} / ${actions.length}`; g.fillText(tag, canvas.width - 10 - g.measureText(tag).width, fh * zoom + 20);
      frames.push(canvas.toDataURL('image/png').split(',')[1]);
    }
    clearCorpses();
    out.push({ id: action.id, label: action.label, frames });
  }
  return { band, actions: out };
}
