import '@/styles/main.css';
import { Game } from '@/game/Game';

const bootOverlay = document.getElementById('boot-overlay');
const bootStatus = document.getElementById('boot-status');

// Two rAFs = one committed frame: the styled boot overlay gets painted
// before synchronous worldgen blocks the main thread.
requestAnimationFrame(() =>
  requestAnimationFrame(() => {
    try {
      const holder = document.getElementById('canvas-holder');
      if (!holder) throw new Error('missing #canvas-holder');

      const game = new Game(holder);
      game.start();

      if (import.meta.env.DEV) {
        // Debug handle for the console and headless verification scripts.
        (window as unknown as { __game: Game }).__game = game;
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
