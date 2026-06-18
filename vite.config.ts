import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
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
    sourcemap: true,
    chunkSizeWarningLimit: 1800,
    rollupOptions: {
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
