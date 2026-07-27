import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
// @ts-expect-error -- plain-JS dev plugin; it must also run standalone under node
import { authorLinkPlugin } from './scripts/vite-plugin-authorlink.mjs';

// Build stamp baked into the bundle (see __BUILD_STAMP__ in src/vite-env.d.ts):
// playtest feedback is only actionable when it names the exact build it came
// from. Commit hash + UTC time; falls back cleanly when git is unavailable.
function buildStamp(): string {
  let hash = 'nogit';
  try {
    hash = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
  } catch {
    // shallow CI checkout without git or tarball build — the timestamp still identifies it
  }
  return `${hash} ${new Date().toISOString().slice(0, 16)}Z`;
}

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

export default defineConfig(({ mode }) => ({
  plugins: [authorLinkPlugin()],
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp()),
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
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/]three[\\/]/.test(id)) return 'vendor-three';
          if (/[\\/]node_modules[\\/]@dimforge[\\/]rapier2d-compat[\\/]/.test(id)) return 'vendor-rapier';
          return 'vendor';
        },
      },
    },
  },
  server: {
    open: false,
    watch: {
      ignored: ['**/verify-out/**', '**/dist/**', '**/coverage/**'],
    },
  },
  test: {
    testTimeout: 60_000,
    // Gameplay randomness is seeded module state (core/simRandom.ts); the setup
    // file resets it between tests so a forced roll cannot leak forward.
    setupFiles: ['./tests/setup.ts'],
  },
}));
