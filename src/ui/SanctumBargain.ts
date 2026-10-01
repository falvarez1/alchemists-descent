import type { Ctx } from '@/core/types';
import { MUTATOR_DEFS, bargainOffer, isMutatorId, mutatorLoadText, type MutatorId } from '@/content/mutators';

/**
 * THE SANCTUM'S BARGAIN (content/mutators `bargainOffer`): one slim row under the boons. The old ones
 * offer a complication that HARDENS the descent for the rest of it, and a second boon in return (take
 * two of the three). The offer is a pure function of the run's seed and the floor, so a reload cannot
 * reroll it; one bargain per floor; never on the daily (it is one descent for everyone).
 *
 * The row only offers and records: striking it is `ctx.run.strikeBargain`, and the second pick is the
 * Sanctum's own (it is told through `onStruck`). The Sanctum edit is kept tiny by living here.
 */
export class SanctumBargain {
  readonly root = document.createElement('div');
  private readonly name = document.createElement('div');
  private readonly body = document.createElement('p');
  private readonly deal = document.createElement('p');
  private readonly accept = document.createElement('button');
  private readonly status = document.createElement('p');

  constructor() {
    this.root.className = 'sanc-bargain';
    this.root.hidden = true;
    this.name.className = 'bargain-name';
    this.body.className = 'bargain-body';
    this.deal.className = 'bargain-deal';
    this.status.className = 'bargain-status';
    this.status.setAttribute('aria-live', 'polite');
    this.accept.type = 'button';
    this.accept.className = 'bargain-accept';
    const text = document.createElement('div');
    text.className = 'bargain-text';
    text.append(this.name, this.body, this.deal, this.status);
    this.root.append(text, this.accept);
  }

  dispose(): void {
    this.root.remove();
  }

  /** Is the row showing (the Sanctum scrolls it into view with the boons)? */
  get visible(): boolean {
    return !this.root.hidden;
  }

  /**
   * Lay the row out for this visit. `canTakeTwo` is whether the boon table has two to take. `onStruck`
   * is called once, after the run has taken the bargain.
   */
  show(ctx: Ctx, floor: number, canTakeTwo: boolean, onStruck: () => void): void {
    this.root.hidden = true;
    this.root.classList.remove('struck');
    this.status.textContent = '';
    const run = ctx.run;
    if (!run?.active || run.daily || !canTakeTwo || floor < 1) return;
    const already = run.bargains.find((b) => b.floor === floor);
    const id = (already && isMutatorId(already.id) ? already.id : bargainOffer(run.mutators, ctx.levels.runStatus(ctx).worldSeed, floor)) as MutatorId | null;
    if (!id) return;
    const def = MUTATOR_DEFS[id];
    this.name.replaceChildren(
      Object.assign(document.createElement('span'), { className: 'bargain-kicker', textContent: 'Strike a bargain' }),
      Object.assign(document.createElement('b'), { textContent: def.name }),
      Object.assign(document.createElement('span'), { className: 'bargain-weight', textContent: mutatorLoadText([id]) }),
    );
    this.body.textContent = def.regulation;
    this.deal.textContent = 'In return: a second boon. Take two of the three, and keep this regulation for the rest of the descent.';
    this.root.hidden = false;
    this.accept.disabled = false;
    this.accept.textContent = `Accept ${def.name}`;
    this.accept.onclick = () => {
      if (!ctx.run?.strikeBargain(ctx, id, floor)) {
        this.status.textContent = 'The old ones decline: it is not on the table after all.';
        return;
      }
      ctx.audio.learn();
      this.lock(def.name, true);
      onStruck();
    };
    if (already) this.lock(def.name, false);
  }

  /** The bargain is struck: the row says so, and the button goes quiet. */
  private lock(name: string, fresh: boolean): void {
    this.root.classList.add('struck');
    this.accept.disabled = true;
    this.accept.textContent = 'Struck';
    this.status.textContent = fresh
      ? `Struck. ${name} is in force for the rest of the descent. Take a second boon.`
      : `Struck on this floor: ${name} is in force for the rest of the descent.`;
  }
}
