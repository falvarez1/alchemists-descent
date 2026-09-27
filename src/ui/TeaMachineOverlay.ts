import type { Ctx } from '@/core/types';
import type { EventMap } from '@/core/events';
import { getBindings, keyLabel } from '@/input/bindings';

type View = EventMap['contraptionView'];

/**
 * The engine's caption card. The alchemist keeps every control while the
 * chain runs, so this is a quiet card, not a cutscene: the act's name and
 * what is happening, and — when a station is waiting on the player — the
 * verb that fixes it with its real binding, plus the slow backup's progress
 * so waiting is always a choice.
 */
export class TeaMachineOverlay {
  private readonly root = document.createElement('section');
  private readonly title = document.createElement('strong');
  private readonly detail = document.createElement('p');
  private readonly fault = document.createElement('div');
  private readonly disposeView: () => void;

  constructor(ctx: Ctx) {
    this.root.id = 'tea-view'; this.root.hidden = true;
    this.root.setAttribute('aria-live', 'polite');
    const card = document.createElement('div'); card.className = 'tea-caption';
    this.fault.className = 'tea-fault'; this.fault.hidden = true;
    card.append(this.title, this.detail, this.fault);
    this.root.append(card);
    document.getElementById('canvas-holder')!.append(this.root);
    this.disposeView = ctx.events.on('contraptionView', view => this.render(view));
  }

  private verbKey(verb: NonNullable<View['fault']>['verb']): string {
    const bindings = getBindings();
    if (verb === 'spark') return 'Left click';
    return keyLabel(verb === 'kick' ? bindings.kick : bindings.pour);
  }

  private render(view: View): void {
    this.root.hidden = !view.visible;
    this.title.textContent = view.title;
    const use = `Press ${keyLabel(getBindings().interact)}`;
    this.detail.textContent = view.stalled ? `${use} at the crank to recharge the engine.`
      : view.stage === 0 ? `${use} at the crank. The engine makes the bell that opens the descent.` : view.detail;
    this.root.classList.toggle('waiting', !!view.fault);
    if (!view.fault) { this.fault.hidden = true; return; }
    const f = view.fault;
    this.fault.hidden = false;
    this.fault.replaceChildren();
    const ask = document.createElement('p'); ask.className = 'tea-ask';
    const key = document.createElement('kbd'); key.className = 'key'; key.textContent = this.verbKey(f.verb);
    const verb = f.verb === 'spark' ? ' Wand — ' : f.verb === 'kick' ? ' Kick — ' : ' Water flask — ';
    ask.append(key, verb, f.prompt);
    const meter = document.createElement('div'); meter.className = 'tea-backup';
    const label = document.createElement('span'); label.textContent = `${f.backupLabel}`;
    const bar = document.createElement('span'); bar.className = 'tea-backup-bar';
    const fill = document.createElement('span'); fill.style.width = `${Math.round(f.backup * 100)}%`;
    bar.append(fill); meter.append(label, bar);
    this.fault.append(ask, meter);
  }

  dispose(): void { this.disposeView(); this.root.remove(); }
}
