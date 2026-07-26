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

export default defineConfig({
  plugins: [authorLinkPlugin()],
  define: {
    __BUILD_STAMP__: JSON.stringify(buildStamp()),
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
      // share every chunk, so the second entry costs a few KB of HTML.
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        builder: fileURLToPath(new URL('./builder.html', import.meta.url)),
      },
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
  },
});
