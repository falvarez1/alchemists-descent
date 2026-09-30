/**
 * The story's painted plates (the opening, the ending), drawn procedurally on
 * a 2D canvas in a lantern-slide style: layered silhouettes against a lit sky
 * or a glowing cavern, drifting smoke and motes, a vignette that falls into
 * the black around the slide. No art files — every plate is a few hundred
 * path calls, animated by `t` (seconds into the plate).
 */

export type PlateArtId = 'town' | 'lift' | 'works' | 'flue' | 'window' | 'pell' | 'pellcup' | 'lantern' | 'farewell';

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

/** A teacup with two threads of steam (Pell's ending when the apprentice took his tea). */
function teacup(g: G, x: number, y: number, s: number, t: number): void {
  g.fillStyle = '#efe4cc';
  g.beginPath(); g.moveTo(x - 5 * s, y - 6 * s); g.lineTo(x + 5 * s, y - 6 * s); g.lineTo(x + 3.6 * s, y); g.lineTo(x - 3.6 * s, y); g.closePath(); g.fill();
  g.strokeStyle = '#efe4cc'; g.lineWidth = 1.6 * s;
  g.beginPath(); g.arc(x + 5.4 * s, y - 3.4 * s, 2.4 * s, -1.3, 1.3); g.stroke();
  g.strokeStyle = 'rgba(240,236,226,0.38)'; g.lineWidth = 1.4 * s; g.lineCap = 'round';
  for (let k = 0; k < 2; k++) {
    g.beginPath();
    for (let i = 0; i <= 8; i++) {
      const yy = y - 8 * s - i * 3 * s, xx = x + (k ? 2.5 : -2.5) * s + Math.sin(t * 2 + i * 0.7 + k * 2) * 1.6 * s;
      if (i === 0) g.moveTo(xx, yy); else g.lineTo(xx, yy);
    }
    g.stroke();
  }
  g.lineCap = 'butt';
}

/** Pell: a long coat, a map case slung on his back, a lantern on a pole. `cup`: his free hand holds out a cup. */
function pellFigure(g: G, x: number, y: number, s: number, color: string, t: number, wave: boolean, lamp = true, cup = false): void {
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
  if (cup) { g.lineTo(x - 13 * s, y - 26 * s); g.lineTo(x - 20 * s, y - 29 * s); }
  else if (wave) { const a = Math.sin(t * 5) * 0.4; g.lineTo(x - 10 * s, y - 42 * s); g.lineTo(x - 12 * s + a * 6 * s, y - 54 * s); }
  else g.lineTo(x - 9 * s, y - 16 * s);
  g.stroke();
  if (cup) teacup(g, x - 22 * s, y - 28 * s, s, t);
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
  // A sick amber evening: the sun a smear behind the smoke.
  g.fillStyle = vgrad(g, h, [[0, '#231a10'], [0.35, '#7a5a2c'], [0.62, '#b08440'], [0.8, '#5a4426'], [1, '#1c160e']]);
  g.fillRect(0, 0, w, h);
  glow(g, w * 0.64, h * 0.5, 300, [255, 196, 110], 0.32);
  glow(g, w * 0.64, h * 0.5, 60, [255, 226, 160], 0.4);
  // The Works' great chimneys on the horizon, breathing out the smoke that chokes the town.
  g.fillStyle = '#2e2216';
  for (const [cx, ch] of [[0.28, 0.34], [0.36, 0.27], [0.52, 0.31]] as const) g.fillRect(w * cx - 9, h * (0.72 - ch), 18, h * ch);
  smoke(g, t, [[w * 0.28, h * 0.38], [w * 0.36, h * 0.45], [w * 0.52, h * 0.41]], [44, 34, 24], 0.62, 2.4);
  smoke(g, t * 0.8, [[w * 0.1, h * 0.5], [w * 0.75, h * 0.48]], [70, 56, 40], 0.35, 2.2);
  const far = skyline(g, w, h * 0.72, '#241b12', 11, 12, [255, 196, 110], 0.4);
  smoke(g, t * 1.2, far.slice(0, 7), [40, 33, 26], 0.55);
  const near = skyline(g, w, h * 0.86, '#100c08', 57, 14, [255, 206, 130], 0.5);
  smoke(g, t * 1.4, near.slice(0, 6), [26, 22, 18], 0.7, 1.2);
  headframe(g, w * 0.82, h * 0.86, 0.9, '#0a0806');
  motes(g, t, w, h, 70, [30, 26, 22], -1, 3);
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
  // Looking up the flue: the lava below cooling to stone, clean air rising past the ledges to the light.
  const cx = w / 2, half = 150;
  g.fillStyle = vgrad(g, h, [[0, '#e6d8b0'], [0.3, '#6f6552'], [0.72, '#2a1d16'], [1, '#34130a']]);
  g.fillRect(0, 0, w, h);
  const cool = Math.min(1, t / 3.5);
  glow(g, cx, h + 20, 340, [255, 110, 40], 0.5 * (1 - cool) + 0.08);
  // Brick walls either side, soot-dark.
  for (const [x0, x1] of [[0, cx - half], [cx + half, w]] as const) {
    g.fillStyle = '#120d0a'; g.fillRect(x0, 0, x1 - x0, h);
    g.fillStyle = 'rgba(255,220,170,0.05)';
    for (let row = 0, y = 0; y < h; row++, y += 16) {
      g.fillRect(x0, y, x1 - x0, 1);
      for (let x = x0 + (row % 2) * 20; x < x1; x += 40) g.fillRect(x, y, 1, 16);
    }
  }
  // Rim light where the walls meet the shaft.
  g.fillStyle = 'rgba(255,236,200,0.18)'; g.fillRect(cx - half - 3, 0, 3, h); g.fillRect(cx + half, 0, 3, h);
  // The ledges he climbed, alternating.
  g.fillStyle = '#0d0907';
  for (let i = 0; i < 6; i++) { const y = h - 50 - i * 84; g.fillRect(i % 2 ? cx + half - 90 : cx - half, y, 90, 9); }
  // Clean air: pale ribbons rising, unhurried.
  g.lineCap = 'round';
  for (let k = 0; k < 7; k++) {
    const x0 = cx - 110 + k * 36, phase = k * 1.7;
    g.strokeStyle = `rgba(236,246,240,${0.1 + 0.05 * Math.sin(t + k)})`; g.lineWidth = 6 + (k % 3) * 3;
    g.beginPath();
    for (let y = h; y >= 0; y -= 12) {
      const yy = (y - ((t * 60 + k * 40) % 24)) , x = x0 + Math.sin(yy * 0.018 + phase + t * 0.8) * 16;
      if (y === h) g.moveTo(x, yy); else g.lineTo(x, yy);
    }
    g.stroke();
  }
  g.lineCap = 'butt';
  // The apprentice on the highest ledge, looking up.
  apprentice(g, cx - half + 45, h - 50 - 4 * 84, 1.5, '#0b0806', 1, 0.6);
  glow(g, cx, 0, 320, [255, 250, 222], 0.5);
  motes(g, t * 1.6, w, h, 80, [255, 250, 230], 2, 5);
}

function windowPlate(g: G, w: number, h: number, t: number): void {
  const clear = Math.min(1, t / 3);
  // Outside: morning over Kettleby, the smoke thinning to nothing.
  g.fillStyle = vgrad(g, h, [[0, clear > 0.5 ? '#a8c4d0' : '#7a6a4c'], [0.55, '#f0d9a4'], [1, '#4a3c28']]);
  g.fillRect(0, 0, w, h);
  glow(g, w * 0.3, h * 0.46, 260, [255, 226, 160], 0.5);
  smoke(g, t, [[w * 0.2, h * 0.6], [w * 0.4, h * 0.6]], [120, 110, 90], 0.3 * (1 - clear), 1.8);
  skyline(g, w, h * 0.7, '#4a4034', 11, 14, [255, 224, 160], 0.7);
  // Inside: a lamp-lit room — striped paper, a table, a teacup still steaming.
  const wx = w * 0.14, wy = h * 0.14, ww = w * 0.3, wh = h * 0.56;
  const room = (x: number, y: number, rw: number, rh: number): void => {
    g.fillStyle = '#2a2016'; g.fillRect(x, y, rw, rh);
    g.fillStyle = 'rgba(80,60,40,0.35)';
    for (let sx = x + 8; sx < x + rw; sx += 26) g.fillRect(sx, y, 9, rh);
  };
  room(0, 0, wx, h); room(wx + ww, 0, w - wx - ww, h); room(wx, 0, ww, wy); room(wx, wy + wh, ww, h - wy - wh);
  glow(g, w * 0.72, h * 0.62, 320, [255, 190, 110], 0.2);
  // The window frame and sill.
  g.fillStyle = '#4a3622'; g.fillRect(wx - 10, wy - 10, ww + 20, 10); g.fillRect(wx - 10, wy, 10, wh); g.fillRect(wx + ww, wy, 10, wh);
  g.fillStyle = '#5c4228'; g.fillRect(wx - 16, wy + wh, ww + 32, 14);
  g.fillStyle = '#4a3622'; g.fillRect(wx + ww / 2 - 3, wy, 6, wh);
  // The casements swing open.
  const open = Math.min(1, Math.max(0, (t - 0.6) / 1.6));
  g.fillStyle = 'rgba(58,42,26,0.92)';
  g.fillRect(wx, wy, (ww / 2) * (1 - open * 0.8), wh);
  g.fillRect(wx + ww - (ww / 2) * (1 - open * 0.8), wy, (ww / 2) * (1 - open * 0.8), wh);
  // The curtain, stirring in air that moves again.
  g.fillStyle = 'rgba(236,224,200,0.5)';
  g.beginPath(); g.moveTo(wx + ww + 10, wy - 10);
  for (let i = 0; i <= 12; i++) g.lineTo(wx + ww + 10 - 26 - Math.sin(t * 1.8 + i * 0.55) * 12 * open - i * 1.5, wy - 10 + ((wh + 10) * i) / 12);
  g.lineTo(wx + ww + 40, wy + wh); g.lineTo(wx + ww + 40, wy - 10); g.closePath(); g.fill();
  // A table, a teacup, and its steam.
  const tx = w * 0.62, ty = h * 0.78;
  g.fillStyle = '#3a2818'; g.fillRect(tx - 120, ty, 240, 12); g.fillRect(tx - 110, ty + 12, 10, h - ty); g.fillRect(tx + 100, ty + 12, 10, h - ty);
  g.fillStyle = '#e8dcc0'; g.beginPath(); g.ellipse(tx, ty - 3, 26, 6, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#f2e8d2'; g.fillRect(tx - 12, ty - 22, 24, 18);
  g.strokeStyle = '#f2e8d2'; g.lineWidth = 3; g.beginPath(); g.arc(tx + 14, ty - 14, 6, -1.2, 1.2); g.stroke();
  smoke(g, t * 2.4, [[tx, ty - 30]], [240, 236, 226], 0.14, 0.3);
  motes(g, t, w, h, 36, [255, 245, 220], 1, 6);
}

function flueTop(g: G, w: number, h: number, t: number, who: 'pell' | 'pellcup' | 'lantern'): void {
  const floor = h * 0.8, hx0 = w * 0.4, hx1 = w * 0.6, hy = h * 0.15;
  // The flue's last chamber: soot-dark brick, warmed where the morning comes in.
  g.fillStyle = '#1b140f'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  for (let row = 0, y = 0; y < floor; row++, y += 18) {
    g.fillRect(0, y, w, 2);
    for (let x = (row % 2) * 22; x < w; x += 44) g.fillRect(x, y, 2, 18);
  }
  glow(g, w / 2, hy + 40, 380, [255, 226, 170], 0.42);
  // The hatch, thrown open on a clean sky.
  g.fillStyle = vgrad(g, hy, [[0, '#bcd6df'], [1, '#f4e2b4']]);
  g.fillRect(hx0, 0, hx1 - hx0, hy);
  g.fillStyle = '#0c0907'; g.fillRect(hx0 - 12, hy, hx1 - hx0 + 24, 10);
  g.save(); g.translate(hx1 + 6, hy); g.rotate(-1.25 * Math.min(1, t / 1.2)); g.fillStyle = '#4a3420'; g.fillRect(0, -6, hx1 - hx0, 12);
  g.fillStyle = '#2a1c10'; for (let i = 1; i < 4; i++) g.fillRect(((hx1 - hx0) * i) / 4, -6, 3, 12); g.restore();
  // Daylight falling down the shaft.
  const shaft = g.createLinearGradient(0, hy, 0, floor);
  shaft.addColorStop(0, 'rgba(255,244,214,0.34)'); shaft.addColorStop(1, 'rgba(255,244,214,0.04)');
  g.fillStyle = shaft;
  g.beginPath(); g.moveTo(hx0, hy); g.lineTo(hx1, hy); g.lineTo(hx1 + 90, floor); g.lineTo(hx0 - 90, floor); g.closePath(); g.fill();
  // The ladder up and out.
  g.strokeStyle = '#2c1f14'; g.lineWidth = 5;
  const lx0 = w * 0.47, lx1 = w * 0.53;
  g.beginPath(); g.moveTo(lx0, floor); g.lineTo(lx0, hy - 6); g.moveTo(lx1, floor); g.lineTo(lx1, hy - 6); g.stroke();
  g.lineWidth = 3; g.beginPath();
  for (let y = floor - 16; y > hy; y -= 22) { g.moveTo(lx0, y); g.lineTo(lx1, y); }
  g.stroke();
  // The landing.
  g.fillStyle = '#100b08'; g.fillRect(0, floor, w, h - floor);
  g.fillStyle = 'rgba(255,230,180,0.22)'; g.fillRect(w * 0.3, floor, w * 0.4, 2);
  if (who === 'pell') pellFigure(g, w * 0.64, floor, 2.2, '#0d0a08', t, t > 0.4);
  else if (who === 'pellcup') {
    // He brought the kettle: a cup in his hand, and another waiting on a crate by the ladder.
    const cx = w * 0.4, top = floor - 40;
    g.fillStyle = '#100b08'; g.fillRect(cx - 34, top, 68, 40);
    g.fillStyle = 'rgba(255,230,180,0.16)'; g.fillRect(cx - 34, top, 68, 2); g.fillRect(cx - 34, top + 19, 68, 1);
    teacup(g, cx, top, 2.2, t + 1.3);
    glow(g, cx, top - 14, 70, [255, 190, 110], 0.14);
    pellFigure(g, w * 0.64, floor, 2.2, '#0d0a08', t, false, true, true);
  } else {
    // Only his lantern, its pole planted by the ladder, still lit; the finished map on the boards beneath it.
    const px = w * 0.64, top = floor - 150, sway = Math.sin(t * 1.4) * 2;
    g.strokeStyle = '#0d0a08'; g.lineWidth = 4;
    g.beginPath(); g.moveTo(px, floor); g.lineTo(px, top); g.quadraticCurveTo(px, top - 12, px + 16, top - 8); g.stroke();
    g.lineWidth = 1.5; g.beginPath(); g.moveTo(px + 16, top - 8); g.lineTo(px + 16 + sway, top + 6); g.stroke();
    g.fillStyle = '#0d0a08'; g.fillRect(px + 10 + sway, top + 6, 12, 16);
    glow(g, px + 16 + sway, top + 16, 150, [255, 176, 88], 0.5 + 0.06 * Math.sin(t * 7));
    glow(g, px + 16 + sway, top + 16, 12, [255, 236, 186], 0.95);
    // The map, flat on the boards: contours, his dotted route, and an X at the top.
    g.save(); g.translate(w * 0.3, floor + 30); g.transform(1, 0, -0.55, 0.42, 0, 0);
    g.fillStyle = '#dccba0'; g.fillRect(0, -60, 170, 120);
    g.strokeStyle = 'rgba(90,66,34,0.6)'; g.lineWidth = 2;
    for (let i = 0; i < 4; i++) { g.beginPath(); g.ellipse(70 + i * 8, 4, 60 - i * 13, 40 - i * 9, 0.3, 0, Math.PI * 2); g.stroke(); }
    g.setLineDash([6, 6]); g.strokeStyle = 'rgba(120,40,24,0.85)'; g.lineWidth = 2.5;
    g.beginPath(); g.moveTo(14, 50); g.bezierCurveTo(60, 30, 40, -10, 90, -20); g.lineTo(150, -48); g.stroke(); g.setLineDash([]);
    g.lineWidth = 3; g.beginPath(); g.moveTo(144, -54); g.lineTo(156, -42); g.moveTo(156, -54); g.lineTo(144, -42); g.stroke();
    g.restore();
    g.fillStyle = '#2a211a'; g.beginPath(); g.ellipse(w * 0.36, floor + 12, 11, 6, 0, 0, Math.PI * 2); g.fill();
  }
  motes(g, t, w, h, 46, [255, 250, 230], 1, 7);
}

function farewell(g: G, w: number, h: number, t: number, speaking: number): void {
  g.fillStyle = vgrad(g, h, [[0, '#0a1a1c'], [0.7, '#12302f'], [1, '#081314']]);
  g.fillRect(0, 0, w, h);
  glow(g, w * 0.5, h * 0.3, 420, [180, 230, 210], 0.2);
  // The Works' pipes along the back wall.
  for (let i = 0; i < 9; i++) {
    const x = w * 0.12 + i * w * 0.095, pw = 10 + (i % 3) * 6;
    g.fillStyle = `rgba(30,52,50,${0.55 + (i % 2) * 0.2})`; g.fillRect(x, 0, pw, h);
    g.fillStyle = 'rgba(120,160,150,0.12)'; g.fillRect(x, 0, 2, h);
    g.fillStyle = 'rgba(20,34,33,0.9)'; g.fillRect(x - 3, h * (0.2 + (i % 4) * 0.13), pw + 6, 8);
  }
  cavern(g, w, h, '#040909', 33);
  const hx = w * 0.56, hy = h * 0.36;
  horn(g, hx, hy, 1.4, speaking * (0.6 + 0.4 * Math.sin(t * 2)));
  // By the pipe, for a breath, the old Docent himself: an echo the Works kept. He fades as he speaks.
  const a = Math.min(1, t / 1.2) * Math.max(0, 1 - Math.max(0, t - 2.6) / 2.2);
  if (a > 0.01) {
    const x = hx - 90, y = h * 0.84, col = (k: number): string => `rgba(176,232,216,${(k * a).toFixed(3)})`;
    glow(g, x, y - 70, 160, [150, 225, 205], 0.28 * a);
    g.save(); g.translate(x, y); g.scale(1.5, 1.5); g.translate(-x, -y);
    g.fillStyle = col(0.5);
    // Seated on a crate, turned to the pipe: the long coat, the head bowed to listen, both hands on his cane.
    g.fillStyle = col(0.22); g.fillRect(x - 26, y - 18, 32, 18);
    g.fillStyle = col(0.5);
    g.beginPath();
    g.moveTo(x - 16, y - 18); g.quadraticCurveTo(x - 21, y - 40, x - 12, y - 58);
    g.quadraticCurveTo(x - 4, y - 66, x + 6, y - 60);
    g.quadraticCurveTo(x + 12, y - 48, x + 10, y - 34);
    g.lineTo(x + 28, y - 24); g.quadraticCurveTo(x + 33, y - 20, x + 30, y - 14);
    g.lineTo(x + 30, y - 2); g.lineTo(x + 38, y); g.lineTo(x + 21, y); g.lineTo(x + 21, y - 12);
    g.lineTo(x - 16, y - 12); g.closePath(); g.fill();
    g.beginPath(); g.arc(x + 5, y - 69, 8, 0, Math.PI * 2); g.fill();
    g.strokeStyle = col(0.55); g.lineCap = 'round';
    g.lineWidth = 5; g.beginPath(); g.moveTo(x + 2, y - 54); g.quadraticCurveTo(x + 10, y - 38, x + 24, y - 36); g.stroke();
    g.lineWidth = 2.5; g.beginPath(); g.moveTo(x + 24, y - 38); g.lineTo(x + 27, y); g.stroke();
    g.lineCap = 'butt';
    // Spectacles catching the horn's light.
    g.fillStyle = col(1); g.fillRect(x + 9, y - 71, 4, 2);
    g.restore();
  }
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
    case 'pellcup': flueTop(g, w, h, t, 'pellcup'); break;
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
