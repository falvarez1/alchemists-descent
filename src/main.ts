import '@/styles/main.css';
import { Game } from '@/game/Game';
import { BuilderLauncher } from '@/app/BuilderLauncher';
import { installAuthorLink, resolveAuthorLinkConfig } from '@/app/AuthorLink';
import { AuthorLinkIndicator } from '@/app/AuthorLinkIndicator';
import { initRapier } from '@/entities/rapierInit';
import { readAppMode } from '@/game/modePersist';

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

      const builderLauncher = new BuilderLauncher(game.ctx, authorLink);
      game.start();
      if (import.meta.env.DEV && savedMode === 'builder') builderLauncher.open();

      if (import.meta.env.DEV) {
        // Debug handle for the console and headless verification scripts.
        const debugWindow = window as unknown as { __game?: Game; __authorLink?: typeof authorLink };
        debugWindow.__game = game;
        debugWindow.__authorLink = authorLink;
        import.meta.hot?.dispose(() => {
          for (const dispose of linkDisposers.splice(0).reverse()) dispose();
          linkIndicator?.dispose();
          authorLink?.dispose();
          builderLauncher.dispose();
          game.dispose();
          if (debugWindow.__game === game) delete debugWindow.__game;
          delete debugWindow.__authorLink;
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
