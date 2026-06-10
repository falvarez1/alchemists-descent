import '@/styles/main.css';
import { Game } from '@/game/Game';

const holder = document.getElementById('canvas-holder');
if (!holder) throw new Error('missing #canvas-holder');

const game = new Game(holder);
game.start();
