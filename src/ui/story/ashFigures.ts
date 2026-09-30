/**
 * THE OLD ONES, SEATED (Sanctum body, polish 2026-09): three moss-grown Guild workers on the right
 * of Matron Ash's panel, drawn as a flat SVG in the Sanctum's greens. Presentation only: Ash (the
 * middle one) leans toward the apprentice while her line types on, the one on the left nods when a
 * boon is struck, and the one on the right lifts a hand as the return phial is poured.
 * Hidden where the panel has no room to spare (a narrow or short view); still under reduce-flashes.
 */

export const ASH_FIGURES_STYLE = `
.sanc-ash .sa-figures {
  position: absolute; right: 10px; bottom: 0; width: 150px; height: 58px; pointer-events: none; opacity: 0.9;
  -webkit-mask-image: linear-gradient(to left, #000 70%, transparent); mask-image: linear-gradient(to left, #000 70%, transparent);
}
.sanc-ash .sa-figures svg { width: 100%; height: 100%; overflow: visible; }
.sanc-ash .sa-line { max-width: min(62ch, calc(100% - 172px)); }
.sanc-ash .sa-fig { transform-box: fill-box; transform-origin: 50% 100%; }
.sanc-ash .sa-head { transform-box: fill-box; transform-origin: 50% 100%; }
.sanc-ash .sa-arm { transform-box: fill-box; transform-origin: 100% 100%; }
.sanc-ash .sa-body { fill: #2b4a39; }
.sanc-ash .sa-moss { fill: #4f7d5c; }
.sanc-ash .sa-dark { fill: #1d3429; }
.sanc-ash .sa-eye { fill: #dff3dd; }
.sanc-ash .sa-ash .sa-body { fill: #335643; }
.sanc-ash.talking .sa-ash { transform: rotate(-4deg) translateX(-3px); transition: transform 0.7s cubic-bezier(0.16, 1, 0.3, 1); }
.sanc-ash .sa-ash { transition: transform 1s ease; }
.sanc-ash.talking .sa-ash .sa-head { transform: rotate(-5deg) translateY(1px); transition: transform 0.7s ease; }
.sanc-ash .sa-ash .sa-head { transition: transform 1s ease; }
.sanc-ash .sa-nods .sa-head { animation: sa-nod 0.75s ease-in-out 1; }
.sanc-ash .sa-pours .sa-arm { animation: sa-lift 1.6s ease-in-out 1; }
.sanc-ash .sa-eye { animation: sa-blink 6.5s steps(1) infinite; }
.sanc-ash .sa-ash .sa-eye { animation-delay: -2.4s; }
@keyframes sa-nod { 0%, 100% { transform: none; } 35% { transform: translateY(3px) rotate(6deg); } 65% { transform: translateY(1px) rotate(2deg); } }
@keyframes sa-lift { 0%, 100% { transform: rotate(0); } 30%, 70% { transform: rotate(-58deg); } }
@keyframes sa-blink { 0%, 93%, 100% { opacity: 1; } 95% { opacity: 0.1; } }
body.reduce-flashes .sanc-ash .sa-figures *, body.reduce-flashes .sanc-ash .sa-eye { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) { .sanc-ash .sa-figures * { animation: none !important; } }
@media (max-width: 760px), (max-height: 560px) { .sanc-ash .sa-figures { display: none; } .sanc-ash .sa-line { max-width: 62ch; } }
`;

const SVG = `
<svg viewBox="0 0 150 58" aria-hidden="true" focusable="false">
  <g class="sa-fig sa-nods">
    <path class="sa-body" d="M8 58 C6 38 14 27 27 27 C40 27 48 38 46 58 Z"/>
    <path class="sa-moss" d="M13 34 q4 -6 9 -3 q-2 5 -9 3 Z M35 31 q5 -4 9 1 q-5 4 -9 -1 Z"/>
    <g class="sa-head"><circle class="sa-dark" cx="27" cy="21" r="8.5"/><path class="sa-body" d="M17 22 C17 10 37 10 37 22 C33 16 21 16 17 22 Z"/>
      <circle class="sa-eye" cx="24" cy="22" r="1.1"/><circle class="sa-eye" cx="30" cy="22" r="1.1"/></g>
  </g>
  <g class="sa-fig sa-ash">
    <path class="sa-body" d="M50 58 C47 30 59 14 76 14 C93 14 105 30 102 58 Z"/>
    <path class="sa-moss" d="M56 28 q6 -8 13 -4 q-3 7 -13 4 Z M83 22 q8 -6 14 2 q-7 6 -14 -2 Z M70 46 q6 -4 11 0 q-5 4 -11 0 Z"/>
    <g class="sa-head"><circle class="sa-dark" cx="76" cy="14" r="10.5"/><path class="sa-body" d="M64 15 C64 0 88 0 88 15 C83 8 69 8 64 15 Z"/>
      <circle class="sa-moss" cx="70" cy="5" r="2.6"/><circle class="sa-moss" cx="82" cy="4" r="2"/>
      <circle class="sa-eye" cx="72" cy="15" r="1.3"/><circle class="sa-eye" cx="80" cy="15" r="1.3"/></g>
  </g>
  <g class="sa-fig sa-pours">
    <path class="sa-body" d="M106 58 C104 38 112 28 125 28 C138 28 146 38 144 58 Z"/>
    <path class="sa-moss" d="M112 35 q4 -6 9 -3 q-2 5 -9 3 Z"/>
    <path class="sa-arm sa-body" d="M112 36 C108 42 106 46 107 52 L112 52 C112 47 114 43 118 40 Z"/>
    <g class="sa-head"><circle class="sa-dark" cx="125" cy="22" r="8"/><path class="sa-body" d="M116 23 C116 11 134 11 134 23 C130 17 120 17 116 23 Z"/>
      <circle class="sa-eye" cx="122" cy="23" r="1.1"/><circle class="sa-eye" cx="128" cy="23" r="1.1"/></g>
  </g>
</svg>`;

export interface AshFigures {
  readonly root: HTMLElement;
  /** Ash leans in while she speaks. */
  talk(on: boolean): void;
  /** The left-hand one nods (a boon was struck). */
  nod(): void;
  /** The right-hand one lifts a hand (the phial pours). */
  pour(): void;
}

function replay(el: Element | null, cls: string, ms: number): void {
  if (!el) return;
  el.classList.remove(cls);
  void (el as HTMLElement).getBoundingClientRect();
  el.classList.add(cls);
  window.setTimeout(() => el.classList.remove(cls), ms);
}

export function createAshFigures(panel: HTMLElement): AshFigures {
  const root = document.createElement('div');
  root.className = 'sa-figures';
  root.innerHTML = SVG;
  const nodder = root.querySelector('.sa-nods');
  const pourer = root.querySelector('.sa-pours');
  // The nods and the lifted hand are one-shot animations keyed by a class that is only present while they play.
  nodder?.classList.remove('sa-nods');
  pourer?.classList.remove('sa-pours');
  return {
    root,
    talk: (on) => panel.classList.toggle('talking', on),
    nod: () => replay(nodder ?? null, 'sa-nods', 800),
    pour: () => replay(pourer ?? null, 'sa-pours', 1700),
  };
}
