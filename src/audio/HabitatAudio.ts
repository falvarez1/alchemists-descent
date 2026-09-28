import { PLAYER_H, PLAYER_HALF_W } from '@/core/types';
import type { Ctx, Enemy, Projectile } from '@/core/types';
import type { SfxId } from '@/content/audio/sfxCues';
import { VIEW_H, VIEW_W } from '@/config/constants';
import { Cell, isLiquid } from '@/sim/CellType';
import { audioFault } from '@/audio/failSafe';

/** Sustained cues for projectiles in flight. */
const TRAVEL: Partial<Record<Projectile['type'], SfxId>> = {
  bomb: 'spell.bomb.fuse.loop',
  blackhole: 'spell.blackhole.loop',
  wisp: 'spell.wisp.loop',
  meteor: 'spell.meteor.loop',
  fireball: 'proj.fireball.loop',
};
const MAX_TRAVEL_LOOPS = 5;
/** Moths this close to the wand tip are circling the lantern; this many make a swarm you hear. */
const MOTH_EAR = 28;
const MOTH_SWARM_MIN = 3;
const MOTH_SWARM_FULL = 9;

/** Material beds: what the scanner counts, the loop it drives, and how many sampled cells is "full". */
interface MaterialBed { id: SfxId; full: number }
const FIRE: MaterialBed = { id: 'mat.fire.loop', full: 90 };
const LAVA: MaterialBed = { id: 'mat.lava.loop', full: 160 };
const WATER: MaterialBed = { id: 'mat.water.loop', full: 45 };
const ACID: MaterialBed = { id: 'mat.acid.loop', full: 70 };
const STEAM: MaterialBed = { id: 'mat.steam.loop', full: 80 };
const SPARK: MaterialBed = { id: 'mat.electric.loop', full: 40 };
const FUSE: MaterialBed = { id: 'mat.fuse.loop', full: 6 };
/** Fire in living plants (flame at a leaf, a vine or living wood; a smouldering trunk): the brush crackles over the roar. */
const PLANT_FIRE: MaterialBed = { id: 'flora.burn.loop', full: 30 };
const BEDS = [FIRE, LAVA, WATER, ACID, STEAM, SPARK, FUSE];
/** The scan samples every STRIDE-th cell of the view in x and y. */
const STRIDE = 3;
const SCAN_EVERY = 8;
/** Scans with no plant fire before the brush can "catch" again (8 scans ≈ 1 s). */
const PLANT_FIRE_REARM = 8;
/** Leaves go up in a flash: the brush crackle rings on, fading by this much per scan, after the last leaf burns. */
const PLANT_FIRE_TAIL = 0.78;

/**
 * Brushing through plants: which sweep, by what he is pushing through. Under
 * water it is kelp; thin stems standing in the Cisterns are reeds; anything
 * else leafy (grass tufts, fern beds, fire-lilies, fallen crowns, litter) is a
 * soft sweep of blades. Restrained: one sweep per BRUSH_EVERY cells walked
 * and never closer than BRUSH_GAP ticks, so a meadow is a hush, not a drum.
 */
const BRUSH = {
  grass: { sfx: 'flora.brush.grass' },
  reeds: { sfx: 'flora.brush.reeds' },
  kelp: { sfx: 'flora.brush.kelp' },
} as const satisfies Record<string, { sfx: SfxId }>;
const BRUSH_EVERY = 14;
const BRUSH_GAP = 20;
/** Foliage cells (sampled every 2nd cell of his body) before it counts as pushing through. */
const BRUSH_MIN = 3;

/**
 * The world's own voices, derived each tick from what is actually there:
 * the wizard's stride (satchel phials clinking; iron grates ring; deep water
 * sloshes), creatures breathing and hopping where you can hear them, the roar
 * of a meteor or a fizzing fuse following the projectile, and the materials on
 * screen — a lava lake bubbles, a spreading fire roars, a running stream
 * trickles, a live wire crackles, a burning thicket snaps and pops — at a
 * level set by how much of each the camera sees and panned to where it is;
 * and the plants he pushes through (grass, reeds, kelp) sweep past him. If
 * the grid can't explain it, it doesn't sound.
 */
export class HabitatAudio {
  private lastX = 0;
  private lastY = 0;
  private stride = 0;
  private readonly idleAt = new WeakMap<Enemy, number>();
  private readonly airborne = new WeakMap<Enemy, boolean>();
  private readonly travelKey = new WeakMap<Projectile, string>();
  private readonly waveKey = new WeakMap<object, string>();
  private travelSerial = 0;
  private brushX = 0;
  private brushY = 0;
  private brushTravel = 0;
  private brushWait = 0;
  /** Plant fire on screen (armed = the next fire in the brush "catches" audibly), and quiet scans since. */
  private plantFireLit = false;
  private plantFireQuiet = 0;
  /** The brush crackle's level and place, held a moment past the last burning leaf. */
  private plantFireLevel = 0;
  private plantFireX = 0;
  private plantFireY = 0;

  /** Runs inside the game tick: an audio error is reported (audio/failSafe) and never aborts it. */
  update(ctx: Ctx): void {
    try {
      this.hear(ctx);
    } catch (error) {
      audioFault('HabitatAudio', error);
    }
  }

  private hear(ctx: Ctx): void {
    // The ears sit at the camera centre in every mode: a sound on the left of
    // the screen is in the left ear, and a cinematic pan to the engine room
    // brings its clatter to the centre with it. The wizard is near the centre
    // (the camera leads him by a few dozen cells), inside the full-volume
    // plateau of audio/mix.ts, so his neighbourhood never fades.
    ctx.audio.setListener(ctx.camera.x + VIEW_W / 2, ctx.camera.y + VIEW_H / 2);
    if (ctx.state.frameCount % SCAN_EVERY === 0) this.scanMaterials(ctx);
    if (ctx.state.mode !== 'play' || ctx.player.dead) return;
    this.strideLayer(ctx);
    this.brushLayer(ctx);
    this.travelLoops(ctx);
    this.creatureLife(ctx);
    this.shockWaves(ctx);
    if (ctx.state.frameCount % SCAN_EVERY === 4) this.mothSwarm(ctx);
  }

  /**
   * A Colossus stomp's shockwaves rumble as they run along the real floor —
   * each one a sustained grind that follows its ridge and thins as it dies, so
   * the jump can be timed by ear as well as by eye.
   */
  private shockWaves(ctx: Ctx): void {
    for (const e of ctx.enemies) {
      if (e.kind !== 'colossus' || !e.boss) continue;
      for (const wave of e.boss.waves) {
        let key = this.waveKey.get(wave);
        if (!key) { key = `creature.colossus.wave.loop#${++this.travelSerial}`; this.waveKey.set(wave, key); }
        ctx.audio.sfx('creature.colossus.wave.loop', wave.x, wave.y, { key, gain: Math.min(1, 0.35 + wave.life / 40) });
      }
    }
  }

  /**
   * Moths circling the lantern: a soft papery flutter where the swarm is,
   * swelling with its size. Hood the lantern and the swarm drifts off — and
   * so does the sound.
   */
  private mothSwarm(ctx: Ctx): void {
    const p = ctx.player;
    const tipX = p.x + Math.cos(p.aimAngle) * 9, tipY = p.y - 9 + Math.sin(p.aimAngle) * 9;
    let n = 0, sx = 0, sy = 0;
    for (const c of ctx.critters.list) {
      if ((c.kind !== 'moth' && c.kind !== 'ashmoth') || c.heldBy || (c.dead ?? 0) > 0) continue;
      if (Math.abs(c.x - tipX) > MOTH_EAR || Math.abs(c.y - tipY) > MOTH_EAR) continue;
      n++; sx += c.x; sy += c.y;
    }
    if (n < MOTH_SWARM_MIN) return;
    ctx.audio.sfx('organism.moth.swarm.loop', sx / n, sy / n, { gain: Math.min(1, Math.sqrt(n / MOTH_SWARM_FULL)) });
  }

  /** Every ~13 cells of walking: the kit on his belt, iron underfoot, or deep water. */
  private strideLayer(ctx: Ctx): void {
    const { player, world } = ctx;
    const distance = Math.hypot(player.x - this.lastX, player.y - this.lastY);
    this.lastX = player.x; this.lastY = player.y;
    if (distance < 10 && player.grounded) this.stride += distance;
    if (this.stride <= 13) return;
    this.stride %= 13;
    const x = Math.floor(player.x), y = Math.min(world.height - 1, Math.floor(player.y + 1));
    const type = world.inBounds(x, y) ? world.type(x, y) : Cell.Stone;
    const torso = world.inBounds(x, y - 5) ? world.type(x, y - 5) : Cell.Empty;
    const kind = isLiquid(torso) ? 'water' : type === Cell.Metal ? 'metal' : 'stone';
    ctx.audio.worldSound?.(kind, player.x, player.y);
  }

  /** Pushing through grass, reeds, kelp or fallen leaves: a soft sweep now and then, never every step. */
  private brushLayer(ctx: Ctx): void {
    const { player, world } = ctx;
    this.brushTravel += Math.min(10, Math.hypot(player.x - this.brushX, player.y - this.brushY));
    this.brushX = player.x; this.brushY = player.y;
    if (this.brushWait > 0) this.brushWait--;
    const speed = Math.hypot(player.vx, player.vy);
    if (speed < 0.35 || this.brushTravel < BRUSH_EVERY || this.brushWait > 0) return;
    const x0 = Math.floor(player.x - PLAYER_HALF_W), x1 = Math.floor(player.x + PLAYER_HALF_W);
    const y0 = Math.floor(player.y - PLAYER_H + 1), y1 = Math.floor(player.y);
    const types = world.types;
    let leaves = 0, stems = 0;
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0; x <= x1; x += 2) {
        if (!world.inBounds(x, y)) continue;
        const i = world.idx(x, y), t = types[i];
        if (t === Cell.Leaf) leaves++;
        // A stem is living wood one cell wide (a reed, a kelp stalk, a lily's stalk) — never a trunk.
        else if (t === Cell.Trunk && types[i - 1] !== Cell.Trunk && types[i + 1] !== Cell.Trunk) stems++;
      }
    }
    const n = leaves + stems;
    if (n < BRUSH_MIN) return;
    this.brushTravel = 0;
    this.brushWait = BRUSH_GAP;
    const tx = Math.floor(player.x), ty = Math.floor(player.y - 6);
    const underwater = world.inBounds(tx, ty) && isLiquid(world.types[world.idx(tx, ty)]);
    const brush = underwater ? BRUSH.kelp : ctx.levels?.current?.def.biome === 'flooded' && stems >= leaves ? BRUSH.reeds : BRUSH.grass;
    const gain = Math.min(1, 0.35 + n / 16) * Math.min(1, 0.4 + speed / 2);
    ctx.audio.sfx(brush.sfx, undefined, undefined, { gain });
  }

  private travelLoops(ctx: Ctx): void {
    const lx = ctx.camera.x + VIEW_W / 2, ly = ctx.camera.y + VIEW_H / 2;
    const flying: Array<{ p: Projectile; id: SfxId; d: number }> = [];
    for (const p of ctx.projectiles) {
      const id = TRAVEL[p.type];
      if (!id) continue;
      flying.push({ p, id, d: Math.hypot(p.x - lx, p.y - ly) });
    }
    flying.sort((a, b) => a.d - b.d);
    for (const { p, id } of flying.slice(0, MAX_TRAVEL_LOOPS)) {
      let key = this.travelKey.get(p);
      if (!key) { key = `${id}#${++this.travelSerial}`; this.travelKey.set(p, key); }
      // A charging singularity swells as it grows.
      const gain = p.type === 'blackhole' ? Math.min(1.2, 0.5 + (p.vortexRad ?? 0) / 40) : 1;
      ctx.audio.sfx(id, p.x, p.y, { key, gain });
    }
  }

  private creatureLife(ctx: Ctx): void {
    const frame = ctx.state.frameCount;
    const lx = ctx.camera.x + VIEW_W / 2, ly = ctx.camera.y + VIEW_H / 2;
    for (const e of ctx.enemies) {
      if (e.hp <= 0) continue;
      const near = Math.abs(e.x - lx) < 360 && Math.abs(e.y - ly) < 240;
      // Slimes announce every launch; the landing is theirs to squelch.
      if (e.kind === 'slime' || e.kind === 'acidslime') {
        const up = !e.grounded && e.vy < -0.6;
        if (up && !this.airborne.get(e) && near) ctx.audio.at(e.x, e.y - 4, () => ctx.audio.creature(e.kind, 'hop'));
        this.airborne.set(e, !e.grounded);
      }
      if (frame % 12 !== 0) continue;
      // Weavers and Rillbacks on the move: their own limbs and bodies.
      if ((e.kind === 'weaver' || e.kind === 'rillback') && Math.abs(e.vx) + Math.abs(e.vy) >= 0.1
        && (frame + (e.mind?.phase ?? 0)) % 48 < 12) {
        ctx.audio.worldSound?.(e.kind, e.x, e.y);
        if (Math.hypot(e.x - ctx.player.x, e.y - ctx.player.y) < 330) {
          ctx.events.emit('habitatSound', { kind: e.kind, x: e.x, y: e.y });
        }
      }
      // Idle voices: an unbothered creature in earshot mutters now and then.
      if (!near || e.alerted || e.sleeping) continue;
      const next = this.idleAt.get(e);
      if (next === undefined) { this.idleAt.set(e, frame + 120 + Math.floor(Math.random() * 360)); continue; }
      if (frame < next) continue;
      this.idleAt.set(e, frame + 240 + Math.floor(Math.random() * 420));
      ctx.audio.at(e.x, e.y - 6, () => ctx.audio.creature(e.kind, 'idle'), e.kind === 'leviathan' || e.kind === 'colossus' || e.kind === 'rimewarden' ? 720 : 380);
    }
  }

  /**
   * Count the materials the camera sees (every STRIDE-th cell) and drive a
   * sustained loop per material at a level set by how much is there, panned to
   * where it is. Flowing water is only water that moved this substep.
   */
  private scanMaterials(ctx: Ctx): void {
    const world = ctx.world;
    const x0 = Math.max(0, Math.floor(ctx.camera.x)), y0 = Math.max(0, Math.floor(ctx.camera.y));
    const x1 = Math.min(world.width - 2, x0 + VIEW_W), y1 = Math.min(world.height - 2, y0 + VIEW_H);
    const types = world.types, charge = world.charge, life = world.life, moved = world.moved, tick = world.movedTick, W = world.width;
    const count = new Map<MaterialBed, { n: number; sx: number; sy: number }>();
    const add = (bed: MaterialBed, x: number, y: number): void => {
      const c = count.get(bed);
      if (c) { c.n++; c.sx += x; c.sy += y; } else count.set(bed, { n: 1, sx: x, sy: y });
    };
    for (let y = y0 + 1; y < y1; y += STRIDE) {
      const row = y * W;
      for (let x = x0 + 1; x < x1; x += STRIDE) {
        const i = row + x;
        const t = types[i];
        if (t === Cell.Empty) continue;
        if (t === Cell.Fire || t === Cell.Ember) {
          add(FIRE, x, y);
          // Fire eating black powder is a fuse.
          if (types[i + 1] === Cell.Gunpowder || types[i - 1] === Cell.Gunpowder || types[i + W] === Cell.Gunpowder) add(FUSE, x, y);
          // Fire in the brush: a flame at (or a cell from) a leaf, a vine or living wood.
          else if (nearPlant(types, i, W)) add(PLANT_FIRE, x, y);
        } else if (t === Cell.Trunk && life[i] > 0) add(PLANT_FIRE, x, y); // a trunk smouldering in place
        else if (t === Cell.Lava) add(LAVA, x, y);
        else if (t === Cell.Water) { if (moved[i] === tick) add(WATER, x, y); }
        else if (t === Cell.Acid) add(ACID, x, y);
        else if (t === Cell.Steam) add(STEAM, x, y);
        if (charge[i] > 0) add(SPARK, x, y);
      }
    }
    const ly = ctx.camera.y + VIEW_H / 2;
    for (const bed of BEDS) {
      const c = count.get(bed);
      if (!c || c.n < 2) continue;
      // Loudness grows with the square root of the amount: one torch is a
      // flicker, a burning room is a roar, and it never runs away.
      const level = Math.min(1, Math.sqrt(c.n / bed.full));
      // Panned to the centroid; the vertical offset is dropped (the whole
      // view is "here"), so only bearing, not height, moves it.
      ctx.audio.sfx(bed.id, c.sx / c.n, ly, { gain: level });
    }
    this.plantFire(ctx, count.get(PLANT_FIRE), ly);
  }

  /**
   * Fire in the brush. The moment it catches — a thicket, a fallen crown, a
   * bed of grass going up — is a whoomph before it is a crackle (in the Kiln
   * its blooms flare), once per fire: it re-arms after a second with none.
   * Then the brushy crackle, over the fire's own roar, while leaves and
   * living wood burn — held a moment past the last of them, because leaves
   * go up in a flash and the scan only looks every few frames.
   */
  private plantFire(ctx: Ctx, c: { n: number; sx: number; sy: number } | undefined, ly: number): void {
    if (c && c.n >= 2) {
      this.plantFireQuiet = 0;
      this.plantFireLevel = Math.max(this.plantFireLevel, Math.min(1, Math.sqrt(c.n / PLANT_FIRE.full)));
      this.plantFireX = c.sx / c.n;
      this.plantFireY = c.sy / c.n;
      if (!this.plantFireLit) {
        this.plantFireLit = true;
        const kiln = ctx.levels?.current?.def.biome === 'volcanic';
        ctx.audio.sfx(kiln ? 'flora.firelily.flare' : 'flora.catch', this.plantFireX, this.plantFireY, { gain: Math.min(1, 0.5 + c.n / 12) });
      }
    } else {
      if (this.plantFireLit && ++this.plantFireQuiet >= PLANT_FIRE_REARM) this.plantFireLit = false;
      this.plantFireLevel *= PLANT_FIRE_TAIL;
    }
    if (this.plantFireLevel < 0.06) { this.plantFireLevel = 0; return; }
    ctx.audio.sfx(PLANT_FIRE.id, this.plantFireX, ly, { gain: this.plantFireLevel });
  }
}

/** What a brush fire eats: foliage, vines, pods and living wood (sim/elements/flora). */
function isPlant(t: number | undefined): boolean {
  return t === Cell.Leaf || t === Cell.Trunk || t === Cell.Vines || t === Cell.Seed;
}

/** A plant cell within two cells of i (the cross, and the diagonals): leaves go up faster than a scan looks. */
function nearPlant(types: Uint8Array, i: number, W: number): boolean {
  return isPlant(types[i + 1]) || isPlant(types[i - 1]) || isPlant(types[i + W]) || isPlant(types[i - W])
    || isPlant(types[i + 2]) || isPlant(types[i - 2]) || isPlant(types[i + 2 * W]) || isPlant(types[i - 2 * W])
    || isPlant(types[i + W + 1]) || isPlant(types[i + W - 1]) || isPlant(types[i - W + 1]) || isPlant(types[i - W - 1]);
}
