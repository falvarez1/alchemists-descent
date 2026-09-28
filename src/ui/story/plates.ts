/**
 * The story's painted plates (the opening, the ending), drawn procedurally on
 * a 2D canvas in a lantern-slide style: layered silhouettes against a lit sky
 * or a glowing cavern, drifting smoke and motes, a vignette that falls into
 * the black around the slide. No art files — every plate is a few hundred
 * path calls, animated by `t` (seconds into the plate).
 */

export type PlateArtId = 'town' | 'lift' | 'works' | 'flue' | 'window' | 'pell' | 'lantern' | 'farewell';

type G = CanvasRenderingContext2D;

/** Deterministic hash noise, 0..1. */
function rnd(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

function rgba(r: number, g: number, b: number, a = 1): string {
  return `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a})`;
}

function vgrad(g: G, h: number, stops: Array<[number, string]>): CanvasGradient {
  const gr = g.createLinearGradient(0, 0, 0, h);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  return gr;
}

function glow(g: G, x: number, y: number, r: number, color: [number, number, number], a: number): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  gr.addColorStop(0, rgba(color[0], color[1], color[2], a));
  gr.addColorStop(1, rgba(color[0], color[1], color[2], 0));
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Smoke: soft drifting blobs rising from sources. */
function smoke(g: G, t: number, sources: Array<[number, number]>, color: [number, number, number], alpha: number, spread = 1): void {
  sources.forEach(([sx, sy], k) => {
    for (let i = 0; i < 9; i++) {
      const life = ((t * 0.09 + i / 9 + rnd(k * 13 + i)) % 1);
      const x = sx + Math.sin(life * 4 + k) * 18 * spread + life * 60 * spread;
      const y = sy - life * 190;
      const r = 14 + life * 70 * spread;
      const gr = g.createRadialGradient(x, y, 0, x, y, r);
      const a = alpha * (1 - life) * Math.min(1, life * 5);
      gr.addColorStop(0, rgba(color[0], color[1], color[2], a));
      gr.addColorStop(1, rgba(color[0], color[1], color[2], 0));
      g.fillStyle = gr;
      g.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

function motes(g: G, t: number, w: number, h: number, count: number, color: [number, number, number], rise: number, seed = 1): void {
  for (let i = 0; i < count; i++) {
    const s = seed * 97 + i * 7.3;
    const life = (t * (0.04 + rnd(s) * 0.05) * Math.abs(rise) + rnd(s + 1)) % 1;
    const x = rnd(s + 2) * w + Math.sin(t * 0.7 + i) * 6;
    const y = rise > 0 ? h - life * h * 1.1 : life * h;
    const a = Math.sin(life * Math.PI) * (0.35 + rnd(s + 3) * 0.5);
    g.fillStyle = rgba(color[0], color[1], color[2], a);
    const r = 0.8 + rnd(s + 4) * 1.6;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  }
}

/** A row of roofs, gables and chimneys along `base` (returns chimney tops for smoke). */
function skyline(g: G, w: number, base: number, color: string, seed: number, windows: number, windowColor: [number, number, number], lit = 0.6): Array<[number, number]> {
  const tops: Array<[number, number]> = [];
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(0, base + 200);
  let x = -10;
  let k = seed;
  const houses: Array<{ x: number; w: number; top: number }> = [];
  while (x < w + 20) {
    const hw = 50 + rnd(k) * 70, hh = 50 + rnd(k + 1) * 80, roof = 16 + rnd(k + 2) * 26;
    const top = base - hh;
    g.lineTo(x, top);
    if (rnd(k + 3) > 0.45) { g.lineTo(x + hw / 2, top - roof); g.lineTo(x + hw, top); }
    else g.lineTo(x + hw, top);
    // A chimney on most roofs.
    if (rnd(k + 4) > 0.3) {
      const cx = x + hw * (0.2 + rnd(k + 5) * 0.6), ch = 18 + rnd(k + 6) * 26;
      tops.push([cx + 5, top - ch - (rnd(k + 3) > 0.45 ? roof * 0.5 : 0)]);
    }
    houses.push({ x, w: hw, top });
    x += hw - 4;
    k += 11;
  }
  g.lineTo(w + 20, base + 200);
  g.closePath();
  g.fill();
  for (const [cx, cy] of tops) g.fillRect(cx - 5, cy, 10, base - cy);
  // Windows.
  for (let i = 0; i < windows; i++) {
    const hsel = houses[Math.floor(rnd(seed + i * 3.1) * houses.length)];
    const wx = hsel.x + 8 + rnd(seed + i * 5.7) * (hsel.w - 20), wy = hsel.top + 10 + rnd(seed + i * 2.3) * 40;
    const on = rnd(seed + i * 9.1) < lit;
    if (!on) continue;
    g.fillStyle = rgba(windowColor[0], windowColor[1], windowColor[2], 0.85);
    g.fillRect(wx, wy, 6, 8);
    glow(g, wx + 3, wy + 4, 16, windowColor, 0.18);
  }
  return tops;
}

/** The Guild lift's headframe over its shaft: a riveted A-frame, the sheave, the cables. */
function headframe(g: G, x: number, base: number, scale: number, color: string): void {
  g.strokeStyle = color; g.fillStyle = color; g.lineWidth = 3 * scale;
  const h = 150 * scale, half = 36 * scale;
  g.beginPath();
  g.moveTo(x - half, base); g.lineTo(x - 6 * scale, base - h);
  g.moveTo(x + half, base); g.lineTo(x + 6 * scale, base - h);
  for (let i = 1; i < 6; i++) {
    const y = base - (h * i) / 6, hw = half * (1 - i / 6) + 6 * scale;
    g.moveTo(x - hw, y); g.lineTo(x + hw, y);
    if (i < 5) { const y2 = base - (h * (i + 1)) / 6, hw2 = half * (1 - (i + 1) / 6) + 6 * scale; g.moveTo(x - hw, y); g.lineTo(x + hw2, y2); }
  }
  g.stroke();
  g.beginPath(); g.arc(x, base - h, 12 * scale, 0, Math.PI * 2); g.lineWidth = 3 * scale; g.stroke();
}

/** A small alchemist: long coat, crooked hat, a point of cyan light at the wand. */
function apprentice(g: G, x: number, y: number, s: number, color: string, facing = 1, wandGlow = 1): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - 7 * s, y); g.lineTo(x - 5 * s, y - 20 * s); g.lineTo(x - 6 * s, y - 32 * s);
  g.lineTo(x + 6 * s, y - 32 * s); g.lineTo(x + 5 * s, y - 20 * s); g.lineTo(x + 8 * s, y);
  g.closePath(); g.fill();
  g.beginPath(); g.arc(x + facing * 1 * s, y - 37 * s, 5 * s, 0, Math.PI * 2); g.fill();
  // The hat: a wide brim and a crown that flops back.
  g.beginPath(); g.ellipse(x, y - 41 * s, 12 * s, 2.4 * s, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.moveTo(x - 5 * s, y - 42 * s); g.quadraticCurveTo(x - 2 * s, y - 58 * s, x - facing * 12 * s, y - 55 * s);
  g.lineTo(x + 5 * s, y - 42 * s); g.closePath(); g.fill();
  // The wand, and its light.
  g.strokeStyle = color; g.lineWidth = 1.6 * s;
  g.beginPath(); g.moveTo(x + facing * 5 * s, y - 20 * s); g.lineTo(x + facing * 16 * s, y - 30 * s); g.stroke();
  if (wandGlow > 0) glow(g, x + facing * 16 * s, y - 30 * s, 16 * s, [120, 230, 255], 0.55 * wandGlow);
}

/** Pell: a long coat, a map case slung on his back, a lantern on a pole. */
function pellFigure(g: G, x: number, y: number, s: number, color: string, t: number, wave: boolean, lamp = true): void {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x - 9 * s, y); g.lineTo(x - 6 * s, y - 34 * s); g.lineTo(x + 6 * s, y - 34 * s); g.lineTo(x + 10 * s, y);
  g.closePath(); g.fill();
  g.beginPath(); g.arc(x, y - 39 * s, 5 * s, 0, Math.PI * 2); g.fill();
  // A soft cap.
  g.beginPath(); g.ellipse(x - 1 * s, y - 43 * s, 6 * s, 2.6 * s, -0.2, 0, Math.PI * 2); g.fill();
  // The map case across his back.
  g.save(); g.translate(x - 4 * s, y - 26 * s); g.rotate(-0.9); g.fillRect(-2 * s, -14 * s, 4 * s, 26 * s); g.restore();
  // The pole, and the lantern hung from its crook.
  g.strokeStyle = color; g.lineWidth = 2 * s;
  const px = x + 12 * s;
  g.beginPath(); g.moveTo(px, y); g.lineTo(px, y - 58 * s); g.quadraticCurveTo(px, y - 64 * s, px + 7 * s, y - 62 * s); g.stroke();
  if (lamp) {
    const sway = Math.sin(t * 1.8) * 2 * s;
    g.fillStyle = color; g.fillRect(px + 5 * s + sway, y - 58 * s, 5 * s, 7 * s);
    glow(g, px + 7.5 * s + sway, y - 54 * s, 60 * s, [255, 180, 90], 0.5);
    glow(g, px + 7.5 * s + sway, y - 54 * s, 10 * s, [255, 230, 170], 0.9);
  }
  // His free arm: raised in a wave, or at his side.
  g.strokeStyle = color; g.lineWidth = 3 * s;
  g.beginPath(); g.moveTo(x - 5 * s, y - 30 * s);
  if (wave) { const a = Math.sin(t * 5) * 0.4; g.lineTo(x - 10 * s, y - 42 * s); g.lineTo(x - 12 * s + a * 6 * s, y - 54 * s); }
  else g.lineTo(x - 9 * s, y - 16 * s);
  g.stroke();
}

/** A brass speaking-pipe's horn, glowing warm when it speaks. */
function horn(g: G, x: number, y: number, s: number, speaking: number): void {
  g.strokeStyle = rgba(120, 92, 48); g.lineWidth = 6 * s;
  g.beginPath(); g.moveTo(x, y - 200 * s); g.lineTo(x, y); g.stroke();
  g.fillStyle = rgba(160, 124, 62);
  g.beginPath(); g.moveTo(x - 4 * s, y); g.lineTo(x - 16 * s, y + 20 * s); g.lineTo(x + 16 * s, y + 20 * s); g.lineTo(x + 4 * s, y); g.closePath(); g.fill();
  g.fillStyle = rgba(40, 26, 12); g.beginPath(); g.ellipse(x, y + 20 * s, 16 * s, 4 * s, 0, 0, Math.PI * 2); g.fill();
  if (speaking > 0) glow(g, x, y + 22 * s, 70 * s, [255, 190, 110], 0.4 * speaking);
}

/** Rock wall silhouettes framing a cavern. */
function cavern(g: G, w: number, h: number, color: string, seed: number): void {
  g.fillStyle = color;
  g.beginPath(); g.moveTo(0, 0);
  for (let x = 0; x <= w; x += 20) g.lineTo(x, 30 + rnd(seed + x) * 40 + Math.sin(x * 0.01) * 20);
  g.lineTo(w, 0); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(0, h);
  for (let x = 0; x <= w; x += 20) g.lineTo(x, h - 40 - rnd(seed + 7 + x) * 30);
  g.lineTo(w, h); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(0, 0);
  for (let y = 0; y <= h; y += 20) g.lineTo(60 + rnd(seed + 3 + y) * 40, y);
  g.lineTo(0, h); g.closePath(); g.fill();
  g.beginPath(); g.moveTo(w, 0);
  for (let y = 0; y <= h; y += 20) g.lineTo(w - 70 - rnd(seed + 5 + y) * 40, y);
  g.lineTo(w, h); g.closePath(); g.fill();
}

/* ---------------- the plates ---------------- */

function town(g: G, w: number, h: number, t: number): void {
  g.fillStyle = vgrad(g, h, [[0, '#2a2016'], [0.45, '#6b5230'], [0.7, '#8a6a3a'], [1, '#2c2418']]);
  g.fillRect(0, 0, w, h);
  glow(g, w * 0.68, h * 0.52, 260, [230, 170, 90], 0.22);
  smoke(g, t, [[w * 0.1, h * 0.55], [w * 0.4, h * 0.5], [w * 0.8, h * 0.55]], [60, 48, 36], 0.5, 1.8);
  const far = skyline(g, w, h * 0.72, '#241c14', 11, 10, [255, 196, 110], 0.35);
  smoke(g, t * 1.2, far.slice(0, 7), [48, 40, 32], 0.55);
  const near = skyline(g, w, h * 0.86, '#120e0a', 57, 12, [255, 200, 120], 0.45);
  smoke(g, t * 1.4, near.slice(0, 6), [30, 26, 22], 0.7, 1.2);
  headframe(g, w * 0.82, h * 0.86, 0.9, '#0c0907');
  motes(g, t, w, h, 60, [40, 34, 28], -1, 3);
}

function lift(g: G, w: number, h: number, t: number): void {
  g.fillStyle = '#0b0f10'; g.fillRect(0, 0, w, h);
  const cx = w / 2;
  // The shaft walls: wet slate, lit from the cage.
  const cageY = h * 0.18 + Math.min(1, t / 3.4) * h * 0.34 + Math.sin(t * 2.2) * 2;
  g.fillStyle = vgrad(g, h, [[0, '#1b2527'], [1, '#0a0e0f']]);
  g.fillRect(0, 0, cx - 120, h); g.fillRect(cx + 120, 0, w - cx - 120, h);
  for (let i = 0; i < 16; i++) {
    const y = ((i * 57 - t * 44) % (h + 60) + h + 60) % (h + 60) - 30;
    g.fillStyle = 'rgba(80,96,98,0.25)';
    g.fillRect(cx - 124 - rnd(i) * 40, y, 30 + rnd(i + 3) * 60, 3);
    g.fillRect(cx + 124, y + 20, 30 + rnd(i + 7) * 60, 3);
  }
  // Brass guide rails.
  g.fillStyle = '#6a5230'; g.fillRect(cx - 104, 0, 5, h); g.fillRect(cx + 99, 0, 5, h);
  // Cables.
  g.strokeStyle = '#3a3026'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(cx - 20, 0); g.lineTo(cx - 20, cageY - 70); g.moveTo(cx + 20, 0); g.lineTo(cx + 20, cageY - 70); g.stroke();
  // The cage lamp.
  glow(g, cx, cageY - 50, 240, [255, 190, 110], 0.4);
  // The cage.
  g.strokeStyle = '#a07c42'; g.lineWidth = 3;
  g.strokeRect(cx - 60, cageY - 70, 120, 110);
  for (let i = 1; i < 8; i++) { g.beginPath(); g.moveTo(cx - 60 + i * 15, cageY - 70); g.lineTo(cx - 60 + i * 15, cageY + 40); g.stroke(); }
  g.fillStyle = '#7a5e30'; g.fillRect(cx - 64, cageY + 36, 128, 7); g.fillRect(cx - 64, cageY - 74, 128, 6);
  apprentice(g, cx - 6, cageY + 35, 1.5, '#0b0d0e', 1, 0.8 + Math.sin(t * 3) * 0.2);
  // Soot falling past.
  motes(g, t, w, h, 40, [150, 130, 100], -2, 9);
}

function works(g: G, w: number, h: number, t: number, speaking: number): void {
  g.fillStyle = vgrad(g, h, [[0, '#061012'], [0.6, '#0d2226'], [1, '#081416']]);
  g.fillRect(0, 0, w, h);
  // Deep background pipes and arches.
  g.strokeStyle = '#123034'; g.lineWidth = 16;
  for (let i = 0; i < 5; i++) { g.beginPath(); g.moveTo(w * (0.15 + i * 0.18), h); g.lineTo(w * (0.15 + i * 0.18), h * 0.3); g.quadraticCurveTo(w * (0.24 + i * 0.18), h * 0.12, w * (0.33 + i * 0.18), h * 0.3); g.stroke(); }
  glow(g, w * 0.3, h * 0.72, 220, [80, 200, 170], 0.28);
  glow(g, w * 0.7, h * 0.6, 180, [255, 170, 90], 0.18);
  // The Works breathing: steam from a vent.
  const breath = 0.5 + 0.5 * Math.sin(t * 1.4);
  smoke(g, t * 2, [[w * 0.55, h * 0.78]], [170, 200, 196], 0.18 + breath * 0.18, 0.7);
  cavern(g, w, h, '#040809', 21);
  // Glowshrooms.
  for (let i = 0; i < 7; i++) glow(g, w * (0.12 + rnd(i) * 0.76), h * (0.84 + rnd(i + 2) * 0.06), 20, [90, 220, 180], 0.5);
  apprentice(g, w * 0.34, h * 0.86, 1.3, '#020405', 1, 1);
  horn(g, w * 0.72, h * 0.38, 1.2, speaking);
  motes(g, t, w, h, 50, [120, 220, 190], 1, 4);
}

function flue(g: G, w: number, h: number, t: number): void {
  g.fillStyle = vgrad(g, h, [[0, '#d8c9a0'], [0.25, '#6d6352'], [0.7, '#2a1c16'], [1, '#3a140a']]);
  g.fillRect(0, 0, w, h);
  const cx = w / 2;
  g.fillStyle = '#0d0a09';
  g.fillRect(0, 0, cx - 130, h); g.fillRect(cx + 130, 0, w - cx - 130, h);
  // Ledges, alternating.
  for (let i = 0; i < 6; i++) { const y = h - 60 - i * 90; g.fillRect(i % 2 ? cx + 50 : cx - 130, y, 80, 10); }
  glow(g, cx, h, 320, [255, 110, 40], 0.35 * Math.max(0, 1 - t / 4));
  glow(g, cx, 0, 300, [255, 250, 220], 0.45);
  motes(g, t * 1.6, w, h, 90, [255, 250, 230], 2, 5);
}

function windowPlate(g: G, w: number, h: number, t: number): void {
  const clear = Math.min(1, t / 3);
  g.fillStyle = vgrad(g, h, [[0, clear > 0.5 ? '#9ab8c8' : '#6b5f48'], [0.6, '#e6cf9a'], [1, '#3a3020']]);
  g.fillRect(0, 0, w, h);
  glow(g, w * 0.7, h * 0.55, 300, [255, 220, 150], 0.4);
  smoke(g, t, [[w * 0.2, h * 0.6], [w * 0.6, h * 0.6]], [120, 110, 90], 0.25 * (1 - clear), 1.8);
  skyline(g, w, h * 0.78, '#3c342a', 11, 14, [255, 220, 150], 0.7);
  // The window: its frame and shutters, one swinging open.
  const wx = w * 0.18, wy = h * 0.18, ww = 220, wh = 300;
  g.fillStyle = '#1c150e';
  g.fillRect(0, 0, wx, h); g.fillRect(wx + ww, 0, w - wx - ww, h); g.fillRect(0, 0, w, wy); g.fillRect(0, wy + wh, w, h - wy - wh);
  g.fillStyle = '#2c2116'; g.fillRect(wx - 8, wy + wh, ww + 16, 14);
  const open = Math.min(1, Math.max(0, (t - 0.6) / 1.6));
  g.fillStyle = '#3a2a1a';
  g.fillRect(wx, wy, (ww / 2) * (1 - open * 0.85), wh);
  g.fillRect(wx + ww - (ww / 2) * (1 - open), wy, (ww / 2) * (1 - open), wh);
  // The curtain, stirring in air that moves again.
  g.fillStyle = 'rgba(230,220,200,0.35)';
  g.beginPath(); g.moveTo(wx + ww * 0.1, wy);
  for (let i = 0; i <= 10; i++) g.lineTo(wx + ww * 0.1 + Math.sin(t * 2 + i * 0.6) * 10 * open + i * 3, wy + (wh * i) / 10);
  g.lineTo(wx, wy + wh); g.lineTo(wx, wy); g.closePath(); g.fill();
  motes(g, t, w, h, 30, [255, 245, 220], 1, 6);
}

function flueTop(g: G, w: number, h: number, t: number, who: 'pell' | 'lantern'): void {
  g.fillStyle = vgrad(g, h, [[0, '#f0dca8'], [0.5, '#8a7a5a'], [1, '#1a1410']]);
  g.fillRect(0, 0, w, h);
  glow(g, w / 2, h * 0.1, 360, [255, 245, 210], 0.5);
  // The hatch, thrown open; the landing.
  g.fillStyle = '#16110c'; g.fillRect(0, h * 0.78, w, h * 0.22);
  g.fillRect(0, 0, w * 0.2, h); g.fillRect(w * 0.8, 0, w * 0.2, h);
  g.fillStyle = '#8a6a36'; g.fillRect(w * 0.36, h * 0.1, w * 0.28, 8);
  g.save(); g.translate(w * 0.64, h * 0.1); g.rotate(-1.1 * Math.min(1, t / 1.2)); g.fillRect(0, -4, w * 0.2, 8); g.restore();
  if (who === 'pell') pellFigure(g, w * 0.56, h * 0.78, 2.2, '#0d0a08', t, t > 0.4);
  else {
    // Only his lantern on its pole, leaning on the wall, and the finished map pinned beside it.
    g.strokeStyle = '#0d0a08'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(w * 0.7, h * 0.78); g.lineTo(w * 0.76, h * 0.3); g.stroke();
    glow(g, w * 0.765, h * 0.32, 120, [255, 180, 90], 0.55);
    glow(g, w * 0.765, h * 0.32, 14, [255, 235, 180], 0.95);
    g.fillStyle = '#d8c8a0'; g.save(); g.translate(w * 0.28, h * 0.42); g.rotate(-0.06); g.fillRect(0, 0, 90, 70);
    g.strokeStyle = 'rgba(80,60,30,0.7)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(10, 55); g.lineTo(30, 30); g.lineTo(50, 42); g.lineTo(78, 14); g.stroke(); g.restore();
  }
  motes(g, t, w, h, 40, [255, 250, 230], 1, 7);
}

function farewell(g: G, w: number, h: number, t: number, speaking: number): void {
  g.fillStyle = vgrad(g, h, [[0, '#0a1a1c'], [0.7, '#12302f'], [1, '#081314']]);
  g.fillRect(0, 0, w, h);
  glow(g, w * 0.5, h * 0.3, 420, [180, 230, 210], 0.2);
  cavern(g, w, h, '#040909', 33);
  horn(g, w * 0.5, h * 0.36, 1.4, speaking * (0.6 + 0.4 * Math.sin(t * 2)));
  motes(g, t, w, h, 80, [200, 240, 225], 1, 8);
}

/** Paint one plate at `t` seconds; `speaking` (0..1) lights a speaking-pipe where there is one. */
export function paintPlate(g: G, art: PlateArtId, w: number, h: number, t: number, speaking: number): void {
  g.save();
  switch (art) {
    case 'town': town(g, w, h, t); break;
    case 'lift': lift(g, w, h, t); break;
    case 'works': works(g, w, h, t, speaking); break;
    case 'flue': flue(g, w, h, t); break;
    case 'window': windowPlate(g, w, h, t); break;
    case 'pell': flueTop(g, w, h, t, 'pell'); break;
    case 'lantern': flueTop(g, w, h, t, 'lantern'); break;
    case 'farewell': farewell(g, w, h, t, speaking); break;
  }
  g.restore();
  // The lantern-slide vignette: the plate falls into the dark around it.
  const v = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.32, w / 2, h / 2, Math.max(w, h) * 0.72);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(3,5,6,0.92)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  // A little grain.
  g.fillStyle = 'rgba(255,240,210,0.035)';
  for (let i = 0; i < 180; i++) g.fillRect(rnd(i + Math.floor(t * 12) * 0.37) * w, rnd(i * 1.7 + Math.floor(t * 12)) * h, 1.5, 1.5);
}
