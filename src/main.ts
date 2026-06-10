import '@/styles/main.css';
import { Game } from '@/game/Game';

const holder = document.getElementById('canvas-holder');
if (!holder) throw new Error('missing #canvas-holder');

const game = new Game(holder);
game.start();

if (import.meta.env.DEV) {
  // Debug handle for the console and headless verification scripts.
  (window as unknown as { __game: Game }).__game = game;
}
