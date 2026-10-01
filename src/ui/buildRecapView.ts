import '@/styles/builds.css';
import type { Ctx } from '@/core/types';
import { recapRows } from '@/combat/wands/buildRecap';

/**
 * The build as a small readable block: each wand's frame, its slots, and what a click casts — the bench's
 * own sentences (combat/wands/buildRecap). The Sanctum shows it above its shop so the player reads what
 * they are about to spend gold on; the ledger and the pause menu say the same thing in their own markup.
 */
export function renderBuildRecap(ctx: Ctx, title = 'Your wands'): HTMLElement {
  const box = document.createElement('div');
  box.className = 'build-recap';
  box.setAttribute('aria-label', 'Your build');
  const heading = document.createElement('div');
  heading.className = 'build-recap-title';
  heading.textContent = title;
  box.appendChild(heading);
  for (const row of recapRows(ctx.wands.wands)) {
    const line = document.createElement('div');
    line.className = 'build-recap-row';
    const numeral = document.createElement('span');
    numeral.className = 'wb-numeral';
    numeral.textContent = row.numeral;
    const text = document.createElement('span');
    const frame = document.createElement('b');
    frame.textContent = row.frameName;
    const slots = document.createElement('span');
    slots.className = 'frame';
    slots.textContent = ` · ${row.capacity} slots · `;
    text.append(frame, slots, document.createTextNode(row.sentence));
    line.append(numeral, text);
    box.appendChild(line);
  }
  return box;
}
