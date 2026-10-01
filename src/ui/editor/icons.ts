/**
 * The editor chrome's icon set: 16x16 line icons drawn with `currentColor`, so
 * a button's text colour (idle / hover / active / disabled) recolours its icon
 * with no extra CSS. They replace the letter glyphs the palette used before
 * ("V", "B", "\\", "▭") that nobody could read without hovering.
 *
 * Why inline SVG and not an icon font or sprite sheet: the Builder chunk is
 * loaded lazily and must work on /builder.html, which ships no asset pipeline
 * of its own, and a string is the cheapest thing to template into the
 * `buildDom()` markup. Every icon is a handful of primitives; none needs
 * more than ~120 bytes.
 *
 * Art direction: 1.5px stroke, round caps and joins, optical 2px padding.
 * Filled variants use `fill="currentColor"` with no stroke so a "filled
 * rectangle" reads as different from the outline one at 14px.
 */

const PATHS = {
  // ---- terrain / selection tools ----
  select: '<path d="M3.5 2.5 12 7l-4.2 1.3L6.4 12.7z" stroke-linejoin="round"/>',
  paint: '<path d="M10.2 2.6 13.4 5.8 7.4 11.8 4.2 11.8 4.2 8.6z" stroke-linejoin="round"/><path d="M3 13.6c1.4 0 2-.5 2-1.4"/>',
  line: '<path d="M3 13 13 3"/><circle cx="3" cy="13" r="1.1" fill="currentColor" stroke="none"/><circle cx="13" cy="3" r="1.1" fill="currentColor" stroke="none"/>',
  rect: '<rect x="2.75" y="3.75" width="10.5" height="8.5" rx="1"/>',
  rectFill: '<rect x="2.5" y="3.5" width="11" height="9" rx="1.2" fill="currentColor" stroke="none"/>',
  ellipse: '<ellipse cx="8" cy="8" rx="5.5" ry="4.2"/>',
  ellipseFill: '<ellipse cx="8" cy="8" rx="5.75" ry="4.5" fill="currentColor" stroke="none"/>',
  fill: '<path d="M3.2 8.6 8 3.8l4.6 4.6L8.4 12.6a1.4 1.4 0 0 1-2 0z" stroke-linejoin="round"/><path d="M13.4 10.6c0 .9-.6 1.5-.6 1.5s-.6-.6-.6-1.5a.6.6 0 0 1 1.2 0z" fill="currentColor"/><path d="M3.6 8.8h8.6" />',
  replace: '<path d="M3 5.5h8.5M9.5 3.3l2.2 2.2-2.2 2.2M13 10.5H4.5M6.5 8.3l-2.2 2.2 2.2 2.2"/>',
  smooth: '<path d="M2 9c1.5-4 3-4 4.5-1s3 3 4.5-1 2.2-2.4 3-1.8"/>',
  roughen: '<path d="M2 9l1.6-3 1.6 4 1.6-5 1.6 6 1.6-4 1.6 3 1.4-2.5"/>',
  region: '<rect x="2.75" y="3.75" width="10.5" height="8.5" rx=".6" stroke-dasharray="2.2 1.8"/>',
  polyRegion: '<path d="M8 2.8 13 6.4 11.1 12.6H4.9L3 6.4z" stroke-dasharray="2.2 1.8" stroke-linejoin="round"/>',
  regionMagic: '<path d="M3 13 9.4 6.6"/><path d="M11 2.4v2.4M9.8 3.6h2.4M13.2 6.2v1.8M12.3 7.1h1.8M6.6 2.6v1.6M5.8 3.4h1.6" />',
  lassoRegion: '<path d="M8 3.2c3.2 0 5.2 1.3 5.2 3s-2.3 3-5.2 3-5.2-1.3-5.2-3S4.8 3.2 8 3.2z" stroke-dasharray="2.4 1.8"/><path d="M6 9.1c-.7 1.4-.4 2.6.6 3.3s1.8.8 2.3.2"/>',
  stamp: '<rect x="3" y="9.5" width="10" height="3" rx=".8"/><path d="M6 9.5V7.2c0-1 .9-1.3.9-2.3a1.1 1.1 0 1 1 2.2 0c0 1 .9 1.3.9 2.3v2.3"/>',
  // ---- placement / authoring ----
  link: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7l-.9.9"/><path d="M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7l.9-.9"/>',
  unlink: '<path d="M6.8 9.2a2.6 2.6 0 0 0 3.7 0l2-2a2.6 2.6 0 0 0-3.7-3.7M9.2 6.8a2.6 2.6 0 0 0-3.7 0l-2 2a2.6 2.6 0 0 0 3.7 3.7"/><path d="M2.4 2.4l11.2 11.2"/>',
  light: '<path d="M8 2.3a3.9 3.9 0 0 0-2.2 7.1c.4.3.6.7.6 1.1v.6h3.2v-.6c0-.4.2-.8.6-1.1A3.9 3.9 0 0 0 8 2.3z" stroke-linejoin="round"/><path d="M6.6 13.6h2.8"/>',
  layers: '<path d="M8 2.6 13.6 5.6 8 8.6 2.4 5.6z" stroke-linejoin="round"/><path d="M2.4 8.4 8 11.4l5.6-3M2.4 11 8 14l5.6-3" stroke-linejoin="round"/>',
  cube: '<path d="M8 2 13.4 5v6L8 14 2.6 11V5z" stroke-linejoin="round"/><path d="M2.8 5.1 8 8l5.2-2.9M8 8v5.8" />',
  image: '<rect x="2.5" y="3" width="11" height="10" rx="1.2"/><circle cx="6" cy="6.4" r="1.1"/><path d="m3 12 3.3-3 2.4 2 1.6-1.4L13 12"/>',
  // ---- transport / session ----
  play: '<path d="M4.8 3.2v9.6L12.6 8z" fill="currentColor" stroke-linejoin="round"/>',
  playHere: '<path d="M3.4 3v10"/><path d="M6.8 3.4v9.2L13.4 8z" fill="currentColor" stroke-linejoin="round"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" stroke="none"/>',
  pause: '<rect x="4.2" y="3.4" width="2.6" height="9.2" rx=".8" fill="currentColor" stroke="none"/><rect x="9.2" y="3.4" width="2.6" height="9.2" rx=".8" fill="currentColor" stroke="none"/>',
  step: '<path d="M4 3.4v9.2L10 8z" fill="currentColor" stroke-linejoin="round"/><path d="M12.2 3.6v8.8"/>',
  restart: '<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 2.8v2.6h-2.6" stroke-linejoin="round"/>',
  simulate: '<circle cx="8" cy="8" r="5.4"/><path d="M6.6 5.6v4.8L10.6 8z" fill="currentColor" stroke-linejoin="round"/>',
  // ---- state / affordances ----
  eye: '<path d="M1.8 8S4 3.8 8 3.8 14.2 8 14.2 8 12 12.2 8 12.2 1.8 8 1.8 8z" stroke-linejoin="round"/><circle cx="8" cy="8" r="1.8"/>',
  eyeOff: '<path d="M2.4 5.2C1.9 6 1.8 8 1.8 8S4 12.2 8 12.2c1 0 1.9-.3 2.7-.7M6.4 3.9c.5-.1 1-.1 1.6-.1 4 0 6.2 4.2 6.2 4.2s-.5.9-1.4 1.8"/><path d="M2.6 2.6 13.4 13.4"/>',
  lock: '<rect x="3.5" y="7.2" width="9" height="6.2" rx="1.2"/><path d="M5.4 7.2V5.4a2.6 2.6 0 0 1 5.2 0v1.8"/>',
  unlock: '<rect x="3.5" y="7.2" width="9" height="6.2" rx="1.2"/><path d="M5.4 7.2V5.4a2.6 2.6 0 0 1 4.9-1.2"/>',
  chevronDown: '<path d="m4 6 4 4 4-4" stroke-linejoin="round"/>',
  chevronRight: '<path d="m6 4 4 4-4 4" stroke-linejoin="round"/>',
  close: '<path d="m4 4 8 8M12 4l-8 8"/>',
  plus: '<path d="M8 3.2v9.6M3.2 8h9.6"/>',
  minus: '<path d="M3.2 8h9.6"/>',
  check: '<path d="m3.4 8.4 3 3 6.2-6.6" stroke-linejoin="round"/>',
  search: '<circle cx="7" cy="7" r="4.2"/><path d="m10.2 10.2 3.4 3.4"/>',
  warning: '<path d="M8 2.6 14 13H2z" stroke-linejoin="round"/><path d="M8 6.6v3.2"/><circle cx="8" cy="11.4" r=".7" fill="currentColor" stroke="none"/>',
  error: '<circle cx="8" cy="8" r="5.6"/><path d="M8 5v3.4"/><circle cx="8" cy="10.9" r=".7" fill="currentColor" stroke="none"/>',
  info: '<circle cx="8" cy="8" r="5.6"/><path d="M8 7.2v3.6"/><circle cx="8" cy="5.2" r=".7" fill="currentColor" stroke="none"/>',
  // ---- document / window ----
  undo: '<path d="M3.4 6.4h6.2a3.4 3.4 0 0 1 0 6.8H6"/><path d="m6 3.8-2.6 2.6L6 9" stroke-linejoin="round"/>',
  redo: '<path d="M12.6 6.4H6.4a3.4 3.4 0 0 0 0 6.8H10"/><path d="m10 3.8 2.6 2.6L10 9" stroke-linejoin="round"/>',
  save: '<path d="M3 3.6A.6.6 0 0 1 3.6 3H11l2 2v7.4a.6.6 0 0 1-.6.6H3.6a.6.6 0 0 1-.6-.6z" stroke-linejoin="round"/><path d="M5.4 3v3h4.4V3M5.4 13V9.4h5.2V13"/>',
  folder: '<path d="M2.4 4.6a.8.8 0 0 1 .8-.8h3l1.4 1.6h5a.8.8 0 0 1 .8.8v5.6a.8.8 0 0 1-.8.8H3.2a.8.8 0 0 1-.8-.8z" stroke-linejoin="round"/>',
  file: '<path d="M4 2.6h5l3 3v7.8H4z" stroke-linejoin="round"/><path d="M9 2.6v3h3"/>',
  external: '<path d="M9 3h4v4M13 3 7.6 8.4"/><path d="M11.4 9.4v2.8a.8.8 0 0 1-.8.8H3.8a.8.8 0 0 1-.8-.8V5.4a.8.8 0 0 1 .8-.8h2.8"/>',
  plug: '<path d="M6 2.6v3M10 2.6v3"/><path d="M4.4 5.6h7.2v2.2A3.6 3.6 0 0 1 8 11.4 3.6 3.6 0 0 1 4.4 7.8z" stroke-linejoin="round"/><path d="M8 11.4v2.4"/>',
  grid: '<rect x="2.6" y="2.6" width="10.8" height="10.8" rx="1"/><path d="M6.2 2.6v10.8M9.8 2.6v10.8M2.6 6.2h10.8M2.6 9.8h10.8"/>',
  magnet: '<path d="M3.4 7.6V3.4h3v4.2a1.6 1.6 0 0 0 3.2 0V3.4h3v4.2a4.6 4.6 0 0 1-9.2 0z" stroke-linejoin="round"/><path d="M3.4 5.4h3M9.6 5.4h3"/>',
  symmetry: '<path d="M8 2.4v11.2" stroke-dasharray="1.8 1.6"/><path d="M6 4.6 2.6 8 6 11.4zM10 4.6 13.4 8 10 11.4z" stroke-linejoin="round"/>',
  layout: '<rect x="2.6" y="2.8" width="10.8" height="10.4" rx="1.2"/><path d="M6.2 2.8v10.4M6.2 8.2h7.2"/>',
  settings: '<circle cx="8" cy="8" r="2"/><path d="M8 2.4v1.6M8 12v1.6M2.4 8H4M12 8h1.6M4 4l1.1 1.1M10.9 10.9 12 12M12 4l-1.1 1.1M5.1 10.9 4 12"/>',
  terminal: '<rect x="2.4" y="3.2" width="11.2" height="9.6" rx="1.2"/><path d="m5.2 6.4 2 1.6-2 1.6M8.8 10h2.4"/>',
  bug: '<path d="M6 4.6V4a2 2 0 1 1 4 0v.6M4.6 7.4H2.6M13.4 7.4h-2M4.8 11.4 3.2 12.8M11.2 11.4l1.6 1.4M4.8 4.6 3.6 3.4M11.2 4.6l1.2-1.2"/><path d="M4.6 6.6a3.4 3.4 0 0 1 6.8 0v2.6a3.4 3.4 0 0 1-6.8 0z" stroke-linejoin="round"/>',
  game: '<rect x="2.4" y="4.4" width="11.2" height="7.2" rx="2.4"/><path d="M5.4 6.6v2.8M4 8h2.8"/><circle cx="10.2" cy="7.2" r=".7" fill="currentColor" stroke="none"/><circle cx="11.8" cy="8.8" r=".7" fill="currentColor" stroke="none"/>',
  sandbox: '<path d="M2.4 12.6h11.2" /><path d="M3.6 12.6c.6-2.6 2.2-3.4 4.4-7 2.2 3.6 3.8 4.4 4.4 7" stroke-linejoin="round"/><circle cx="11.6" cy="3.8" r=".6" fill="currentColor" stroke="none"/>',
  tools: '<path d="M9.8 3.6a3 3 0 0 0-3.6 3.8L2.8 10.8a1.4 1.4 0 0 0 2 2l3.4-3.4a3 3 0 0 0 3.8-3.6L10.4 7.6 8.4 5.6z" stroke-linejoin="round"/>',
  more: '<circle cx="3.6" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="8" cy="8" r="1" fill="currentColor" stroke="none"/><circle cx="12.4" cy="8" r="1" fill="currentColor" stroke="none"/>',
  drag: '<circle cx="6" cy="4.4" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="4.4" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="8" r=".9" fill="currentColor" stroke="none"/><circle cx="6" cy="11.6" r=".9" fill="currentColor" stroke="none"/><circle cx="10" cy="11.6" r=".9" fill="currentColor" stroke="none"/>',
  map: '<path d="M2.6 4.2 6 3l4 1.6 3.4-1.2v8.4L10 13 6 11.4l-3.4 1.2z" stroke-linejoin="round"/><path d="M6 3v8.4M10 4.6V13"/>',
  target: '<circle cx="8" cy="8" r="5.2"/><circle cx="8" cy="8" r="1.6" fill="currentColor" stroke="none"/><path d="M8 1.6v2M8 12.4v2M1.6 8h2M12.4 8h2"/>',
  broadcast: '<circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/><path d="M5.2 5.2a4 4 0 0 0 0 5.6M10.8 5.2a4 4 0 0 1 0 5.6M3.4 3.4a6.6 6.6 0 0 0 0 9.2M12.6 3.4a6.6 6.6 0 0 1 0 9.2"/>',
  // ---- Sandbox chrome ----
  volume: '<path d="M2.8 6.4h2.2L8.2 3.6v8.8L5 9.6H2.8z" stroke-linejoin="round"/><path d="M10.6 6a3 3 0 0 1 0 4M12.2 4.2a5.6 5.6 0 0 1 0 7.6"/>',
  volumeOff: '<path d="M2.8 6.4h2.2L8.2 3.6v8.8L5 9.6H2.8z" stroke-linejoin="round"/><path d="m10.6 6.2 3 3.6M13.6 6.2l-3 3.6"/>',
  trash: '<path d="M3.4 4.6h9.2M6.4 4.6V3.2a.6.6 0 0 1 .6-.6h2a.6.6 0 0 1 .6.6v1.4"/><path d="M4.4 4.6 5 12.8a.8.8 0 0 0 .8.8h4.4a.8.8 0 0 0 .8-.8l.6-8.2" stroke-linejoin="round"/>',
  download: '<path d="M8 2.8v6.6M5.4 7l2.6 2.6L10.6 7"/><path d="M3 11.2v1.4a.8.8 0 0 0 .8.8h8.4a.8.8 0 0 0 .8-.8v-1.4"/>',
  upload: '<path d="M8 9.6V3M5.4 5.4 8 2.8l2.6 2.6"/><path d="M3 11.2v1.4a.8.8 0 0 0 .8.8h8.4a.8.8 0 0 0 .8-.8v-1.4"/>',
} as const;

export type EditorIconName = keyof typeof PATHS;

export function hasEditorIcon(name: string): name is EditorIconName {
  return Object.prototype.hasOwnProperty.call(PATHS, name);
}

/** Inline SVG markup for an editor icon. Unknown names render an empty box so layouts do not jump. */
export function editorIcon(name: EditorIconName | string, size = 16): string {
  const body = hasEditorIcon(name) ? PATHS[name] : '';
  return (
    `<svg class="st-icon" viewBox="0 0 16 16" width="${size}" height="${size}" fill="none" stroke="currentColor" ` +
    `stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`
  );
}

export const EDITOR_ICON_NAMES = Object.keys(PATHS) as EditorIconName[];
