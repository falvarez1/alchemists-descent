import { objectFootprint, paramNum } from '@/builder/document';
import type { EditorObject } from '@/builder/document';

export interface BuilderPreviewContext {
  cellW: number;
  cellH: number;
  frame: number;
  selected: boolean;
  toScreen(wx: number, wy: number): { x: number; y: number };
  spriteFrame(obj: EditorObject, frame: number): HTMLCanvasElement | null;
}

export function drawObjectPreview(
  g: CanvasRenderingContext2D,
  obj: EditorObject,
  ctx: BuilderPreviewContext,
): boolean {
  const alpha = obj.hidden ? 0.32 : 1;
  g.save();
  g.globalAlpha *= alpha;
  if (drawFootprintPreview(g, obj, ctx)) {
    g.restore();
    return true;
  }

  const p = ctx.toScreen(obj.x, obj.y);
  const scale = Math.max(1, Math.min(ctx.cellW, ctx.cellH));
  switch (obj.kind) {
    case 'spawn':
      drawSpawn(g, p.x, p.y, scale);
      break;
    case 'enemy':
      drawEnemy(g, obj, p.x, p.y, scale, ctx.frame);
      break;
    case 'pickup':
      drawPickup(g, obj, p.x, p.y, scale);
      break;
    case 'exitPortal':
      drawPortal(g, p.x, p.y, scale, ctx.frame);
      break;
    case 'waystone':
      drawWaystone(g, p.x, p.y, scale);
      break;
    case 'cauldron':
      drawCauldron(g, p.x, p.y, scale);
      break;
    case 'brazier':
      drawBrazier(g, p.x, p.y, scale, ctx.frame);
      break;
    case 'lever':
      drawLever(g, p.x, p.y, scale, obj.rotation);
      break;
    case 'plate':
    case 'scale':
    case 'buoy':
    case 'counterweight':
      drawTriggerPad(g, obj, ctx, p.x, p.y, scale);
      break;
    case 'chargeLatch':
      drawOrb(g, p.x, p.y, scale, '#60a5fa', '#fef08a');
      break;
    case 'runeGlyph':
      drawRune(g, p.x, p.y, scale);
      break;
    case 'bossMarker':
      drawBossMarker(g, p.x, p.y, scale);
      break;
    case 'hazardEmitter':
      drawEmitter(g, obj, p.x, p.y, scale, ctx.frame);
      break;
    case 'sensor':
      drawSensor(g, p.x, p.y, scale, ctx.frame);
      break;
    case 'relay':
      drawRelay(g, p.x, p.y, scale, ctx.frame);
      break;
    case 'decor':
      drawDecor(g, obj, ctx, p.x, p.y, scale);
      break;
    default:
      g.restore();
      return false;
  }
  if (ctx.selected) drawSelectionHalo(g, p.x, p.y, Math.max(8, scale * 5));
  g.restore();
  return true;
}

function drawFootprintPreview(g: CanvasRenderingContext2D, obj: EditorObject, ctx: BuilderPreviewContext): boolean {
  const f = objectFootprint(obj);
  if (!f) return false;
  const a = ctx.toScreen(f.x0, f.y0);
  const b = ctx.toScreen(f.x1 + 1, f.y1 + 1);
  const w = b.x - a.x;
  const h = b.y - a.y;
  if (w <= 0 || h <= 0) return false;
  if (obj.kind === 'door' || obj.kind === 'runeDoor') {
    const rune = obj.kind === 'runeDoor';
    g.fillStyle = rune ? 'rgba(94, 148, 98, 0.72)' : 'rgba(83, 96, 112, 0.78)';
    g.fillRect(a.x, a.y, w, h);
    g.strokeStyle = rune ? 'rgba(187, 247, 208, 0.45)' : 'rgba(191, 219, 254, 0.38)';
    for (let y = a.y + Math.max(3, ctx.cellH * 2); y < b.y; y += Math.max(5, ctx.cellH * 4)) {
      g.beginPath();
      g.moveTo(a.x, y);
      g.lineTo(b.x, y);
      g.stroke();
    }
    return true;
  }
  if (obj.kind === 'valve') {
    g.fillStyle = 'rgba(45, 117, 128, 0.78)';
    g.fillRect(a.x, a.y, w, h);
    g.strokeStyle = 'rgba(94, 234, 212, 0.7)';
    g.strokeRect(a.x + 1, a.y + 1, Math.max(1, w - 2), Math.max(1, h - 2));
    return true;
  }
  if (obj.kind === 'plug') {
    g.fillStyle = plugColor(String(obj.params.material ?? 'wood'));
    g.fillRect(a.x, a.y, w, h);
    g.strokeStyle = 'rgba(255, 237, 213, 0.35)';
    g.strokeRect(a.x, a.y, w, h);
    return true;
  }
  if (obj.kind === 'exitWell') {
    g.fillStyle = 'rgba(20, 24, 33, 0.88)';
    g.fillRect(a.x, a.y, w, h);
    g.strokeStyle = 'rgba(147, 197, 253, 0.5)';
    g.strokeRect(a.x, a.y, w, h);
    return true;
  }
  return false;
}

function drawSpawn(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = '#a7f3d0';
  g.beginPath();
  g.arc(x, y - s * 2.5, s * 1.2, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#34d399';
  g.fillRect(x - s * 1.1, y - s * 1.4, s * 2.2, s * 3.2);
  g.strokeStyle = 'rgba(16, 185, 129, 0.8)';
  g.strokeRect(x - s * 2.4, y - s * 4.2, s * 4.8, s * 6.2);
}

function drawEnemy(g: CanvasRenderingContext2D, obj: EditorObject, x: number, y: number, s: number, frame: number): void {
  const kind = String(obj.params.kind ?? 'slime');
  const bob = Math.sin(frame / 12) * s * 0.35;
  const color = enemyColor(kind);
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y - s * 1.5 + bob, s * 3.2, s * 2.4, 0, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = '#071014';
  g.fillRect(x - s * 1.2, y - s * 2.2 + bob, s * 0.7, s * 0.7);
  g.fillRect(x + s * 0.6, y - s * 2.2 + bob, s * 0.7, s * 0.7);
}

function drawPickup(g: CanvasRenderingContext2D, obj: EditorObject, x: number, y: number, s: number): void {
  const kind = String(obj.params.kind ?? 'goldpile');
  const color = kind === 'heart' ? '#fb7185' : kind === 'key' ? '#fde047' : kind === 'potion' ? '#67e8f9' : '#facc15';
  g.fillStyle = color;
  g.strokeStyle = 'rgba(255,255,255,0.45)';
  if (kind === 'heart') {
    g.beginPath();
    g.moveTo(x, y);
    g.bezierCurveTo(x - s * 3, y - s * 3, x - s * 4, y + s, x, y + s * 3);
    g.bezierCurveTo(x + s * 4, y + s, x + s * 3, y - s * 3, x, y);
    g.fill();
  } else {
    g.beginPath();
    g.moveTo(x, y - s * 3.2);
    g.lineTo(x + s * 3, y);
    g.lineTo(x, y + s * 3.2);
    g.lineTo(x - s * 3, y);
    g.closePath();
    g.fill();
    g.stroke();
  }
}

function drawPortal(g: CanvasRenderingContext2D, x: number, y: number, s: number, frame: number): void {
  const r = s * (4 + Math.sin(frame / 14) * 0.35);
  const grad = g.createRadialGradient(x, y, s, x, y, r);
  grad.addColorStop(0, 'rgba(125, 211, 252, 0.2)');
  grad.addColorStop(0.65, 'rgba(168, 85, 247, 0.55)');
  grad.addColorStop(1, 'rgba(34, 211, 238, 0)');
  g.fillStyle = grad;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = 'rgba(216, 180, 254, 0.9)';
  g.lineWidth = 2;
  g.beginPath();
  g.ellipse(x, y, r * 0.55, r, 0, 0, Math.PI * 2);
  g.stroke();
}

function drawWaystone(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = '#64748b';
  g.beginPath();
  g.moveTo(x, y - s * 5);
  g.lineTo(x + s * 2.2, y + s * 2.5);
  g.lineTo(x - s * 2.2, y + s * 2.5);
  g.closePath();
  g.fill();
  g.fillStyle = '#38bdf8';
  g.fillRect(x - s * 0.45, y - s * 2.5, s * 0.9, s * 2);
}

function drawCauldron(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = '#1f2937';
  g.fillRect(x - s * 3, y - s * 1.2, s * 6, s * 3);
  g.fillStyle = '#22d3ee';
  g.beginPath();
  g.ellipse(x, y - s * 1.2, s * 3, s * 1, 0, 0, Math.PI * 2);
  g.fill();
}

function drawBrazier(g: CanvasRenderingContext2D, x: number, y: number, s: number, frame: number): void {
  g.fillStyle = '#475569';
  g.fillRect(x - s * 2, y, s * 4, s * 1.2);
  g.fillStyle = frame % 18 < 9 ? '#fb923c' : '#facc15';
  g.beginPath();
  g.moveTo(x, y - s * 4);
  g.lineTo(x + s * 2, y);
  g.lineTo(x - s * 2, y);
  g.closePath();
  g.fill();
}

function drawLever(g: CanvasRenderingContext2D, x: number, y: number, s: number, rotation: number): void {
  g.strokeStyle = '#cbd5e1';
  g.lineWidth = Math.max(2, s * 0.8);
  g.beginPath();
  g.moveTo(x, y);
  const angle = ((rotation - 45) * Math.PI) / 180;
  g.lineTo(x + Math.cos(angle) * s * 4, y + Math.sin(angle) * s * 4);
  g.stroke();
  g.fillStyle = '#ef4444';
  g.beginPath();
  g.arc(x + Math.cos(angle) * s * 4, y + Math.sin(angle) * s * 4, s * 1.2, 0, Math.PI * 2);
  g.fill();
}

function drawTriggerPad(
  g: CanvasRenderingContext2D,
  obj: EditorObject,
  ctx: BuilderPreviewContext,
  x: number,
  y: number,
  s: number,
): void {
  const w = Math.max(3, paramNum(obj, 'w', obj.kind === 'plate' ? 5 : 7));
  const a = ctx.toScreen(obj.x - Math.floor(w / 2), obj.y);
  g.fillStyle = obj.kind === 'buoy' ? 'rgba(56, 189, 248, 0.55)' : 'rgba(148, 163, 184, 0.74)';
  g.fillRect(a.x, y - s, w * ctx.cellW, s * 1.2);
  g.strokeStyle = 'rgba(226, 232, 240, 0.45)';
  g.strokeRect(a.x, y - s, w * ctx.cellW, s * 1.2);
  if (obj.kind === 'scale' || obj.kind === 'counterweight') drawOrb(g, x, y - s * 3, s, '#a3e635', '#fef08a');
}

function drawRune(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.strokeStyle = '#86efac';
  g.lineWidth = 2;
  g.beginPath();
  g.moveTo(x, y - s * 4);
  g.lineTo(x + s * 3.5, y);
  g.lineTo(x, y + s * 4);
  g.lineTo(x - s * 3.5, y);
  g.closePath();
  g.stroke();
}

function drawBossMarker(g: CanvasRenderingContext2D, x: number, y: number, s: number): void {
  g.fillStyle = '#ef4444';
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? s * 4.4 : s * 2.1;
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) g.moveTo(px, py);
    else g.lineTo(px, py);
  }
  g.closePath();
  g.fill();
}

function drawEmitter(g: CanvasRenderingContext2D, obj: EditorObject, x: number, y: number, s: number, frame: number): void {
  g.fillStyle = '#475569';
  g.fillRect(x - s * 2, y - s * 2, s * 4, s * 4);
  const angle = ((obj.rotation + 90) * Math.PI) / 180;
  g.fillStyle = '#38bdf8';
  g.beginPath();
  g.moveTo(x + Math.cos(angle) * s * 4, y + Math.sin(angle) * s * 4);
  g.lineTo(x + Math.cos(angle + 2.4) * s * 1.8, y + Math.sin(angle + 2.4) * s * 1.8);
  g.lineTo(x + Math.cos(angle - 2.4) * s * 1.8, y + Math.sin(angle - 2.4) * s * 1.8);
  g.closePath();
  g.fill();
  if (frame > 0) {
    const pulse = ((frame + paramNum(obj, 'phase', 0)) % Math.max(8, paramNum(obj, 'rate', 30))) / Math.max(8, paramNum(obj, 'rate', 30));
    g.globalAlpha *= 1 - pulse * 0.65;
    g.beginPath();
    g.arc(x + Math.cos(angle) * s * (4 + pulse * 8), y + Math.sin(angle) * s * (4 + pulse * 8), s * 1.2, 0, Math.PI * 2);
    g.fill();
  }
}

function drawSensor(g: CanvasRenderingContext2D, x: number, y: number, s: number, frame: number): void {
  drawOrb(g, x, y, s, '#2dd4bf', '#cffafe');
  g.strokeStyle = 'rgba(45, 212, 191, 0.55)';
  g.beginPath();
  g.arc(x, y, s * (4 + (frame > 0 ? Math.sin(frame / 18) * 0.5 : 0)), 0, Math.PI * 2);
  g.stroke();
}

function drawRelay(g: CanvasRenderingContext2D, x: number, y: number, s: number, frame: number): void {
  g.fillStyle = '#312e81';
  g.fillRect(x - s * 2.5, y - s * 2.5, s * 5, s * 5);
  g.strokeStyle = frame > 0 && frame % 40 < 10 ? '#f0abfc' : '#c4b5fd';
  g.strokeRect(x - s * 2.5, y - s * 2.5, s * 5, s * 5);
  g.beginPath();
  g.moveTo(x - s * 1.5, y);
  g.lineTo(x + s * 1.5, y);
  g.stroke();
}

function drawDecor(g: CanvasRenderingContext2D, obj: EditorObject, ctx: BuilderPreviewContext, x: number, y: number, s: number): void {
  const sid = typeof obj.params.spriteId === 'string' ? obj.params.spriteId : '';
  const img = sid ? ctx.spriteFrame(obj, ctx.frame) : null;
  if (img) {
    const a = ctx.toScreen(obj.x - img.width / 2, obj.y - img.height / 2);
    const prevSmooth = g.imageSmoothingEnabled;
    g.imageSmoothingEnabled = false;
    g.drawImage(img, a.x, a.y, img.width * ctx.cellW, img.height * ctx.cellH);
    g.imageSmoothingEnabled = prevSmooth;
    return;
  }
  g.fillStyle = typeof obj.params.color === 'string' ? obj.params.color : 'rgba(214,230,245,0.85)';
  g.font = '600 9px monospace';
  g.fillText(String(obj.params.text ?? (sid ? 'sprite?' : 'note')).slice(0, 40), x + s * 2, y + s);
}

function drawOrb(g: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string, shine: string): void {
  g.fillStyle = fill;
  g.beginPath();
  g.arc(x, y, s * 2.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = shine;
  g.beginPath();
  g.arc(x - s * 0.8, y - s * 0.8, s * 0.65, 0, Math.PI * 2);
  g.fill();
}

function drawSelectionHalo(g: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  g.strokeStyle = 'rgba(74, 222, 128, 0.85)';
  g.lineWidth = 1.5;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.stroke();
}

function enemyColor(kind: string): string {
  if (kind.includes('acid')) return '#a3e635';
  if (kind === 'wisp') return '#67e8f9';
  if (kind === 'mage') return '#c084fc';
  if (kind === 'bat') return '#94a3b8';
  if (kind === 'golem' || kind === 'colossus') return '#78716c';
  if (kind === 'bomber') return '#f97316';
  if (kind === 'leviathan') return '#22d3ee';
  return '#84cc16';
}

function plugColor(material: string): string {
  if (material === 'glass') return 'rgba(165, 243, 252, 0.55)';
  if (material === 'metal') return 'rgba(148, 163, 184, 0.82)';
  if (material === 'stone') return 'rgba(120, 113, 108, 0.82)';
  if (material === 'coal') return 'rgba(31, 41, 55, 0.9)';
  if (material === 'ash') return 'rgba(156, 163, 175, 0.72)';
  if (material === 'sand') return 'rgba(250, 204, 21, 0.65)';
  return 'rgba(146, 64, 14, 0.82)';
}
