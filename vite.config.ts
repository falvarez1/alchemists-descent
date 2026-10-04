import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { duelPlugin } from './servers/duel/plugin.ts';
// @ts-expect-error -- plain-JS dev plugin; it must also run standalone under node
import { authorLinkPlugin } from './scripts/vite-plugin-authorlink.mjs';

// Build stamp baked into the bundle (see __BUILD_STAMP__ in src/vite-env.d.ts):
// playtest feedback is only actionable when it names the exact build it came
// from. Commit hash + UTC time; falls back cleanly when git is unavailable.
function gitRevision(): string {
  let hash = 'nogit';
  try {
    hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // shallow CI checkout without git or tarball build — the timestamp still identifies it
  }
  return hash;
}

const PACKAGE_VERSION = (JSON.parse(readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf8')) as { version: string }).version;
const BUILD_REVISION = gitRevision();
const buildStamp = (): string => `${BUILD_REVISION} ${new Date().toISOString().slice(0, 16)}Z`;
const appVersion = (): string => `${PACKAGE_VERSION}+${BUILD_REVISION}`;

/**
 * Authoring surface = the Builder route plus the debug toggles (console,
 * runtime inspector, GPU/WGSL A-B). Present in dev, ABSENT from a production
 * build unless explicitly asked for.
 *
 * Fail-safe on purpose: a playtester must not be able to reach the level editor
 * from a link someone sent them, and hiding the button is not enough — the
 * `builder.html` route and the Builder chunk have to not be in the deployment
 * at all. So shipping the editor is the thing that takes an explicit flag, not
 * withholding it. `npm run build:authoring` when you do want it.
 */
const authoringEnabled = (mode: string): boolean =>
  mode !== 'production' || process.env.VITE_INCLUDE_BUILDER === '1';

/** Entry points for this build: the player route always, the Builder route only
 *  when authoring is enabled. */
function buildInputs(mode: string): Record<string, string> {
  const input: Record<string, string> = {
    index: fileURLToPath(new URL('./index.html', import.meta.url)),
  };
  if (authoringEnabled(mode)) {
    input.builder = fileURLToPath(new URL('./builder.html', import.meta.url));
  }
  return input;
}

/**
 * THE WORLD LAYER CHUNK. The boot code splits in two along the one boundary
 * that has no way back: the foundation modules (config, core, sim, content)
 * plus the world generator and its authoring stamps import nothing from the
 * game, UI or render layers — so the `world` chunk never imports the entry
 * chunk, and no circular chunk (with its evaluation-order hazards) can form.
 * tests/bundle-layers.test.ts keeps that boundary closed. Both load at boot in
 * parallel; this is for chunk size and caching, not deferral.
 *
 * Modules only the lazy chunks use stay out of it (else this rule would drag
 * them into the boot download): the story and voice scripts, the score, the
 * virtual world prototype, and the authoring-only registries.
 */
export const WORLD_LAYER = /^(config|core|sim|content|world|authoring)\/|^game\/instantiate\.ts$|^combat\/wands\/cards\.ts$/;
export const WORLD_LAYER_EXCLUDED =
  /^world\/virtual\/|^content\/story\/|^content\/audio\/((narration|score)\.generated|scoreManifest)\.ts$|^content\/audio\/sfxManifest\.ts$|^content\/registry\.ts$|^config\/tuningRanges\.ts$/;

function worldLayerChunk(id: string): string | undefined {
  const match = /[\\/]src[\\/](.+\.(?:ts|json))$/.exec(id);
  if (!match) return undefined;
  const path = match[1].replace(/\\/g, '/');
  // The authoring-only virtual world prototype (game/lazyVirtualWorld), by name.
  if (/^world\/virtual\//.test(path)) return 'virtual-world';
  return WORLD_LAYER.test(path) && !WORLD_LAYER_EXCLUDED.test(path) ? 'world' : undefined;
}

const ISOLATION_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'credentialless',
};

export default defineConfig(({ mode }) => ({
  plugins: [authorLinkPlugin(), duelPlugin()],
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp()),
    __APP_VERSION__: JSON.stringify(appVersion()),
    __AUTHORING__: JSON.stringify(authoringEnabled(mode)),
  },
  // GitHub Pages serves a project site under /<repo>/, so the deploy build needs
  // that base for assets to resolve. The CI workflow sets GH_PAGES=true; local
  // dev and `npm run build` stay at '/'.
  base: process.env.GH_PAGES ? '/alchemists-descent/' : '/',
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  build: {
    target: 'es2022',
    manifest: true,
    sourcemap: true,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
      // Two routes: the player entry and the standalone Builder window. They
      // share every chunk, so the second entry costs a few KB of HTML — but a
      // play build omits the Builder route entirely, so /builder.html 404s
      // rather than merely being unadvertised.
      input: buildInputs(mode),
      output: {
        manualChunks(id) {
          if (!id.includes('node_modules')) return worldLayerChunk(id);
          // The WebGPU build of three (and its TSL) only loads with the WebGPU
          // backend (render/webGpuBackendModule): keep it out of the boot download.
          if (/[\\/]node_modules[\\/]three[\\/]build[\\/]three\.(webgpu|tsl)\.js$/.test(id)) return 'vendor-three-webgpu';
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'vendor-three';
          // Rapier's SIMD and scalar builds are separate lazy chunks: initRapier
          // imports only the one this browser can run.
          if (/[\\/]node_modules[\\/]@dimforge[\\/]rapier2d-simd-compat[\\/]/.test(id)) return 'vendor-rapier-simd';
          if (/[\\/]node_modules[\\/]@dimforge[\\/]rapier2d-compat[\\/]/.test(id)) return 'vendor-rapier';
          return 'vendor';
        },
      },
    },
  },
  // gifenc is only reached from the clips worker, so the dev server found it
  // late and re-optimized mid-session — reloading a page a probe (or a
  // playtester) had already started a run in. Pre-bundle it up front.
  optimizeDeps: { include: ['gifenc', '@dimforge/rapier2d-compat', '@dimforge/rapier2d-simd-compat'] },
  // Cross-origin isolation, so the Sandbox can put its world on
  // SharedArrayBuffers for the parallel sweep (docs/SANDBOX-MT.md).
  // `credentialless` keeps no-cors third-party loads working without CORP.
  preview: { headers: ISOLATION_HEADERS },
  server: {
    headers: ISOLATION_HEADERS,
    open: false,
    watch: {
      // Gallery writes are evidence, and must not reload a running playtest.
      ignored: ['**/verify-out/**', '**/screenshots/**', '**/dist/**', '**/coverage/**'],
    },
  },
  test: {
    testTimeout: 60_000,
    // Gameplay randomness is seeded module state (core/simRandom.ts); the setup
    // file resets it between tests so a forced roll cannot leak forward.
    setupFiles: ['./tests/setup.ts'],
  },
}));
