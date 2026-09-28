// Classification rules for scripts/audit-world-sanity.mjs: raw grid metrics in,
// {cls, sev, why} flags out. Kept apart so the rules can be retuned and the
// saved JSON re-reported (scripts/audit-world-sanity-report.mjs) without a rerun.
// Classes: SUBMERGED, FLOATING, BURIED, BLOCKED, ABSURD. Severity: P1 visible or
// broken, P2 odd, P3 nitpick.

/* ---------------- classification (Node side, so rules can be retuned without a rerun) ---------------- */

export function classify(item, arrivalItem, level) {
  const m = item.m, flags = [];
  const f = (cls, sev, why) => flags.push({ cls, sev, why });
  const liqName = (t) => Object.keys(t ?? {}).join('+') || 'liquid';
  switch (item.cat) {
    case 'spawn':
      if (m.depth >= 3 || m.liqF > 0.15) f('SUBMERGED', m.depth >= 8 ? 'P1' : 'P2', `arrival spot under ${m.depth} cells of ${liqName(m.liqT)} (${Math.round(m.liqF * 100)}% of body)`);
      if (m.blkF > 0.05) f('BURIED', 'P1', `arrival body box ${Math.round(m.blkF * 100)}% solid (${liqName(m.blkT)})`);
      break;
    case 'camp': {
      const d = m.depth;
      const worst = Math.max(d.pell, d.bedroll, d.crate, d.stove, d.pole);
      if (worst >= 3 || m.lowLiqF > 0.12) f('SUBMERGED', worst >= 6 || m.pellLiqF > 0.3 ? 'P1' : 'P2', `camp in ${liqName(m.liqT)}: depth pell ${d.pell}, bedroll ${d.bedroll}, crate ${d.crate}, stove ${d.stove}, pole ${d.pole}; Pell body ${Math.round(m.pellLiqF * 100)}% submerged; props band ${Math.round(m.lowLiqF * 100)}%`);
      else if (worst >= 1) f('SUBMERGED', 'P3', `camp floor wet: max depth ${worst} (bedroll ${d.bedroll}, crate ${d.crate}, stove ${d.stove})`);
      if (m.lantern && /water|oil|brine|acid|lava|slime|toxic|blood/.test(m.lantern)) f('ABSURD', 'P1', `the camp lantern burns inside ${m.lantern}`);
      if (m.pellBlkF > 0.05 && m.pellPresent) f('BURIED', m.pellBlkF > 0.25 ? 'P1' : 'P2', `Pell's body box ${Math.round(m.pellBlkF * 100)}% solid`);
      if (m.propsBlkF > 0.06) f('BURIED', m.propsBlkF > 0.2 ? 'P1' : 'P2', `camp props region ${Math.round(m.propsBlkF * 100)}% solid (${liqName(m.propsBlkT)})`);
      for (const [k, v] of Object.entries(m.supportProps)) if (v < 0.4) f('FLOATING', 'P2', `camp ${k} over air (support ${Math.round(v * 100)}%)`);
      if (m.gapPell > 2 && m.pellPresent) f('FLOATING', m.gapPell >= 6 ? 'P1' : 'P2', `Pell stands ${m.gapPell} cells above the ground`);
      else if (m.gapPell > 0 && m.pellPresent) f('FLOATING', 'P3', `Pell hovers ${m.gapPell} cell(s) over a notch in the camp floor`);
      if (m.hazards.haz > 0 || m.hazards.fire > 3) f('ABSURD', 'P2', `hazard in camp: ${m.hazards.haz} hazard cells, ${m.hazards.fire} fire/ember`);
      if (!m.reach) f('BLOCKED', 'P1', 'camp not reachable by a 9x17 alchemist from the arrival');
      else if (!m.dryReach) f('BLOCKED', 'P2', 'camp reachable only through lava/acid/toxic');
      break;
    }
    case 'valve':
      if (m.depthWheel >= 3 || m.depthStage >= 4 || m.stageLiqF > 0.12) f('SUBMERGED', m.depthStage >= 8 || m.stageLiqF > 0.35 ? 'P1' : 'P2', `valve/echo stage in ${liqName(m.liqT)}: wheel depth ${m.depthWheel}, stage max depth ${m.depthStage}, stage ${Math.round(m.stageLiqF * 100)}% liquid`);
      if (m.valveBlkF > 0.08) f('BURIED', m.valveBlkF > 0.3 ? 'P1' : 'P2', `valve body ${Math.round(m.valveBlkF * 100)}% solid (${liqName(m.valveBlkT)})`);
      if (m.stageBlkF > 0.08) f('BURIED', m.stageBlkF > 0.25 ? 'P1' : 'P2', `echo stage ${Math.round(m.stageBlkF * 100)}% solid (${liqName(m.stageBlkT)}): the ghosts walk through rock`);
      if (m.support < 0.5) f('FLOATING', 'P2', `valve pipe over air (support ${Math.round(m.support * 100)}%, gap ${m.gap})`);
      if (m.stageSupport < 0.6) f('FLOATING', 'P3', `echo stage floor ${Math.round(m.stageSupport * 100)}% solid: the ghosts walk on air`);
      if (!m.reach) f('BLOCKED', 'P1', 'valve stage not reachable from the arrival');
      else if (!m.dryReach) f('BLOCKED', 'P2', 'valve reachable only through lava/acid/toxic');
      break;
    case 'pipe':
      if (m.hornLiqF > 0.1) f('SUBMERGED', 'P2', `speaking-pipe horn ${Math.round(m.hornLiqF * 100)}% in ${liqName(m.liqT)}`);
      else if (m.depth >= 4) f('SUBMERGED', 'P3', `pipe's standing spot under ${m.depth} cells of ${liqName(m.liqT)}`);
      if (m.standBlkF > 0.1) f('BURIED', 'P2', `pipe's standing spot ${Math.round(m.standBlkF * 100)}% solid (${liqName(m.standBlkT)})`);
      if (m.support < 0.4) f('FLOATING', 'P3', `pipe floor ${Math.round(m.support * 100)}% solid (gap ${m.gap})`);
      if (!m.reach) f('BLOCKED', 'P3', 'pipe spot not reachable');
      break;
    case 'flue':
      if (m.shaftBlkF > 0.25) f('BLOCKED', 'P1', `Kiln flue shaft ${Math.round(m.shaftBlkF * 100)}% solid (${liqName(m.shaftBlkT)})`);
      if (m.passageBlkF > 0.3) f('BLOCKED', 'P1', `flue passage ${Math.round(m.passageBlkF * 100)}% solid`);
      if (m.shaftLiqF > 0.15) f('SUBMERGED', 'P2', `flue shaft ${Math.round(m.shaftLiqF * 100)}% liquid before the escape`);
      break;
    case 'waystone':
      if (!m.lit && m.bowlLiqF > 0.15) f('BLOCKED', 'P1', `unlit waystone's bowl holds ${liqName(m.bowlLiqT)} (${Math.round(m.bowlLiqF * 100)}%): fire cannot burn there`);
      if (m.depth >= 3) f('SUBMERGED', m.depth >= 12 ? 'P1' : 'P2', `waystone stands in ${m.depth} cells of liquid`);
      if (m.bowlBlkF > 0.3) f('BURIED', 'P2', `waystone bowl ${Math.round(m.bowlBlkF * 100)}% filled with ${liqName(m.bowlBlkT)}`);
      if (m.steleBlkF > 0.12) f('BURIED', m.steleBlkF > 0.35 ? 'P1' : 'P2', `waystone stele drawn over rock (${Math.round(m.steleBlkF * 100)}% solid: ${liqName(m.steleBlkT)})`);
      if (m.support < 0.5) f('FLOATING', m.gap >= 3 ? 'P1' : 'P2', `waystone stele and bowl float ${m.gap} cells above the floor (bowl stamp ${m.bowlStone ? 'intact' : 'gone'})`);
      if (!m.lit && !m.bowlStone && m.gap >= 3) f('BLOCKED', 'P2', `unlit waystone's heat rect hangs ${m.gap} cells over the floor: poured lava/embers fall through (only a sustained jet can light it)`);
      if (!m.reach) f('BLOCKED', 'P1', 'waystone not reachable');
      else if (!m.dryReach) f('BLOCKED', 'P2', 'waystone reachable only through lava/acid/toxic');
      break;
    case 'cauldron':
      if (m.outsideLiqF > 0.12 || m.depthOutside >= 4) f('SUBMERGED', m.outsideLiqF > 0.35 ? 'P1' : 'P2', `cauldron stands in ${liqName(m.liqT)} (depth ${m.depthOutside}, ${Math.round(m.outsideLiqF * 100)}% of its surround)`);
      if (m.vesselBlkF > 0.15) f('BURIED', m.vesselBlkF > 0.4 ? 'P1' : 'P2', `cauldron vessel drawn over rock (${Math.round(m.vesselBlkF * 100)}% solid: ${liqName(m.vesselBlkT)})`);
      if (m.support < 0.5) f('FLOATING', 'P1', `cauldron floats over the floor (base ${Math.round(m.support * 100)}% supported)`);
      if (!m.reach) f('BLOCKED', 'P2', 'cauldron not reachable');
      break;
    case 'portal':
      if (level === 'd1') break; // the Lower Bell's grate, not a portal ring
      if (m.ringLiqF > 0.1 || m.standDepth >= 4) f('SUBMERGED', m.ringLiqF > 0.3 ? 'P1' : 'P2', `portal ring ${Math.round(m.ringLiqF * 100)}% in ${liqName(m.liqT)}, standing depth ${m.standDepth}`);
      if (m.ringBlkF > 0.1) f('BURIED', m.ringBlkF > 0.3 ? 'P1' : 'P2', `portal ring ${Math.round(m.ringBlkF * 100)}% solid (${liqName(m.ringBlkT)})`);
      if (m.floorSupport < 0.4) f('FLOATING', 'P3', `portal shrine floor ${Math.round(m.floorSupport * 100)}% solid`);
      if (!m.reach) f('BLOCKED', 'P1', 'portal not reachable');
      else if (!m.dryReach) f('BLOCKED', 'P2', 'portal reachable only through lava/acid/toxic');
      break;
    case 'pickup':
      if (m.gated) break;
      if (m.inBlk && m.enclosed) f('BURIED', item.kind === 'key' ? 'P1' : 'P3', `${item.kind} entombed in ${m.atName} (no open cell within 4; sunk ${m.embed} rows)`);
      else if (m.inBlk && m.embed >= 3) f('BURIED', item.kind === 'key' ? 'P1' : 'P2', `${item.kind} sunk ${m.embed} rows into ${m.atName}`);
      else if (m.inBlk) f('BURIED', 'P3', `${item.kind} sits ${m.embed} row(s) into the ${m.atName} floor (glyph clipped)`);
      else if (m.glyphBlkF > 0.35) f('BURIED', 'P3', `${item.kind} glyph ${Math.round(m.glyphBlkF * 100)}% over rock`);
      if (m.glyphLiqF > 0.3) {
        const lava = /lava|acid|toxic/.test(liqName(m.liqT));
        f('SUBMERGED', lava ? 'P2' : 'P3', `${item.kind} lies under ${m.depth} cells of ${liqName(m.liqT)}`);
      }
      if (m.gap > 1 && !m.glyphLiqF) f('FLOATING', 'P2', `${item.kind} hangs ${m.gap} cells above the ground (vy ${m.vy})`);
      if (m.collectable === false && (item.kind === 'key' || m.reachCrawl)) f('BLOCKED', item.kind === 'key' ? 'P1' : 'P3', `${item.kind} cannot be collected from any reachable standing spot (Pickups' clear-line rule): it must be dug out`);
      if (item.kind === 'key' && !m.reachWiz) f('BLOCKED', 'P1', 'the golden key is not reachable by the alchemist');
      else if (item.kind === 'key' && !m.dryWiz) f('BLOCKED', 'P2', 'the golden key is reachable only through lava/acid/toxic');
      else if (!m.reachCrawl) f('BLOCKED', 'P3', `${item.kind} sealed away (not even a crawler reaches it)`);
      break;
    case 'mechanism': {
      const k = item.kind;
      if (k.startsWith('door')) { if (m.state === 0 && m.metalF < 0.6) f('ABSURD', 'P3', `closed door only ${Math.round(m.metalF * 100)}% metal`); break; }
      if (m.liqF !== undefined && m.liqF > 0.25 && /^(lever|brazier|plate)/.test(k)) f('SUBMERGED', k.startsWith('brazier') ? 'P1' : 'P2', `${k} ${Math.round(m.liqF * 100)}% in ${liqName(m.liqT)}`);
      if (k.startsWith('brazier') && m.bowlLiqF > 0.3 && m.state === 0) f('BLOCKED', 'P1', `unlit brazier bowl holds ${liqName(m.bowlLiqT)}`);
      if (m.blkF !== undefined && m.blkF > 0.25 && /^(lever|brazier)/.test(k)) f('BURIED', 'P2', `${k} region ${Math.round(m.blkF * 100)}% solid (${liqName(m.blkT)})`);
      if (m.blkF !== undefined && m.blkF > 0.5 && /^plate/.test(k)) f('BURIED', 'P3', `plate buried under ${liqName(m.blkT)} (${Math.round(m.blkF * 100)}%)`);
      if (m.support !== undefined && m.support < 0.4) f('FLOATING', m.gap >= 4 ? 'P1' : 'P2', `${k} drawn in mid-air (support ${Math.round(m.support * 100)}%, ${m.gap} cells above the floor)`);
      if (m.broken !== null && m.broken !== undefined && !k.startsWith('plug')) f('BLOCKED', 'P2', `${k} wrecked (${m.bodyIntact}/${m.bodyN} body cells left): fail-open ${m.broken === 0 ? 'has opened' : 'will open'} its gate, the puzzle never happens`);
      if (m.reach === false) f('BLOCKED', 'P1', `${k} not reachable by hand`);
      else if (m.dryReach === false) f('BLOCKED', 'P2', `${k} reachable only through lava/acid/toxic`);
      break;
    }
    case 'runevault':
      if (m.liqF > 0.3) f('SUBMERGED', 'P3', `rune glyph in ${liqName(m.liqT)}`);
      if (m.blkF > 0.4) f('BURIED', 'P2', `rune glyph drawn in rock (${Math.round(m.blkF * 100)}%)`);
      if (!m.reachCrawl) f('BLOCKED', 'P2', 'rune glyph has no open line from the route');
      break;
    case 'lumen':
      if (m.budLiq) f('ABSURD', 'P2', `lumen bloom heart under ${m.depthUnder} cells of liquid`);
      if (m.petalsInRock > m.petals * 0.3) f('BLOCKED', 'P2', `${m.petalsInRock}/${m.petals} petal cells are rock: the bridge cannot unfurl`);
      if (m.petalsInLiquid > m.petals * 0.3) f('SUBMERGED', 'P3', `${m.petalsInLiquid}/${m.petals} petal cells are liquid`);
      break;
    case 'web':
      if (m.coreBlkF > 0.5) f('BURIED', 'P2', `weaver lair web centred in rock (${Math.round(m.coreBlkF * 100)}%)`);
      if (m.discLiqF > 0.2) f('SUBMERGED', 'P3', `weaver web ${Math.round(m.discLiqF * 100)}% under ${liqName(m.liqT)}`);
      break;
    case 'prefab': {
      const a = arrivalItem?.m;
      if (a && m.liqOpenF - a.liqOpenF > 0.2 && m.liq - a.liq > 150) f('SUBMERGED', 'P2', `${item.kind} flooded while settling: liquid ${Math.round(a.liqOpenF * 100)}% -> ${Math.round(m.liqOpenF * 100)}% of open cells (${liqName(m.liqT)})`);
      if (a && a.liqOpenF - m.liqOpenF > 0.2 && a.liq - m.liq > 150) f('ABSURD', 'P3', `${item.kind} drained while settling: ${Math.round(a.liqOpenF * 100)}% -> ${Math.round(m.liqOpenF * 100)}%`);
      if (a && m.open < a.open * 0.85 && a.open - m.open > 150) f('BURIED', 'P2', `${item.kind} filled in while settling: open cells ${a.open} -> ${m.open} (${liqName(m.blkT)})`);
      if (m.haz > 30 && !/kiln|colossus|lava|forge|slag/.test(item.kind)) f('ABSURD', 'P3', `${item.kind} holds ${m.haz} hazard cells`);
      break;
    }
    case 'boss':
      if (m.spawnBlkF > 0.1) f('BURIED', 'P1', `${item.kind} spawn box ${Math.round(m.spawnBlkF * 100)}% solid`);
      if (item.kind !== 'leviathan' && m.spawnLiqF > 0.25) f('SUBMERGED', 'P2', `${item.kind} arena spawn ${Math.round(m.spawnLiqF * 100)}% ${liqName(m.liqT)}`);
      if (!m.reach) f('BLOCKED', 'P1', `${item.kind} arena not reachable`);
      break;
    case 'enemy': {
      const kind = item.kind.replace('(roost)', '');
      if (m.coreBlkF > 0.35 && kind !== 'stonemaw') f('BURIED', m.coreBlkF > 0.7 ? 'P1' : 'P2', `${kind} body core ${Math.round(m.coreBlkF * 100)}% inside ${liqName(m.blkT)}`);
      if (!m.swimmer && m.liqF > 0.6 && !/wisp/.test(kind)) f('SUBMERGED', 'P3', `${kind} ${Math.round(m.liqF * 100)}% under ${liqName(m.liqT)}`);
      if (m.swimmer && m.liqF < 0.2 && level !== 'd1') f('ABSURD', 'P3', `${kind} (a water creature) out of liquid`);
      if (m.sleeping && m.ceiling > 6) f('FLOATING', 'P2', `roosting ${kind} hangs ${m.ceiling} cells below the nearest ceiling`);
      break;
    }
    case 'critter': {
      const k = item.kind;
      const water = k === 'fish' || k === 'leech';
      const flyer = /moth|firefly|fly$/.test(k);
      if (m.inBlk) f('BURIED', 'P3', `${k} inside ${m.cell}`);
      if (water && !m.inLiq && !m.dead) f('ABSURD', 'P3', `${k} out of the water (in ${m.cell})`);
      if (flyer && m.inLiq) f('SUBMERGED', 'P3', `${k} flying inside ${m.cell}`);
      if (/beetle|isopod|mite/.test(k) && m.adjBlk === 0 && !m.inLiq) f('FLOATING', 'P3', `${k} crawler with no surface within 2 cells`);
      if (m.anchorSurface === false && /glowworm|puffer|snapjaw/.test(k)) f('FLOATING', 'P3', `${k} anchor has no surface within 2 cells`);
      break;
    }
    case 'light':
      if (m.inLiq && !/lava/.test(m.cell)) f('ABSURD', m.depth > 4 ? 'P2' : 'P3', `authored light burns inside ${m.cell} (depth ${m.depth})`);
      break;
    case 'plant':
      if (m.depth >= 2) f('SUBMERGED', 'P3', `habitat crown rooted under ${m.depth} cells of liquid`);
      if (m.gap > 2) f('FLOATING', 'P2', `habitat crown ${m.gap} cells above ground`);
      break;
    default: break;
  }
  return flags;
}


/** Whole-grid scan results (flora in hazards, floating growth) as flagged items. */
export function scanFlags(scan) {
  const out = [];
  for (const s of scan.floraInHazard) {
    if (s.touchHaz < 2) continue;
    const kinds = Object.keys(s.kinds).join('+');
    out.push({ cat: 'flora', kind: kinds, id: `flora-haz-${s.x}-${s.y}`, x: s.x, y: s.y, box: s.box, m: s,
      flags: [{ cls: 'ABSURD', sev: s.size >= 12 ? 'P2' : 'P3', why: `${kinds} (${s.size} cells) touching lava/acid/toxic (${s.touchHaz} contacts)` }] });
  }
  for (const s of scan.floatingGrowth) {
    const kinds = Object.keys(s.kinds).join('+');
    out.push({ cat: 'flora', kind: kinds, id: `flora-float-${s.x}-${s.y}`, x: s.x, y: s.y, box: s.box, m: s,
      flags: [{ cls: 'FLOATING', sev: s.size >= 20 ? 'P2' : 'P3', why: `${kinds} (${s.size} cells) ${s.onLiquid ? 'resting only on liquid' : 'touching no ground'}` }] });
  }
  return out;
}
