// Cell-type frames of the Sandbox flood, serial sweep vs the chunked
// (parallel-schedule, single-thread) sweep, same seed — no renderer, no
// timing. Writes verify-out/mtframes-<mode>-t<tick>.png (crop, 2x nearest).
// Usage: node scripts/diag-sandbox-mt-frames.mjs [ticks=20,40,60] [x0 y0 w h]
import { createServer } from 'vite';
import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const TICKS = (process.argv[2] ?? '20,40,60').split(',').map(Number);
const [CX0 = 480, CY0 = 540, CW = 640, CH = 360] = process.argv.slice(3).map(Number);
mkdirSync('verify-out', { recursive: true });

function png(width, height, rgb) {
  const crc = (buf) => {
    let c = ~0;
    for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
    return ~c >>> 0;
  };
  const chunk = (type, data) => {
    const out = Buffer.alloc(12 + data.length);
    out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8);
    out.writeUInt32BE(crc(Buffer.concat([Buffer.from(type, 'ascii'), data])), 8 + data.length);
    return out;
  };
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) { raw[y * (width * 3 + 1)] = 0; rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const server = await createServer({ logLevel: 'error', server: { hmr: false, middlewareMode: true } });
try {
  const simRandom = await server.ssrLoadModule('/src/core/simRandom.ts');
  const { Simulation } = await server.ssrLoadModule('/src/sim/Simulation.ts');
  const { ParallelSim } = await server.ssrLoadModule('/src/sim/parallel/ParallelSim.ts');
  const { createSharedWorld } = await server.ssrLoadModule('/src/sim/parallel/sharedWorld.ts');
  const fx = await server.ssrLoadModule('/tests/fixtures/largeSimScene.ts');
  for (const mode of ['serial', 'chunked']) {
    const world = createSharedWorld(1600, 1064);
    const writeCell = (x, y, type, color, life = 0) => {
      const i = world.idx(x, y);
      world.types[i] = type; world.colors[i] = color; world.life[i] = life; world.charge[i] = 0;
    };
    const cx = 800, floorY = 900, W = 640, H = 340;
    for (let x = cx - W / 2 - 1; x <= cx + W / 2 + 1; x++) for (let y = floorY - H - 1; y <= floorY + 1; y++) {
      const edge = x <= cx - W / 2 - 1 || x >= cx + W / 2 + 1 || y <= floorY - H - 1 || y >= floorY;
      writeCell(x, y, edge ? 13 : 0, 0);
    }
    const X0 = cx - W / 2, X1 = cx + W / 2 - 1, Y0 = floorY - H;
    for (let x = X0; x <= X1; x++) for (let y = Y0; y < Y0 + 90; y++) {
      const band = (((x - X0) / 40) | 0) % 3;
      writeCell(x, y, band === 0 ? 1 : band === 1 ? 2 : 6, 0);
    }
    for (let x = X0; x <= X1; x += 3) writeCell(x, Y0 + 91, 5, 0, 90);
    world.activity.invalidateAll();
    simRandom.reseedAllStreams(7);
    const ctx = fx.makeSimCtx(world, 7);
    ctx.state.mode = 'build';
    const sim = new Simulation();
    if (mode === 'chunked') sim.parallel = new ParallelSim(world, { global: ctx.params.global, materials: ctx.params.materials }, 0);
    const palette = { 0: [10, 10, 14], 1: [210, 180, 94], 2: [30, 140, 230], 5: [255, 200, 40], 6: [85, 64, 30], 9: [200, 200, 220], 13: [96, 104, 112], 14: [70, 70, 70], 31: [150, 200, 200], 32: [120, 120, 120] };
    for (let t = 1; t <= Math.max(...TICKS); t++) {
      ctx.state.frameCount++;
      simRandom.reseedTickStreams(7, ctx.state.frameCount);
      sim.processFrame(ctx);
      if (!TICKS.includes(t)) continue;
      const S = 2, rgb = Buffer.alloc(CW * S * CH * S * 3);
      for (let y = 0; y < CH * S; y++) for (let x = 0; x < CW * S; x++) {
        const tpe = world.types[world.idx(CX0 + ((x / S) | 0), CY0 + ((y / S) | 0))];
        const c = palette[tpe] ?? [255, 0, 255];
        const o = (y * CW * S + x) * 3;
        rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2];
      }
      writeFileSync(`verify-out/mtframes-${mode}-t${t}.png`, png(CW * S, CH * S, rgb));
    }
    console.log(mode, 'done');
  }
} finally {
  await server.close();
}
