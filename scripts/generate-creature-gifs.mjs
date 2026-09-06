import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { launchBrowser } from './browser-launch.mjs';
import { execConsoleCommand, waitForConsoleApi, waitForRunReady } from './run-helpers.mjs';
import { refreshScreenshotGallery, SCREENSHOT_ROOT } from './screenshot-archive.mjs';

// Finite pose catalog: the GIFs exercise native art and pose systems with
// explicitly staged states. Gameplay videos remain separate evidence.
const COMMON = ['At ease', 'Attention', 'Moving', 'Windup', 'Attacking', 'Wounded', 'Retreating', 'Resting'];
const CATALOG = {
  weaver: ['At ease', 'Attention', 'Moving', 'Wall crawling', 'Ceiling crawling', 'Stalking', 'Rearing', 'Windup', 'Pouncing', 'Feeding', 'Weaving', 'Wounded', 'Retreating', 'Sleeping', 'Lost a leg', 'Limping', 'Three legs lost'],
  rillback: ['At ease', 'Attention', 'Swimming', 'Beached', 'Windup', 'Lunging', 'Feeding', 'Charging', 'Wounded', 'Retreating', 'Resting'],
  rootloper: ['At ease', 'Attention', 'Moving', 'Windup', 'Lashing', 'Footing panic', 'Wounded', 'Retreating', 'Resting'],
  stonemaw: ['At ease', 'Sensing vibration', 'Burrowing', 'Chewing', 'Stunned', 'Wounded', 'Resting'],
  slime: ['At ease', 'Attention', 'Windup', 'Hopping', 'Landing', 'Blinking', 'Wounded', 'Retreating', 'Resting'],
  acidslime: ['At ease', 'Attention', 'Windup', 'Hopping', 'Landing', 'Blinking', 'Wounded', 'Retreating', 'Resting'],
  spitter: ['At ease', 'Attention', 'Moving', 'Windup', 'Spitting', 'Recoil', 'Wounded', 'Retreating', 'Resting'],
  eggs: ['Incubating', 'Wounded'],
  bat: ['At ease', 'Attention', 'Flying', 'Windup', 'Darting', 'Tumbling', 'Gummed wings', 'Wounded', 'Retreating', 'Sleeping'],
  imp: [...COMMON, 'Flying'], wisp: [...COMMON, 'Drifting'], bomber: [...COMMON, 'Hopping', 'Fuse'],
  golem: [...COMMON, 'Punching'], mage: [...COMMON, 'Casting'], colossus: [...COMMON, 'Punching', 'Cooled'],
  leviathan: ['At ease', 'Attention', 'Swimming', 'Windup', 'Biting', 'Beached', 'Wounded', 'Cooled', 'Resting'],
};
const NAMES = { rootloper: 'Root Loper', stonemaw: 'Stone Maw', acidslime: 'Acid Slime', colossus: 'Kiln Colossus', leviathan: 'Sunken Leviathan' };
const output = `${SCREENSHOT_ROOT}/creatures`, scratch = 'verify-out/living-descent/gif-frames';
mkdirSync(output, { recursive: true }); mkdirSync(scratch, { recursive: true });
const requested = process.argv[3]?.split(',') ?? Object.keys(CATALOG);
for (const kind of requested) assert.ok(CATALOG[kind], `Unknown creature ${kind}`);
let manifest = [];
try { manifest = JSON.parse(readFileSync(`${output}/manifest.json`, 'utf8')); } catch { /* First generation. */ }
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:5182/');
  await waitForConsoleApi(page); await page.evaluate(() => window.__game.ctx.levels.ready);
  await execConsoleCommand(page, 'run test --level d1 --world campaign-level --seed 777 --loadout fresh');
  await waitForRunReady(page);
  for (const kind of requested) {
    const name = NAMES[kind] ?? kind[0].toUpperCase() + kind.slice(1), poses = CATALOG[kind];
    console.log(`Rendering ${name}: ${poses.length} poses`);
    const data = await page.evaluate(async ({ kind, name, poses }) => {
      const { World } = await import('/src/sim/World.ts');
      const { Cell } = await import('/src/sim/CellType.ts');
      const { drawCreatureSprite } = await import('/src/render/sprites/CreatureArt.ts');
      const { createDefaultStatus } = await import('/src/entities/status.ts');
      const { ensureCreatureMind } = await import('/src/creatures/perception.ts');
      const { tickCreaturePose } = await import('/src/creatures/pose.ts');
      const { tickWeaverLocomotion, weaverLeap } = await import('/src/entities/weaverLocomotion.ts');
      const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
      const pen = canvas.getContext('2d'), frames = [], signatures = [];
      const source = window.__game.ctx, world = new World(900, 180), floor = 120;
      const ctx = { ...source, world, state: { ...source.state }, player: { ...source.player, x: -500, y: -500 } };
      let offsetX = 0, offsetY = 0;
      const out = { pixelStep: .5, setFinePx(x, y, r, g, b) {
        pen.fillStyle = `rgb(${Math.min(255, r * 255)},${Math.min(255, g * 255)},${Math.min(255, b * 255)})`;
        pen.fillRect(Math.round((x + offsetX) * 2) * 2, Math.round((y + offsetY) * 2) * 2, 2, 2);
      }, setPx() {}, addPx() {} };
      for (const [poseIndex, pose] of poses.entries()) {
        world.clear();
        for (let x = 0; x < world.width; x++) world.replaceCellAt(world.idx(x, floor + 1), Cell.Stone, 0);
        if (kind === 'rillback' && pose !== 'Beached') {
          for (let y = floor - 40; y <= floor; y++) for (let x = 0; x < world.width; x++) world.replaceCellAt(world.idx(x, y), Cell.Water, 0);
        }
        const wall = pose === 'Wall crawling', ceiling = pose === 'Ceiling crawling';
        if (wall) for (let y = 0; y <= floor; y++) world.replaceCellAt(world.idx(174, y), Cell.Stone, 0);
        if (ceiling) for (let x = 0; x < world.width; x++) world.replaceCellAt(world.idx(x, 76), Cell.Stone, 0);
        const e = { kind, x: wall ? 163 : 160, y: ceiling ? 91 : wall ? 105 : floor, fx: 0, fy: 0, vx: 0, vy: 0, hp: 50, maxHp: 50,
          flash: 0, timer: 0, attackCd: 0, bobPhase: .4, grounded: true, stride: .7, splat: 0, prevG: true,
          blink: 0, jetFuel: 0, jetCd: 0, stuckT: 0, status: createDefaultStatus() };
        const mind = ensureCreatureMind(e, 777); mind.facing = 1;
        for (let tick = -36; tick < 90; tick++) {
          ctx.state.frameCount = tick + 400 + poseIndex * 180;
          if (pose === 'Blinking') {
            const period = 185 + mind.phase % 67;
            ctx.state.frameCount = Math.ceil(mind.phase / period) * period + period - mind.phase + Math.max(0, tick) % 20;
          }
          const t = Math.max(0, tick), wave = Math.sin(t * .07);
          const moving = ['Moving', 'Swimming', 'Flying', 'Drifting', 'Burrowing', 'Stalking', 'Retreating', 'Wall crawling', 'Ceiling crawling', 'Limping', 'Three legs lost'].includes(pose);
          if (kind === 'weaver') {
            e.weaverMissingLegs = pose === 'Three legs lost' ? 0b00110010 : ['Lost a leg', 'Limping'].includes(pose) ? 0b00000010 : 0;
            e.weaverRetreatT = e.weaverMissingLegs ? 90 : 0;
          }
          mind.intent = ['Resting', 'Sleeping'].includes(pose) ? 'rest' : pose === 'Retreating' ? 'retreat' : ['At ease', 'Incubating', 'Feeding'].includes(pose) ? 'forage' : 'hunt';
          mind.confidence = ['At ease', 'Incubating', 'Resting', 'Sleeping', 'Feeding'].includes(pose) ? 0 : .8;
          mind.targetX = e.x + 60; mind.targetY = e.y - 15 - Math.sin(t * .045) * 45; e.alerted = mind.confidence > 0;
          e.sleeping = pose === 'Sleeping'; e.fear = ['Wounded', 'Retreating', 'Footing panic'].includes(pose) ? .9 : 0;
          e.hp = pose === 'Wounded' ? 15 : 50;
          e.windup = ['Windup', 'Stalking'].includes(pose) ? 12 : 0;
          e.weaverFeedT = pose === 'Feeding' ? 18 : 0; e.rillFeedT = pose === 'Feeding' ? 80 : 0;
          e.blink = pose === 'Weaving' ? 18 : 0;
          e.rillChargeWindup = pose === 'Charging' ? 20 : 0;
          e.mawChewT = pose === 'Chewing' ? 18 : 0; e.mawStun = pose === 'Stunned' ? 18 : 0;
          e.rootPanic = pose === 'Footing panic' ? 20 : 0;
          e.rootLashT = pose === 'Lashing' ? 10 - Math.floor(t / 3) % 10 : 0;
          e.rootLashX = e.x + 48; e.rootLashY = e.y - 8;
          e.recoil = pose === 'Recoil' ? 10 - t % 10 : 0; e.punching = pose === 'Punching' ? 8 - Math.floor(t / 4) % 8 : 0;
          e.fusing = pose === 'Fuse' ? Math.max(1, 90 - t) : 0;
          e.status.wet = pose === 'Cooled' ? 60 : 0;
          e.tumble = pose === 'Tumbling' ? 20 : 0; e.slimed = pose === 'Gummed wings' ? 20 : 0;
          e.swoop = ['Attacking', 'Darting', 'Lunging', 'Biting', 'Spitting', 'Casting'].includes(pose) ? 12 : 0;
          e.rillWet = (kind === 'rillback' && pose !== 'Beached') || pose === 'Swimming' || pose === 'Charging' ? 1 : 0;
          if (kind !== 'weaver') {
            e.vx = moving ? .6 : e.swoop ? 2.4 : 0; e.x += e.vx;
            e.y = floor + (['Flying', 'Swimming', 'Drifting'].includes(pose) ? -15 + wave * 4 : pose === 'Hopping' ? -Math.max(0, Math.sin(t / 90 * Math.PI)) * 17 : pose === 'Beached' ? -Math.abs(Math.sin(t * .13)) * 3 : 0);
            e.grounded = e.y >= floor; e.vy = pose === 'Hopping' ? -Math.cos(t / 90 * Math.PI) * 1.8 : 0;
            if (pose === 'Landing') e.splat = Math.max(0, 8 - t % 30);
          } else {
            const tx = wall ? 174 : e.x + 80, ty = wall ? e.y - 65 : ceiling ? 76 : floor;
            if (pose === 'Pouncing' && tick === 0) weaverLeap(e, e.x + 55, floor - 6);
            tickWeaverLocomotion(ctx, e, source.enemyCtl.defs[kind], { move: moving ? 'toward' : 'hold', tx, ty, urgency: pose === 'Retreating' ? 1 : .4,
              stance: pose === 'Sleeping' ? 'sleep' : ['Windup', 'Feeding', 'Stalking'].includes(pose) ? 'crouch' : pose === 'Rearing' ? 'rear' : 'normal' });
          }
          tickCreaturePose(ctx, e);
          if (tick < 0 || tick % 3 !== 0) continue;
          pen.fillStyle = '#13272c'; pen.fillRect(0, 0, 640, 480);
          pen.fillStyle = '#dbe1cd'; pen.font = '24px system-ui'; pen.fillText(name, 22, 34);
          pen.font = '17px system-ui'; pen.fillStyle = '#b9c8bb'; pen.fillText(pose, 22, 61);
          pen.font = '12px system-ui'; pen.fillStyle = '#a7bbb4'; pen.fillText(`Pose fixture · 4× game size · ${poseIndex + 1} / ${poses.length}`, 22, 460);
          offsetX = 80 - e.x; offsetY = 60 - (kind === 'weaver' ? e.weaverLoco?.py ?? e.y : e.y);
          pen.fillStyle = '#254044';
          if (wall) pen.fillRect((174 + offsetX) * 4, 75, 3, 355);
          else if (ceiling) pen.fillRect(100, (76 + offsetY) * 4, 440, 3);
          else pen.fillRect(100, (floor + offsetY + 1) * 4, 440, 3);
          drawCreatureSprite(out, { sample: () => ({ r: 1, g: 1, b: 1 }) }, ctx, e);
          const png = canvas.toDataURL('image/png').split(',')[1]; frames.push(png);
          signatures.push(png.length);
        }
      }
      return { frames, uniqueFrameSizes: new Set(signatures).size };
    }, { kind, name, poses });
    assert.ok(data.uniqueFrameSizes > 12, `${kind} must have real animated frames`);
    const input = `${scratch}/${kind}.json`; writeFileSync(input, JSON.stringify(data));
    const result = spawnSync('python', ['scripts/encode-creature-gif.py', input, `${output}/${kind}.gif`], { encoding: 'utf8', windowsHide: true });
    if (result.status !== 0) throw new Error(`${kind} GIF encoding failed: ${result.stderr}`);
    const metadata = JSON.parse(readFileSync(`${output}/${kind}.json`, 'utf8'));
    manifest = manifest.filter(entry => entry.id !== kind);
    manifest.push({ id: kind, name, poses, gif: `creatures/${kind}.gif`, poster: `creatures/${kind}.png`, ...metadata, generatedAt: new Date().toISOString() });
    writeFileSync(`${output}/manifest.json`, JSON.stringify(manifest, null, 2)); refreshScreenshotGallery();
    console.log(`${name}: ${metadata.frames} frames, ${(metadata.bytes / 1048576).toFixed(2)} MB`);
  }
} finally { await browser.close(); }
