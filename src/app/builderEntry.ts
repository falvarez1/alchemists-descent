import '@/styles/main.css';
import { Game } from '@/game/Game';
import { BuilderLauncher } from '@/app/BuilderLauncher';
import { installAuthorLink, resolveAuthorLinkConfig } from '@/app/AuthorLink';
import { AuthorLinkIndicator } from '@/app/AuthorLinkIndicator';
import { initRapier } from '@/entities/rapierInit';

/**
 * Standalone Builder route (`/builder.html`).
 *
 * This is the editor window of the two-window workflow: it boots straight into
 * the Builder with AuthorLink live, so the other window can stay on `/` playing
 * the game. Same `Game`, same `Ctx`, same Builder — only the entry differs.
 *
 * WHAT THIS DOES AND DOES NOT SAVE. It drops the Sandbox tool palette (~10 KB
 * of markup and its wiring) and removes the click needed to get into the
 * editor. It does NOT yet skip Rapier or the gameplay update systems: those
 * are built by the one composition root in `Game`, and forking that into a
 * second, authoring-only root is exactly the "two fake games" outcome the
 * Builder decoupling plan rules out. Narrowing it is a later slice, gated on
 * `Game` growing an explicit authoring profile rather than on this file.
 */

const bootOverlay = document.getElementById('boot-overlay');
const bootStatus = document.getElementById('boot-status');

requestAnimationFrame(() =>
  requestAnimationFrame(async () => {
    try {
      const holder = document.getElementById('canvas-holder');
      if (!holder) throw new Error('missing #canvas-holder');

      if (bootStatus) bootStatus.textContent = 'LOADING PHYSICS…';
      await initRapier();

      const game = new Game(holder);

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
      // The whole point of the route: no click to get into the editor.
      builderLauncher.open();

      if (bootStatus) bootStatus.textContent = 'OPENING THE BUILDER…';

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

      bootOverlay?.classList.add('done');
      setTimeout(() => bootOverlay?.remove(), 600);
    } catch (err) {
      if (bootStatus) {
        bootStatus.textContent = 'BOOT FAILED — ' + String(err);
        bootStatus.classList.add('error');
      }
      throw err;
    }
  }),
);
