import '@/styles/main.css';
import { Game } from '@/game/Game';
import { BuilderLauncher } from '@/app/BuilderLauncher';
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
      const builderLauncher = new BuilderLauncher(game.ctx);
      game.start();
      if (import.meta.env.DEV && savedMode === 'builder') builderLauncher.open();

      if (import.meta.env.DEV) {
        // Debug handle for the console and headless verification scripts.
        const debugWindow = window as unknown as { __game?: Game };
        debugWindow.__game = game;
        import.meta.hot?.dispose(() => {
          builderLauncher.dispose();
          game.dispose();
          if (debugWindow.__game === game) delete debugWindow.__game;
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
