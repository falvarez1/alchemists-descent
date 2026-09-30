import type { Ctx } from '@/core/types';
import type { StoryDialogueView } from '@/core/story';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { getBindings, keyLabel } from '@/input/bindings';

/** Styles live with the elements they dress (the shared stylesheets stay untouched). */
const STYLE = `
#story-dialogue {
  position: absolute; bottom: 15%; left: 50%; width: min(560px, 88%); transform: translate(-50%, 10px);
  box-sizing: border-box; padding: 20px 22px 16px; z-index: 45; opacity: 0; pointer-events: none;
  background: linear-gradient(180deg, #13252bf2, #0c171bf5); border: 1px solid #d5b98270;
  box-shadow: 0 1px 0 #f2e3b61a inset, 0 18px 46px #000000a6, 0 0 0 1px #050b0d;
  transition: opacity 0.28s ease, transform 0.42s cubic-bezier(0.16, 1, 0.3, 1);
  font-family: var(--house-serif, Georgia, serif); color: var(--house-paper, #e6dfca);
}
#story-dialogue.open { opacity: 1; transform: translate(-50%, 0); pointer-events: auto; }
#story-dialogue::before, #story-dialogue::after {
  content: ''; position: absolute; width: 9px; height: 9px; border-color: #d5b982; border-style: solid; opacity: 0.8;
}
#story-dialogue::before { left: -1px; top: -1px; border-width: 2px 0 0 2px; }
#story-dialogue::after { right: -1px; bottom: -1px; border-width: 0 2px 2px 0; }
#story-dialogue .sd-name {
  position: absolute; left: 16px; top: -12px; padding: 4px 11px 3px; background: #1d3036; border: 1px solid #d5b98299;
  font: 650 calc(10.5px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif); letter-spacing: 0.2em;
  text-transform: uppercase; color: var(--house-brass-strong, #f2e3b6); box-shadow: 0 3px 10px #0008;
}
#story-dialogue .sd-text {
  min-height: 2.9em; margin: 0; font: 500 calc(18.5px * var(--text-scale, 1))/1.45 var(--house-serif, Georgia, serif);
  letter-spacing: 0.005em; text-shadow: 0 1px 2px #050b0d;
}
#story-dialogue .sd-text .sd-rest { opacity: 0; }
#story-dialogue .sd-next {
  position: absolute; right: 14px; bottom: 9px; font: 600 calc(10px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif);
  letter-spacing: 0.12em; color: #d5b982b0; opacity: 0; transition: opacity 0.3s ease;
}
#story-dialogue.done .sd-next { opacity: 1; animation: sd-bob 1.6s ease-in-out infinite; }
@keyframes sd-bob { 50% { transform: translateY(-2px); } }
#story-dialogue .sd-close {
  position: absolute; right: 6px; top: 4px; width: 22px; height: 22px; padding: 0; border: 0; background: none; cursor: pointer;
  color: #d5b98280; font: 400 16px/1 var(--house-sans, system-ui, sans-serif);
}
#story-dialogue .sd-close:hover { color: #f2e3b6; }
#story-dialogue .sd-choices { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
#story-dialogue .sd-choices:empty, #story-dialogue .sd-choices[hidden] { display: none; }
#story-dialogue .sd-choice {
  display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 7px 12px; text-align: left; cursor: pointer;
  background: #0a1418d9; border: 1px solid #d5b98233; color: var(--house-paper, #e6dfca);
  font: 500 calc(16px * var(--text-scale, 1))/1.3 var(--house-serif, Georgia, serif);
  opacity: 0; transform: translateY(4px); animation: sd-in 0.34s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  transition: border-color 0.15s ease, background 0.15s ease;
}
#story-dialogue .sd-choice:nth-child(2) { animation-delay: 0.06s; }
#story-dialogue .sd-choice:nth-child(3) { animation-delay: 0.12s; }
#story-dialogue .sd-choice:hover, #story-dialogue .sd-choice:focus-visible { border-color: #d5b982b0; background: #183036e6; outline: none; }
#story-dialogue .sd-choice b {
  font: 650 calc(10.5px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif); color: #d5b982; letter-spacing: 0.1em;
}
#story-dialogue .sd-choice .sd-hint {
  margin-left: auto; padding-left: 12px; white-space: nowrap;
  font: 600 calc(9.5px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif); letter-spacing: 0.14em;
  text-transform: uppercase; color: #d5b982a6;
}
@keyframes sd-in { to { opacity: 1; transform: none; } }
#story-prompt {
  position: absolute; z-index: 44; padding: 5px 10px 4px; pointer-events: none; opacity: 0; transform: translate(-50%, -100%) translateY(4px);
  background: #0c171be6; border: 1px solid #d5b98266; white-space: nowrap;
  font: 600 calc(11px * var(--text-scale, 1))/1 var(--house-sans, system-ui, sans-serif); letter-spacing: 0.08em; color: #efe7d2;
  transition: opacity 0.22s ease, transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}
#story-prompt.show { opacity: 1; transform: translate(-50%, -100%); }
#story-prompt b { color: #f2e3b6; margin-right: 6px; }
body.reduce-flashes #story-dialogue, body.reduce-flashes #story-prompt { transition: opacity 0.15s linear; }
.story-letterbox { position: absolute; left: 0; right: 0; height: 8.5%; background: #020304; z-index: 43; pointer-events: none;
  transition: transform 0.55s cubic-bezier(0.16, 1, 0.3, 1); }
.story-letterbox.top { top: 0; transform: translateY(-100%); }
.story-fade { position: absolute; inset: 0; background: #020304; z-index: 46; pointer-events: none; opacity: 0; transition: opacity 0.5s ease; }
.story-fade.on { opacity: 1; transition: opacity 0.32s ease-in; }
.story-letterbox.bottom { bottom: 0; transform: translateY(100%); }
.story-letterbox.on { transform: none; }
`;

/**
 * The story's DIALOGUE BOX (wave 3 WS-S), house style: brass on slate, a name
 * plate, text that types on in step with the voice, up to three choices. It
 * never pauses the run. E (or a click on the box) skips the typing / goes on;
 * 1–3 or a click picks a choice; Esc or the × ends it (so does walking away).
 * It also shows the world-anchored interact prompt ("E · Talk to Pell").
 */
export class DialogueBox {
  private readonly style = document.createElement('style');
  private readonly root = document.createElement('section');
  private readonly name = document.createElement('span');
  private readonly text = document.createElement('p');
  private readonly choices = document.createElement('div');
  private readonly prompt = document.createElement('div');
  private readonly barTop = document.createElement('div');
  /** The story's fade to black (storyFade: the escape's quick restart). */
  private readonly fade = document.createElement('div');
  private readonly barBottom = document.createElement('div');
  private readonly off: Array<() => void> = [];
  private view: StoryDialogueView | null = null;
  private typedAt = 0;
  private raf: number | null = null;
  private lastPrompt = '';

  constructor(private readonly ctx: Ctx) {
    this.style.textContent = STYLE;
    document.head.appendChild(this.style);
    this.root.id = 'story-dialogue';
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-live', 'polite');
    this.name.className = 'sd-name';
    this.text.className = 'sd-text';
    this.choices.className = 'sd-choices';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'sd-close';
    close.setAttribute('aria-label', 'End the conversation');
    close.textContent = '×';
    close.addEventListener('click', (e) => { e.stopPropagation(); ctx.story?.dialogueClose(); });
    const next = document.createElement('span');
    next.className = 'sd-next';
    next.textContent = `${keyLabel(getBindings().interact)} ▸`;
    this.root.append(this.name, this.text, this.choices, next, close);
    this.root.addEventListener('mousedown', (e) => e.stopPropagation());
    this.root.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).closest('.sd-choice, .sd-close')) return;
      ctx.story?.dialogueAdvance();
    });
    this.prompt.id = 'story-prompt';
    const holder = document.getElementById('canvas-holder') ?? document.body;
    holder.append(this.root, this.prompt, this.barTop, this.barBottom);
    this.barTop.className = 'story-letterbox top';
    this.barBottom.className = 'story-letterbox bottom';
    // A boss prologue draws the letterbox in: a beat with weight.
    this.off.push(ctx.events.on('storyLetterbox', ({ on }) => {
      this.barTop.classList.toggle('on', on);
      this.barBottom.classList.toggle('on', on);
    }));
    // The escape's quick restart after a fall: a fade to black and back, no death screen.
    this.fade.className = 'story-fade';
    this.fade.setAttribute('aria-hidden', 'true');
    holder.append(this.fade);
    this.off.push(ctx.events.on('storyFade', ({ on }) => this.fade.classList.toggle('on', on)));
    this.off.push(ctx.events.on('levelChanged', () => this.fade.classList.remove('on')));
    this.off.push(ctx.events.on('storyDialogue', (v) => this.show(v)));
    this.off.push(ctx.events.on('levelChanged', () => this.show(null)));
    window.addEventListener('keydown', this.onKey, true);
    this.off.push(() => window.removeEventListener('keydown', this.onKey, true));
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly onKey = (e: KeyboardEvent): void => {
    const v = this.view;
    if (!v?.open || this.ctx.state.mode !== 'play') return;
    if (e.code === 'Escape') {
      e.preventDefault(); e.stopImmediatePropagation();
      this.ctx.story?.dialogueClose();
      return;
    }
    // Number keys belong to the box while it is open: a choice's number picks it, and
    // any other number is swallowed (QA: "Flask 3: empty" x5 behind a two-choice box).
    // While a line is still being said (no choices yet) a number hurries it along, as E does.
    const n = /^(?:Digit|Numpad)([0-9])$/.exec(e.code);
    if (n) {
      e.preventDefault(); e.stopImmediatePropagation();
      if (e.repeat) return;
      const i = Number(n[1]) - 1;
      if (v.choices.length === 0) this.ctx.story?.dialogueAdvance();
      else if (i >= 0 && i < v.choices.length) this.ctx.story?.dialogueChoose(i);
    }
  };

  private show(v: StoryDialogueView | null): void {
    const was = this.view;
    this.view = v?.open ? v : null;
    if (!this.view) {
      this.root.classList.remove('open', 'done');
      return;
    }
    const view = this.view;
    this.name.textContent = view.name;
    if (!was || was.text !== view.text) {
      this.typedAt = performance.now();
      this.root.classList.remove('done');
      this.renderText(0);
    }
    // Skipped typing: the whole line at once.
    if (view.instant) this.typedAt = -1e9;
    this.choices.replaceChildren(...view.choices.map((label, i) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'sd-choice';
      const k = document.createElement('b');
      k.textContent = String(i + 1);
      b.append(k, document.createTextNode(label));
      // What it gives, in a word (the label stays in the apprentice's voice).
      const hint = view.hints?.[i];
      if (hint) {
        const h = document.createElement('i');
        h.className = 'sd-hint';
        h.textContent = hint;
        b.append(h);
      }
      b.addEventListener('click', (e) => { e.stopPropagation(); this.ctx.story?.dialogueChoose(i); });
      return b;
    }));
    this.root.classList.add('open');
    // Lean toward the speaker: the box's centre follows them across the screen, gently.
    const holder = this.root.parentElement;
    if (holder) {
      const sx = (((view.x - this.ctx.camera.renderX) / VIEW_W - 0.5) * (this.ctx.camera.zoom || 1) + 0.5) * holder.clientWidth;
      const half = Math.min(280, holder.clientWidth * 0.44);
      const cx = Math.max(half + 12, Math.min(holder.clientWidth - half - 12, holder.clientWidth / 2 + (sx - holder.clientWidth / 2) * 0.45));
      this.root.style.left = `${cx}px`;
    }
  }

  /** Type the line on: the revealed part is text, the rest keeps its space (no reflow as it types). */
  private renderText(chars: number): void {
    const t = this.view?.text ?? '';
    const shown = document.createElement('span');
    shown.textContent = t.slice(0, chars);
    const rest = document.createElement('span');
    rest.className = 'sd-rest';
    rest.textContent = t.slice(chars);
    this.text.replaceChildren(shown, rest);
  }

  private readonly frame = (): void => {
    this.raf = requestAnimationFrame(this.frame);
    const v = this.view;
    if (v) {
      const rate = Math.max(26, Math.min(80, v.text.length / Math.max(0.5, v.seconds * 0.92)));
      const chars = Math.min(v.text.length, Math.floor(((performance.now() - this.typedAt) / 1000) * rate));
      const current = this.text.firstChild?.textContent?.length ?? 0;
      if (chars !== current) this.renderText(chars);
      const typed = chars >= v.text.length;
      this.root.classList.toggle('done', typed && v.choices.length === 0);
      // Choices wait for the line before them to be read.
      this.choices.hidden = !typed;
    }
    this.updatePrompt();
  };

  private updatePrompt(): void {
    const ctx = this.ctx;
    const p = ctx.state.mode === 'play' && !this.view && !ctx.state.paused ? ctx.story?.view.prompt ?? null : null;
    const holder = this.prompt.parentElement;
    if (!p || !holder) {
      if (this.lastPrompt) { this.prompt.classList.remove('show'); this.lastPrompt = ''; }
      return;
    }
    const controller = Array.from(navigator.getGamepads?.() ?? []).some(pad => pad?.connected);
    const label = `${controller ? 'X' : keyLabel(getBindings().interact)}|${p.verb}`;
    if (label !== this.lastPrompt) {
      const [key, verb] = label.split('|');
      const b = document.createElement('b');
      b.textContent = key;
      this.prompt.replaceChildren(b, document.createTextNode(verb));
      this.lastPrompt = label;
    }
    const z = ctx.camera.zoom || 1;
    const x = (((p.x - ctx.camera.renderX) / VIEW_W - 0.5) * z + 0.5) * holder.clientWidth;
    const y = (((p.y - ctx.camera.renderY) / VIEW_H - 0.5) * z + 0.5) * holder.clientHeight;
    this.prompt.style.left = `${Math.max(60, Math.min(holder.clientWidth - 60, x))}px`;
    this.prompt.style.top = `${Math.max(90, Math.min(holder.clientHeight - 60, y))}px`;
    this.prompt.classList.add('show');
  }

  dispose(): void {
    for (const d of this.off.splice(0)) d();
    if (this.raf !== null) cancelAnimationFrame(this.raf);
    this.root.remove();
    this.prompt.remove();
    this.barTop.remove();
    this.barBottom.remove();
    this.style.remove();
  }
}
