// ===================== Pixel-Art Icon Set =====================
// 11x11 hand-set sprites for every element and spell. '.' = transparent.

export interface PixelIconDef {
  /** Palette: char → CSS color. */
  p: Record<string, string>;
  /** 11 rows of 11 chars each. */
  g: string[];
}

export const PIXEL_ICONS: Record<string, PixelIconDef> = {
  sand: { p: { a: '#e2bd5a', b: '#b8923c', c: '#8a6a26' }, g: [
    "...........","...........","...........",".....a.....","....aba....","...aabba...",
    "..abacbba..",".aabbabbaa.","abacbabbcba","...........","..........."]},
  gunpowder: { p: { a: '#6a6d76', b: '#4c4f57', c: '#ffd23e' }, g: [
    ".....c.....","....c.c....","...........",".....a.....","....aab....","...ababa...",
    "..aabbaba..",".ababababa.","aabbababbaa","...........","..........."]},
  wood: { p: { a: '#8a5a36', b: '#6d4427' }, g: [
    "...........",".aaaaaaaaa.",".abababbba.",".aaaaaaaaa.",".bbabbabba.",".aaaaaaaaa.",
    ".abbababba.",".aaaaaaaaa.",".babbabbab.",".aaaaaaaaa.","..........."]},
  vines: { p: { a: '#3ccf5e', b: '#7ef09a' }, g: [
    "....a......","....a......","...ab......","...a.......","...a.b.....","...ab......",
    "....a......","....ab.....","....a......","...a.......","...ab......"]},
  gold: { p: { a: '#8f6a14', b: '#f4c430', c: '#fff3b0' }, g: [
    "..c........","...........","....abb....","...abbba...","..abbbcba..","..abbcbba..",
    "..abbbbba..","...abbba...","....aaa....",".........c.","..........."]},
  water: { p: { a: '#1d4ed8', b: '#3b82f6', c: '#bfdbfe' }, g: [
    ".....a.....",".....a.....","....aba....","....aba....","...abbba...","...abbba...",
    "..abbbcba..","..abbbbba..","...abbba...","....aaa....","..........."]},
  oil: { p: { a: '#2c2117', b: '#4a3623', c: '#8a6a45' }, g: [
    ".....a.....",".....a.....","....aba....","....aba....","...abbba...","...abbba...",
    "..abbbcba..","..abbbbba..","...abbba...","....aaa....","..........."]},
  lava: { p: { a: '#7f1d00', b: '#ff4d00', c: '#ffd23e' }, g: [
    "...........","....aab....","...abbba...","..abcbcba..","..abbcbba..",".abcbbbcba.",
    "..abbbbba..","...ababa...","...........","...........","..........."]},
  nitrogen: { p: { a: '#0e7490', b: '#67e8f9', c: '#ecfeff' }, g: [
    ".....a.....",".....a.....","....aba....","....aba....","...abbba...","...abcba...",
    "..abbbcba..","..abbbbba..","...abbba...","....aaa....","..........."]},
  acid: { p: { a: '#14532d', b: '#4ade80', c: '#d9f99d' }, g: [
    ".....a.....",".....a.....","....aba....","....aba....","...abbba...","...abcba...",
    "..abbbbba..","..abcbbba..","...abbba...","....aaa....","..........."]},
  blood: { p: { a: '#7f1d1d', b: '#dc2626', c: '#fca5a5' }, g: [
    ".....a.....",".....a.....","....aba....","....aba....","...abbba...","...abbba...",
    "..abbbcba..","..abbbbba..","...abbba...","....aaa....","..........."]},
  slime: { p: { a: '#166534', b: '#4ade80', c: '#052e16' }, g: [
    "...........","...........","...aaaaa...","..abbbbba..",".abbbbbbba.",".abcbbbcba.",
    ".abbbbbbba.",".aabbbbbaa.","...........","...........","..........."]},
  ember: { p: { a: '#7a2a08', b: '#ff7a1e', c: '#ffd23e' }, g: [
    "...........","..b........",".....a.....","...c....b..",".a...b.....","......a..c.",
    "..b.....b..",".....c.....","..a.....a..",".....b.....","..........."]},
  fire: { p: { a: '#b91c1c', b: '#f97316', c: '#fde047' }, g: [
    ".....a.....",".....a.....","....aba....","....abba...","...abbba...","...abcba...",
    "..abcccba..","..abcccba..","...abcba...","....aaa....","..........."]},
  smoke: { p: { a: '#4b5563', b: '#6b7280', c: '#9ca3af' }, g: [
    "...........","...........","....aaa....","...abbba...","..abbbbaa..",".abbcbbba..",
    ".abbbbcba..","..aabbbaa..","....aaa....","...........","..........."]},
  ice: { p: { a: '#38bdf8', b: '#bae6fd', c: '#ffffff' }, g: [
    ".....a.....","....aba....","....aba....","...abcba...","...abbba...","..abbcbba..",
    "...abbba...","...abcba...","....aba....","....aba....",".....a....."]},
  metal: { p: { a: '#3f4754', b: '#7a8699', c: '#cdd6e2' }, g: [
    "...........",".aaaaaaaaa.",".acbbbbbca.",".abbbbbbba.",".abbbbbbba.",".abbbbbbba.",
    ".abbbbbbba.",".abbbbbbba.",".acbbbbbca.",".aaaaaaaaa.","..........."]},
  wall: { p: { a: '#3a3a42', b: '#6b6b76' }, g: [
    "...........",".aaaaaaaaa.",".abbabbaba.",".aaaaaaaaa.",".ababbabba.",".aaaaaaaaa.",
    ".abbabbaba.",".aaaaaaaaa.",".ababbabba.",".aaaaaaaaa.","..........."]},
  eraser: { p: { a: '#8c2f4f', b: '#f472b6', c: '#fbcfe8' }, g: [
    "...........","......aaa..",".....abbba.","....abbcba.","...abbcba..","..abbcba...",
    ".abbcba....",".abcba.....",".aaaa......","...........","..........."]},
  bolt: { p: { a: '#0ea5e9', b: '#38bdf8', c: '#e0f2fe' }, g: [
    ".....a.....",".....b.....",".....b.....","..b..c..b..","...bccb....",".abcccccba.",
    "...bccb....","..b..c..b..",".....b.....",".....b.....",".....a....."]},
  bomb: { p: { a: '#555e70', b: '#181c26', c: '#fbbf24', d: '#aab3c5' }, g: [
    ".......cc..","......ac...",".....aa....","....abbba..","...abbdbba.","...abbbbba.",
    "...abbbbba.","...abbbbba.","....abbba..",".....aaa...","..........."]},
  lightning: { p: { a: '#38bdf8', b: '#f0f9ff' }, g: [
    "......bb...",".....bba...","....bba....","...bba.....","..bbbbbb...","....bba....",
    "...bba.....","..bba......","..ba.......","..b........","..........."]},
  flame: { p: { a: '#f97316', b: '#fde047', c: '#ef4444' }, g: [
    "...........","..a........","..ba.......","..bba..c...","..bbba.cc..","..bbbbaccc.",
    "..bbba.cc..","..bba..c...","..ba.......","..a........","..........."]},
  dig: { p: { a: '#9aa3ad', b: '#cdd6e2', c: '#8a5a36' }, g: [
    "......bbb..",".....babbb.","....ba...b.","...ba......","...a.c.....","....ccc....",
    "...cc.c....","..cc.......",".cc........","cc.........","..........."]},
  warp: { p: { a: '#7c3aed', b: '#c084fc', c: '#22d3ee' }, g: [
    "...........","....aaa....","..aab.baa..",".ab.....ba.",".a..ccc..a.",".a..c.c..a.",
    ".a..ccc..a.",".ab.....ba.","..aab.baa..","....aaa....","..........."]},
  blackhole: { p: { a: '#7c3aed', b: '#c084fc', c: '#0a0312' }, g: [
    "...........","....aaa....","..aabbbaa..","..ab...ba..",".ab..c..ba.",".ab.ccc.ba.",
    ".ab..c..ba.","..ab...ba..","..aabbbaa..","....aaa....","..........."]},
  'card-double': { p: { a: '#0e7490', b: '#38bdf8', c: '#e0f2fe' }, g: [
    "...........","...........",".abbbbc....","..abbc.....","...........","...........",
    "....abbbbc.",".....abbc..","...........","...........","..........."]},
  'card-triple': { p: { a: '#0e7490', b: '#38bdf8', c: '#e0f2fe' }, g: [
    "...........","...........",".abbbc.....","...........","...abbbc...","...........",
    ".....abbbc.","...........","...........","...........","..........."]},
  'card-speed': { p: { a: '#22d3ee', b: '#a5f3fc' }, g: [
    "...........","...........",".aa...bb...","..aa...bb..","...aa...bb.","..aa...bb..",
    ".aa...bb...","...........","...........","...........","..........."]},
  'card-heavy': { p: { a: '#3f4754', b: '#7a8699' }, g: [
    "...........",".aaaaaaaaa.",".abbbbbbba.","..aabbbaa..","....aba....","....aba....",
    "...abbba...","..abbbbba..",".aaaaaaaaa.","...........","..........."]},
  'card-spread': { p: { a: '#f97316', b: '#fde047' }, g: [
    "...........",".....b.....",".....a.....",".....a.....",".b...a...b.","..a..a..a..",
    "...a.a.a...","....aaa....",".....a.....","...........","..........."]},
  'card-infuser': { p: { a: '#1d4ed8', b: '#67e8f9', c: '#c084fc' }, g: [
    ".....a.....","....aba....","...abbba...",".....b.....","...ccccc...","..c.....c..",
    ".c...b...c.",".c..bbb..c.",".c...b...c.","..c.....c..","...ccccc..."]},
  'card-trigger': { p: { a: '#ef4444', b: '#fca5a5', c: '#ffffff' }, g: [
    ".....a.....",".....a.....","...aaaaa...","..a..b..a..",".a...b...a.","aab.bcb.baa",
    ".a...b...a.","..a..b..a..","...aaaaa...",".....a.....",".....a....."]},
  'card-bounce': { p: { a: '#15803d', b: '#4ade80', c: '#6b7280' }, g: [
    "...........","...........",".a.......bb","..a......bb","...a....b..","....a..b...",
    ".....ab....",".....a.....","..ccccccc..","...........","..........."]}
};

/** Cell id → icon name for the element toolbar buttons. */
export const ELEMENT_ICON: Record<number, string> = {
  1: 'sand', 8: 'gunpowder', 4: 'wood', 15: 'vines', 17: 'gold',
  2: 'water', 6: 'oil', 11: 'lava', 16: 'nitrogen', 7: 'acid',
  18: 'blood', 19: 'slime', 5: 'fire', 14: 'smoke', 20: 'ember',
  10: 'ice', 13: 'metal', 3: 'wall', 0: 'eraser'
};

/** Legacy projectile cards reuse the spell icons they were reborn from. */
const LEGACY_CARD_ICON: Record<string, string> = {
  spark: 'bolt', bomb: 'bomb', lightning: 'lightning', flame: 'flame',
  dig: 'dig', warp: 'warp', blackhole: 'blackhole',
  // Upgrade-port payload cards borrow the closest existing glyphs until
  // they get bespoke pixel art.
  vitriol: 'acid', frostshard: 'ice', icelance: 'ice', wisp: 'bolt',
  meteor: 'bomb', conjure: 'wall', emberstorm: 'ember',
};

/** Card id → PIXEL_ICONS key (modifier/multicast cards live under 'card-*'). */
export function cardIconName(id: string): string {
  return LEGACY_CARD_ICON[id] ?? 'card-' + id;
}

export function makeIconCanvas(name: string, scale = 3): HTMLCanvasElement | null {
  const def = PIXEL_ICONS[name];
  if (!def) return null;
  const rows = def.g, h = rows.length, w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d')!;
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.') continue;
      ctx.fillStyle = def.p[ch] || '#f0f';
      ctx.fillRect(x, y, 1, 1);
    }
  });
  c.style.width = (w * scale) + 'px';
  c.style.height = (h * scale) + 'px';
  c.className = 'px-icon';
  return c;
}
