import '@/styles/main.css';
import { Game } from '@/game/Game';
import { installAuthorLink, resolveAuthorLinkConfig } from '@/app/AuthorLink';
import { AuthorLinkIndicator } from '@/app/AuthorLinkIndicator';
import { initRapier } from '@/entities/rapierInit';
import { readAppMode } from '@/game/modePersist';
import { drawCounts, resetDrawCounts, restoreStreams, snapshotStreams } from '@/core/simRandom';

/** Dev-only handle onto the seeded streams (see `core/simRandom.ts`). */
const simRandomDebug = { drawCounts, resetDrawCounts, snapshotStreams, restoreStreams };

const bootOverlay = document.getElementById('boot-overlay');
const bootStatus = document.getElementById('boot-status');

// Two rAFs = one committed frame: the styled boot overlay gets painted
// before synchronous worldgen blocks the main thread.
requestAnimationFrame(() =>
  requestAnimationFrame(async () => {
    try {
      const holder = document.getElementById('canvas-holder');
      if (!holder) throw new Error('missing #canvas-holder');

      // The rigid-body engine (Rapier2D) is WASM — initialise it before the
      // Game constructor builds the physics world.
      if (bootStatus) bootStatus.textContent = 'LOADING PHYSICS…';
      await initRapier();

      const savedMode = import.meta.env.DEV ? readAppMode() : null;
      const game = new Game(holder);

      // AuthorLink before the Builder: the launcher hands the link to the
      // host, so the Builder can publish terrain from the moment it opens.
      const linkConfig = resolveAuthorLinkConfig(
        window.location.search,
        import.meta.env.DEV,
        window.location,
        import.meta.env.VITE_AUTHORLINK_URL,
        import.meta.env.VITE_AUTHORLINK_TOKEN,
        navigator.webdriver === true,
      );
      const authorLink = installAuthorLink(game.ctx, linkConfig);
      const linkIndicator = authorLink ? new AuthorLinkIndicator(linkConfig.room) : null;
      const linkDisposers: Array<() => void> = [];
      if (authorLink && linkIndicator) {
        linkIndicator.setPullHandler(() => void authorLink.pullWorldFrom());
        linkDisposers.push(authorLink.onStatus((status) => linkIndicator.update(status)));
        linkDisposers.push(authorLink.onWorldState((state) => linkIndicator.updateWorlds(state)));
      }

      // The Builder is loaded through a DYNAMIC import inside a compile-time
      // branch. A static import would keep the launcher — and the Builder chunk
      // it lazily pulls — in a play build even with the button hidden, and a
      // hidden button is not separation: the tester could still reach it.
      // `__AUTHORING__` is inlined as `false` there, so Rollup drops the whole
      // branch and never emits the chunk. See vite.config.ts.
      let builderLauncher: { open(): void; dispose(): void } | null = null;
      if (__AUTHORING__) {
        const { BuilderLauncher } = await import('@/app/BuilderLauncher');
        builderLauncher = new BuilderLauncher(game.ctx, authorLink);
      } else {
        // Same reasoning for the debug surface: console, runtime inspector and
        // the GPU/WGSL A-B toggles are authoring tools, not player features.
        // Removing the nodes is enough — every owner looks them up optionally.
        for (const el of document.querySelectorAll('[data-authoring]')) el.remove();
      }
      game.start();
      if (import.meta.env.DEV && savedMode === 'builder') builderLauncher?.open();

      if (import.meta.env.DEV) {
        // Debug handle for the console and headless verification scripts.
        const debugWindow = window as unknown as {
          __game?: Game;
          __authorLink?: typeof authorLink;
          __simRandom?: typeof simRandomDebug;
        };
        debugWindow.__game = game;
        debugWindow.__authorLink = authorLink;
        // Stream positions and draw counters, for the determinism probe and for
        // diagnosing a divergence by hand (which stream drifted, and when).
        debugWindow.__simRandom = simRandomDebug;
        import.meta.hot?.dispose(() => {
          for (const dispose of linkDisposers.splice(0).reverse()) dispose();
          linkIndicator?.dispose();
          authorLink?.dispose();
          builderLauncher?.dispose();
          game.dispose();
          if (debugWindow.__game === game) delete debugWindow.__game;
          delete debugWindow.__authorLink;
          delete debugWindow.__simRandom;
        });
      }

      bootOverlay?.classList.add('done');
      setTimeout(() => bootOverlay?.remove(), 600);
    } catch (err) {
      // A hung loader is worse than no loader: put the failure on screen.
      if (bootStatus) {
        bootStatus.textContent = 'BOOT FAILED — ' + String(err);
        bootStatus.classList.add('error');
      }
      throw err;
    }
  }),
);
