// Phase 2 backend-boundary probe. Verifies synthetic WebGPU fallback selection,
// WebGPU device-loss lifecycle recovery, and live-game render flag plumbing.
// Usage: node scripts/probe-render-backend-selection.mjs [baseUrl]
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright-core';
import { createServer } from 'vite';

import {
  collectBackendCapabilities,
  currentCommandLine,
  currentGitCommit,
  currentGitState,
  newBenchmarkPage,
  writeJson,
} from './perf-harness.mjs';

const outDir = 'verify-out/render-backend-selection';
const timestamp = Date.now();
const providedBaseUrl = process.argv[2] ?? null;

async function startViteServer() {
  const server = await createServer({
    logLevel: 'error',
    server: {
      host: '127.0.0.1',
      port: 5195,
      strictPort: false,
    },
  });
  await server.listen();
  const address = server.httpServer?.address();
  const port = typeof address === 'object' && address ? address.port : 5195;
  return { server, baseUrl: `http://127.0.0.1:${port}/` };
}

function normalizeBaseUrl(baseUrl) {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
}

function isIgnorableConsoleError(text) {
  return text.includes('[vite] failed to connect to websocket');
}

async function runBrowserProbe(browser, baseUrl) {
  const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'render-backend-host' });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isIgnorableConsoleError(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(new URL('scripts/probe-render-backend-host.html', baseUrl).toString(), {
    waitUntil: 'networkidle',
    timeout: 30000,
  });
  await page.waitForFunction(() => window.__renderBackendPhase2Probe?.status, null, {
    timeout: 30000,
  });
  const probe = await page.evaluate(() => window.__renderBackendPhase2Probe);
  await page.context().close();
  return { probe, consoleErrors, pageErrors };
}

async function runLiveGameProbe(browser, baseUrl) {
  const page = await newBenchmarkPage(browser, { diagnosticsLabel: 'render-backend-game' });
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    const text = message.text();
    if (message.type() === 'error' && !isIgnorableConsoleError(text)) consoleErrors.push(text);
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));
  await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForFunction(() => window.__game?.ctx?.console, null, { timeout: 30000 });

  const capabilitiesBefore = await collectBackendCapabilities(page, 'phase2-initial');
  const result = await page.evaluate(async () => {
    const game = window.__game;
    const ctx = game.ctx;
    const initialCtx = ctx;
    const initialWorld = ctx.world;
    const holder = document.getElementById('canvas-holder');
    const directCanvases = () =>
      Array.from(holder?.children ?? []).filter((child) => child instanceof HTMLCanvasElement);
    const initialCanvas = directCanvases()[0] ?? null;
    const run = async (line) => ({ line, ...(await ctx.console.exec(line)) });
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve()));
    const statusAfterFrame = async () => {
      await nextFrame();
      await nextFrame();
      return game.getRenderBackendStatus();
    };

    const initialStatus = game.getRenderBackendStatus();
    const commands = [];
    commands.push(await run('set render.backend auto'));
    commands.push(await run('set render.compose true'));
    commands.push(await run('set render.lighting true'));
    commands.push(await run('set render.particles true'));
    commands.push(await run('set render.post true'));
    const autoStatus = await statusAfterFrame();
    commands.push(await run('set render.backend webgpu'));
    const requestedWebGpuStatus = await statusAfterFrame();
    commands.push(await run('set render.backend webgl'));
    commands.push(await run('set render.compose false'));
    commands.push(await run('set render.lighting false'));
    commands.push(await run('set render.particles false'));
    commands.push(await run('set render.post false'));
    const restoredStatus = await statusAfterFrame();

    const mouseBefore = { ...ctx.input.mouse };
    initialCanvas?.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientX: Math.max(1, initialCanvas.getBoundingClientRect().left + 10),
      clientY: Math.max(1, initialCanvas.getBoundingClientRect().top + 10),
    }));
    const mouseAfter = { ...ctx.input.mouse };
    const finalCanvases = directCanvases();
    const finalCanvas = finalCanvases[0] ?? null;
    return {
      commands,
      initialStatus,
      autoStatus,
      requestedWebGpuStatus,
      restoredStatus,
      identities: {
        ctxSame: game.ctx === initialCtx,
        worldSame: game.ctx.world === initialWorld,
        canvasSame: initialCanvas === finalCanvas,
        holderConnected: holder?.isConnected === true,
        holderCanvasCount: finalCanvases.length,
        mouseFinite:
          Number.isFinite(mouseBefore.x) &&
          Number.isFinite(mouseBefore.y) &&
          Number.isFinite(mouseAfter.x) &&
          Number.isFinite(mouseAfter.y),
      },
    };
  });
  const capabilitiesAfter = await collectBackendCapabilities(page, 'phase2-restored');
  await page.context().close();
  return { result, capabilitiesBefore, capabilitiesAfter, consoleErrors, pageErrors };
}

let viteServer = null;
let browser = null;
let payload = null;

try {
  const serverInfo = providedBaseUrl
    ? { server: null, baseUrl: normalizeBaseUrl(providedBaseUrl) }
    : await startViteServer();
  viteServer = serverInfo.server;
  const baseUrl = normalizeBaseUrl(serverInfo.baseUrl);
  mkdirSync(outDir, { recursive: true });
  browser = await chromium.launch({ channel: 'msedge', headless: true });

  const browserProbe = await runBrowserProbe(browser, baseUrl);
  const liveGame = await runLiveGameProbe(browser, baseUrl);
  const live = liveGame.result;
  const backendSetCommands = live.commands.filter((command) => command.line.startsWith('set render.backend '));
  const unexpectedBackendSetResults = backendSetCommands.filter((command) => command.data?.code !== 'startup-only-param');
  const commandFailures = live.commands.filter(
    (command) => command.ok !== true && command.data?.code !== 'startup-only-param',
  );
  const liveFailures = [];
  if (live.initialStatus.actual !== 'webgl2') liveFailures.push('initial actual backend is not webgl2');
  if (live.initialStatus.requested !== 'webgl') liveFailures.push('initial requested backend is not webgl');
  if (live.autoStatus.requested !== 'webgl' || live.autoStatus.actual !== 'webgl2') {
    liveFailures.push('startup-only auto request changed live backend state');
  }
  if (live.requestedWebGpuStatus.requested !== 'webgl' || live.requestedWebGpuStatus.actual !== 'webgl2') {
    liveFailures.push('startup-only WebGPU request changed live backend state');
  }
  if (live.restoredStatus.requested !== 'webgl' || live.restoredStatus.actual !== 'webgl2') {
    liveFailures.push('restored WebGL flag did not report WebGL2');
  }
  if (!live.identities.ctxSame) liveFailures.push('Ctx identity changed');
  if (!live.identities.worldSame) liveFailures.push('World identity changed');
  if (!live.identities.canvasSame) liveFailures.push('renderer canvas changed');
  if (!live.identities.holderConnected || live.identities.holderCanvasCount !== 1) {
    liveFailures.push('canvas-holder layout changed');
  }
  if (!live.identities.mouseFinite) liveFailures.push('input mouse state became invalid');
  if (backendSetCommands.length !== 3 || unexpectedBackendSetResults.length > 0) {
    liveFailures.push('render backend console command was not startup-only');
  }
  if (commandFailures.length > 0) liveFailures.push('render flag console command failed');

  payload = {
    status:
      browserProbe.probe.status === 'passed' &&
      liveFailures.length === 0 &&
      browserProbe.consoleErrors.length === 0 &&
      browserProbe.pageErrors.length === 0 &&
      liveGame.consoleErrors.length === 0 &&
      liveGame.pageErrors.length === 0
        ? 'passed'
        : 'failed',
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    baseUrl,
    browserProbe,
    liveGame,
    liveFailures,
    phase2Files: [
      'src/core/types.ts',
      'src/config/params.ts',
      'src/game/Game.ts',
      'src/game/console/commands.ts',
      'src/game/console/prefs.ts',
      'src/render/Renderer.ts',
      'src/render/pixels.ts',
      'src/render/backendSelection.ts',
      'src/render/WebGpuDeviceLifecycle.ts',
      'scripts/probe-render-backend-selection.mjs',
      'scripts/probe-render-backend-browser.js',
      'scripts/probe-render-backend-host.html',
    ],
  };

  const jsonPath = join(outDir, `probe-${timestamp}.json`);
  writeJson(jsonPath, payload);
  payload.artifacts = { json: jsonPath };
  console.log(JSON.stringify(payload, null, 2));
  if (payload.status !== 'passed') throw new Error('Render backend Phase 2 probe failed');
} catch (error) {
  const failedPath = join(outDir, `probe-${timestamp}-failed.json`);
  writeJson(failedPath, {
    status: 'failed',
    commit: currentGitCommit(),
    git: currentGitState(),
    command: currentCommandLine(),
    generatedAt: new Date().toISOString(),
    payload,
    error: {
      message: error?.message ?? String(error),
      stack: error?.stack ?? null,
    },
  });
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  if (viteServer) await viteServer.close();
}
