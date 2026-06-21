// Production-preview network probe for Builder lazy loading.
//
// Usage:
//   npm run build
//   npm run preview -- --host 127.0.0.1 --port 5301
//   node scripts/verify-builder-prod-network.mjs http://127.0.0.1:5301/
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { launchBrowser } from './browser-launch.mjs';

const url = process.argv[2] || 'http://127.0.0.1:4173/';
const manifestPath = join('dist', '.vite', 'manifest.json');
const normalize = (value) => String(value).replace(/\\/g, '/');
const builderOwnedSource = /(^|\/)src\/(?:builder\/|ui\/editor\/(?:DockHost|Fields|InspectorSchema|PanelChrome|PanelRegistry|Section|Workspace)\.ts$)/;

function loadBuilderFiles() {
  if (!existsSync(manifestPath)) return [];
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  const files = new Set();
  for (const [key, entry] of Object.entries(manifest)) {
    if (builderOwnedSource.test(normalize(key))) files.add(normalize(entry.file));
    const mapPath = join('dist', `${entry.file}.map`);
    if (!existsSync(mapPath)) continue;
    try {
      const map = JSON.parse(readFileSync(mapPath, 'utf8'));
      if ((map.sources ?? []).some((source) => builderOwnedSource.test(normalize(source)))) {
        files.add(normalize(entry.file));
      }
    } catch {
      // The bundle-boundary script is responsible for validating sourcemaps.
    }
  }
  return [...files];
}

const builderFiles = loadBuilderFiles();
const isBuilderRequest = (requestUrl) => {
  const path = new URL(requestUrl).pathname.replace(/\\/g, '/').replace(/^\/+/, '');
  if (path.includes('/src/builder/') || path.startsWith('src/builder/')) return true;
  if (path.includes('/src/ui/editor/') || path.startsWith('src/ui/editor/')) return true;
  if (/assets\/builder-[^/]+\.js$/i.test(path)) return true;
  return builderFiles.some((file) => path.endsWith(file));
};

const browser = await launchBrowser();
const pageErrors = [];
const consoleErrors = [];
let phase = 'boot';
const requests = { boot: [], builder: [] };

try {
  const page = await browser.newPage({ viewport: { width: 1500, height: 900 } });

  page.on('pageerror', (error) => pageErrors.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('request', (request) => {
    const requestUrl = request.url();
    if (!/\.(?:m?js|css)(?:\?|$)/i.test(new URL(requestUrl).pathname)) return;
    requests[phase].push(requestUrl);
  });

  await page.goto(url, { waitUntil: 'networkidle', timeout: 45000 });
  await page.waitForSelector('#mode-builder-btn', { timeout: 30000 });
  await page.waitForSelector('#canvas-holder > canvas', { timeout: 30000 });
  await page.waitForTimeout(500);

  const bootBuilderRequests = requests.boot.filter(isBuilderRequest);
  if (bootBuilderRequests.length > 0) {
    throw new Error(`Builder chunk was requested during player boot:\n${bootBuilderRequests.join('\n')}`);
  }

  phase = 'builder';
  await page.click('#mode-builder-btn');
  await page.waitForSelector('#builder-root .bp-swatch', { timeout: 30000 });
  await page.waitForTimeout(500);

  const builderRequests = requests.builder.filter(isBuilderRequest);
  if (builderRequests.length === 0) {
    throw new Error(
      `Opening Builder did not request an identifiable Builder chunk. ` +
        `Known builder manifest files: ${builderFiles.join(', ') || '(none)'}`,
    );
  }

  if (pageErrors.length > 0 || consoleErrors.length > 0) {
    throw new Error(`Browser errors during prod network probe: page=${pageErrors.join(' | ')} console=${consoleErrors.join(' | ')}`);
  }

  console.log(
    `Builder prod network passed: bootAssets=${requests.boot.length}, builderAssets=${requests.builder.length}, ` +
      `builderRequests=${builderRequests.map((requestUrl) => new URL(requestUrl).pathname).join(', ')}`,
  );
} finally {
  await browser.close().catch(() => undefined);
}
