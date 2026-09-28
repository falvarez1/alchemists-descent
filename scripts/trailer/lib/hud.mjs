// Clean-frame CSS: every piece of HUD/dev chrome is hidden by default; a shot
// opts back in to the in-world DOM that sells the game (`show: [...]`).

/** Always hidden: HUD, menus, dev panels, prompts, toasts. */
const CHROME = [
  '#game-hud', '#minimap-corner', '#minimap-overlay', '#toast-stack', '#interaction-hint', '#controls-hint',
  '#damage-vignette', '#god-tools', '#expedition-tools', '#field-note', '#expedition-pause', '#objective',
  '#objective-note', '#phial-row', '#vitals-aside', '#waypoint-indicator', '#waystone-prompt-overlay',
  '#trickshot-readout', '#clip-card', '#perf-fps', '#perf-hud', '#authorlink-status', '#card-offer-overlay',
  '#cell-inspector', '#runtime-inspector', '#dev-console', '#dev-console-watch', '#pause-overlay',
  '#help-overlay', '#death-letterbox', '#gameover-overlay', '#sanctum-overlay', '#grimoire-overlay',
  '#wand-bench', '#sound-toggle', '#sound-quick', '#sound-caption', '#immersive-play-btn',
  '#dev-console-toggle', '#runtime-inspector-toggle', '#gpu-compose-toggle', '#webgpu-compose-toggle',
  '#perf-hud-toggle', '#mode-build-btn', '#mode-play-btn', '#boot-overlay', '#hint-teach-overlay',
  '#story-dialogue', '#story-prompt', '#story-cinema', '#level-curtain', '#expedition-entry',
  '#run-summary', '#link-indicator', '.authorlink-indicator', '.link-indicator',
];

/** Opt-in groups: in-world DOM a shot may keep (hidden otherwise). */
export const OPT_IN = {
  callouts: ['#callout-layer'], // alchemy-kill words, BOWLED!, boss name cards
  letterbox: ['.story-letterbox'], // boss prologue bars
  banner: ['#wave-banner'], // "FLOOR 1 OF 4 / THE BELLOWS" entry title card
  captions: ['#narration-caption'], // the Docent's subtitles
  tea: ['#tea-view'], // the Tea Engine stage plate
};

export function hudCss(show = []) {
  const hidden = [...CHROME];
  for (const [group, selectors] of Object.entries(OPT_IN)) if (!show.includes(group)) hidden.push(...selectors);
  return `${hidden.join(',\n')} { display: none !important; }
html, body { cursor: none !important; background: #000 !important; }
#canvas-holder, #canvas-holder canvas { cursor: none !important; }
#canvas-holder { border: 0 !important; border-radius: 0 !important; box-shadow: none !important; }`;
}
