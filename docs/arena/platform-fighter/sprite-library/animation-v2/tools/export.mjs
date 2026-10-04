import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { findFigures } from './figures.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(await fs.readFile(path.join(root, 'registration.json'), 'utf8'));
const { frameSize: size } = config;
const requested=new Set(process.argv.slice(2));
const selected=requested.size?config.clips.filter(c=>requested.has(c.id)):config.clips;
if(requested.size && selected.length!==requested.size)throw new Error('Unknown requested clip');
const prior=requested.size?JSON.parse(await fs.readFile(path.join(root,'manifest.json'),'utf8')).clips:[];
const inventory = { version: 2, status: 'animation-validation-candidate', simulationHz: 60, frameSize: size, clips: prior.filter(c=>!requested.has(c.id)) };
for (const clip of selected) {
  const pivot=clip.pivot??config.pivot,effect=!!clip.kind&&clip.kind!=='fighter';
  const scale = clip.scale ?? config.scale;
  const raw = await sharp(path.join(root, clip.source)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = raw.info;
  const bounds = (axis, n) => {
    const length = axis === 'x' ? w : h, cross = axis === 'x' ? h : w, lines = [0];
    if(effect)return Array.from({length:n+1},(_,i)=>Math.round(length*i/n));
    for (let k = 1; k < n; k++) {
      const ideal = length * k / n, radius = Math.floor(length / n * .18);
      let best = Math.round(ideal), score = Infinity;
      for (let p = Math.round(ideal) - radius; p <= Math.round(ideal) + radius; p++) {
        let count = Math.abs(p - ideal) * .05;
        for (let offset = -2; offset <= 2; offset++) for (let q = 0; q < cross; q++) {
          const x = axis === 'x' ? p + offset : q, y = axis === 'x' ? q : p + offset;
          if (raw.data[(y * w + x) * 4 + 3] >= 8) count++;
        }
        if (count < score) { best = p; score = count; }
      }
      lines.push(best);
    }
    return [...lines, length];
  };
  let bodies=null,extractionReview=null;
  if(!effect)try { bodies=findFigures(raw.data,w,h,clip.cols,clip.count); }
  catch(error) { extractionReview=String(error.message);console.warn(clip.id+': grid fallback requires review: '+extractionReview); }
  const xs = bodies?null:bounds('x', clip.cols), ys = bodies?null:bounds('y', clip.rows);
  const overlays = [], frames = [];
  const dest = path.join(root, 'exports', clip.id);
  await fs.mkdir(dest, { recursive: true });
  const cols = Math.min(4,clip.count), rows = Math.ceil(clip.count / cols);
  for (let i = 0; i < clip.count; i++) {
    const col = i % clip.cols, row = Math.floor(i / clip.cols);
    const figure=bodies?.figures[i];
    const x0 = bodies?Math.max(0,figure.left-4):xs[col], x1 = bodies?Math.min(w,figure.right+5):xs[col+1];
    const y0 = bodies?Math.max(0,figure.top-4):ys[row], y1 = bodies?Math.min(h,figure.bottom+5):ys[row+1];
    const cw = x1 - x0, ch = y1 - y0, labels = new Int32Array(cw * ch), queue = new Int32Array(cw * ch);
    let label = 0, largest = 0, largestCount = 0;
    for (let seed = 0; seed < labels.length; seed++) {
      const sx = seed % cw, sy = Math.floor(seed / cw);
      if (labels[seed] || raw.data[((sy + y0) * w + sx + x0) * 4 + 3] < 8) continue;
      label++; let start = 0, end = 1; queue[0] = seed; labels[seed] = label;
      while (start < end) {
        const p = queue[start++], px = p % cw, py = Math.floor(p / cw);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx, ny = py + dy, np = ny * cw + nx;
          if (nx < 0 || ny < 0 || nx >= cw || ny >= ch || labels[np]) continue;
          if (raw.data[((ny + y0) * w + nx + x0) * 4 + 3] < 8) continue;
          labels[np] = label; queue[end++] = np;
        }
      }
      if (end > largestCount) { largest = label; largestCount = end; }
    }
    const selected = Buffer.alloc(cw * ch * 4);
    for (let p = 0; p < labels.length; p++) {
      if (!effect && (bodies?bodies.labels[(Math.floor(p/cw)+y0)*w+p%cw+x0] !== figure.label:labels[p] !== largest)) continue;
      const src = ((Math.floor(p / cw) + y0) * w + p % cw + x0) * 4;
      raw.data.copy(selected, p * 4, src, src + 4);
    }
    const alpha = (x,y) => selected[((y-y0)*cw+x-x0)*4+3];
    let left = w, right = 0, top = h, bottom = 0, solid = 0, sourceEdge = 0;
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (alpha(x,y) < 48) continue;
      left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); solid++;
      if (x === x0 || x === x1 - 1 || y === y0 || y === y1 - 1) sourceEdge++;
    }
    if (!effect && solid < 500) throw new Error('Missing figure: ' + clip.id + '/' + i);
    // Planted feet use the middle of the boot contact span, never the silhouette center.
    let bootLeft = w, bootRight = 0;
    for (let y = Math.max(y0, bottom - 6); y <= bottom; y++) for (let x = x0; x < x1; x++) {
      if (alpha(x,y) < 128) continue;
      bootLeft = Math.min(bootLeft, x); bootRight = Math.max(bootRight, x);
    }
    const sourceRoot = clip.roots?.[i] ?? (effect
      ? clip.kind==='prop'&&clip.registration==='ground'
        ? {x:(left+right)/2,y:bottom+1}
        : {x:(x0+x1)/2,y:y0+(y1-y0)*(clip.registration==='ground'?.75:.5)}
      : { x: (bootLeft + bootRight) / 2, y: bottom + 1 });
    const extraction = { left: x0, top: y0, width: x1 - x0, height: y1 - y0 };
    const rw = Math.round(extraction.width * scale), rh = Math.round(extraction.height * scale);
    const ox = Math.round(pivot.x - (sourceRoot.x - x0) * scale);
    const oy = Math.round(pivot.y - (sourceRoot.y - y0) * scale);
    const content = solid ? { x: ox + (left-x0)*scale, y: oy + (top-y0)*scale, w: (right-left+1)*scale, h: (bottom-top+1)*scale } : {x:pivot.x,y:pivot.y,w:0,h:0};
    if(content.x<3||content.y<3||content.x+content.w>size-3||content.y+content.h>size-3)
      throw new Error('Figure outside export gutter: '+clip.id+'/'+i+' '+JSON.stringify(content));
    const cropLeft=Math.max(0,-ox),cropTop=Math.max(0,-oy),cropWidth=Math.min(rw,size-ox)-cropLeft,cropHeight=Math.min(rh,size-oy)-cropTop;
    const cell = await sharp(selected, {raw:{width:cw,height:ch,channels:4}}).resize(rw, rh, { kernel: 'nearest' })
      .extract({left:cropLeft,top:cropTop,width:cropWidth,height:cropHeight}).png().toBuffer();
    const frame = await sharp({ create: { width: size, height: size, channels: 4, background: '#00000000' } })
      .composite([{ input: cell, left: Math.max(0,ox), top: Math.max(0,oy) }]).png().toBuffer();
    const name = String(i).padStart(3, '0') + '.png';
    await fs.writeFile(path.join(dest, name), frame);
    overlays.push({ input: frame, left: i % cols * size, top: Math.floor(i / cols) * size });
    frames.push({ index: i, image: name, rect: { x: i % cols * size, y: Math.floor(i / cols) * size, w: size, h: size },
      phase: clip.phaseNames?.[i] ?? null,
      durationTicks: clip.durationsTicks[i], durationMs: clip.durationsTicks[i] * 1000 / 60, pivot, sourceRoot,
      sourceRect: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, sourceBoundaryPixels: sourceEdge,
      content,
      sha256: createHash('sha256').update(frame).digest('hex') });
  }
  await sharp({ create: { width: cols * size, height: rows * size, channels: 4, background: '#00000000' } })
    .composite(overlays).png().toFile(path.join(dest, 'atlas.png'));
  const data = { version: 2, id: clip.id, kind:clip.kind??'fighter', image: 'atlas.png', status: 'animation-validation-candidate',
    source: clip.source, extractionMethod:effect?'fixed-asset-grid':bodies?'connected-figure':'grid-fallback', extractionReview, detachedComponents:bodies?.detachedComponents??[], description: clip.description ?? '', review: clip.review ?? null, frameSize: size, grid: { columns: cols, rows }, simulationHz: 60, scale, pivot,
    anchorType:clip.anchorType??(effect?clip.registration:'feet'), registration:clip.registration,
    loop: clip.loop, endBehavior: clip.endBehavior??(clip.loop ? 'loop' : 'hold'), totalTicks: clip.durationsTicks.reduce((a,b)=>a+b,0),
    facing: { authored: 'right', left: 'mirror-around-root' }, frames };
  if(clip.phaseNames) {
    data.attackPhaseTicks = Object.fromEntries(['startup','active','recovery'].map(phase=>[phase,frames.filter(f=>f.phase===phase).reduce((n,f)=>n+f.durationTicks,0)]));
    data.timingSource = 'src/config/stockAttacks.ts';
  }
  await fs.writeFile(path.join(dest, 'animation.json'), JSON.stringify(data, null, 2) + '\n');
  const atlasMap={frames:Object.fromEntries(frames.map(f=>[f.image,{frame:f.rect,rotated:false,trimmed:false,
    spriteSourceSize:{x:0,y:0,w:size,h:size},sourceSize:{w:size,h:size},pivot:{x:pivot.x/size,y:pivot.y/size}}])),
    meta:{app:'Alchemists Descent sprite exporter',version:'2',image:'atlas.png',format:'RGBA8888',size:{w:cols*size,h:rows*size},scale:'1'},
    animations:{[clip.id.split('/').at(-1)]:frames.map(f=>f.image)}};
  await fs.writeFile(path.join(dest,'atlas.json'),JSON.stringify(atlasMap,null,2)+'\n');
  inventory.clips.push({ ...data, image: 'exports/' + clip.id + '/atlas.png', data: 'exports/' + clip.id + '/animation.json',atlasMap:'exports/'+clip.id+'/atlas.json' });
  console.log(clip.id + ': ' + frames.length + ' frames, ' + data.totalTicks + ' ticks, ' + new Set(frames.map(f=>f.sha256)).size + ' unique PNGs');
}
inventory.clips.sort((a,b)=>config.clips.findIndex(c=>c.id===a.id)-config.clips.findIndex(c=>c.id===b.id));
await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(inventory, null, 2) + '\n');
await fs.writeFile(path.join(root, 'manifest.js'), 'window.ANIMATION_LIBRARY = ' + JSON.stringify(inventory) + ';\n');
