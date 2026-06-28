import type { BodyMaterial, Ctx, LevelRuntime, Mechanism, MechanismsApi } from '@/core/types';
import { mechanismTriggersFor } from '@/core/mechanisms';
import { blocksEntity, Cell, isGas, isLiquid } from '@/sim/CellType';
import { COLOR_FN, EMPTY_COLOR, fireColor, packRGB } from '@/sim/colors';
import {
  BUOY_LATCH_FRAMES,
  DEFAULT_TRIGGER_LATCH_FRAMES,
  SENSOR_MOMENTARY_LATCH_FRAMES,
  SENSOR_SCAN_MOD,
  setDoorCells,
  setValveCells,
} from '@/core/mechanismFactories';
export {
  BUOY_LATCH_FRAMES,
  DEFAULT_TRIGGER_LATCH_FRAMES,
  SENSOR_MOMENTARY_LATCH_FRAMES,
  SENSOR_SCAN_MOD,
  makeBrazier,
  makeBuoy,
  makeChargeLatch,
  makeCounterweight,
  makeDispenser,
  makeDoor,
  makeLever,
  makePlate,
  makePlug,
  makeRelay,
  makeScale,
  makeSensor,
  makeValve,
  setDoorCells,
  setValveCells,
} from '@/core/mechanismFactories';

/* ---------------- the runtime system ---------------- */

export class Mechanisms implements MechanismsApi {
  private readonly sequenceScratch: Mechanism[] = [];
  private readonly edgeScratch: boolean[] = [];

  constructor(private ctx: Ctx) {
    // Explosions / projectile impacts / dig hits all announce themselves here.
    ctx.events.on('structureStrike', ({ x, y, radius }) => this.strike(this.ctx, x, y, radius));
  }

  update(ctx: Ctx): void {
    if (ctx.state.mode !== 'play' || ctx.state.paused) return;
    const runtime = ctx.levels.current;
    if (!runtime) return;
    const world = ctx.world;
    const list = runtime.mechanisms;

    // ---- 1) Each sensor reads the raw grid ----
    for (const m of list) {
      if (m.kind === 'door') continue;

      // Fail-open rule: a wrecked mechanism groans, then its gate falls open.
      // Physics can never hard-lock progression. Plugs are exempt: their
      // body being destroyed is their JOB — the plug branch below fires them.
      if (m.kind !== 'plug' && m.broken === undefined && m.body && ctx.state.frameCount % 30 === 0) {
        let intact = 0;
        for (const [bx, by] of m.body) {
          if (!world.inBounds(bx, by)) continue;
          const t = world.types[world.idx(bx, by)];
          if (t === Cell.Metal || t === Cell.Stone || blocksEntity(t)) intact++;
        }
        if (intact < m.body.length / 2) {
          m.broken = 1800; // 30 seconds of groaning
          ctx.audio.groan();
          ctx.events.emit('toast', { text: 'THE MECHANISM GROANS — SOMETHING GIVES WAY' });
        }
      }
      if (m.broken !== undefined && m.broken > 0) {
        m.broken--;
        if (m.broken % 360 === 0) {
          ctx.audio.groan();
          ctx.particles.burst(m.x, m.y - 3, 4, null, () => packRGB(130, 95, 80), 0.6, {
            grav: 0.06,
          });
        }
        if (m.broken === 0) {
          ctx.events.emit('toast', { text: 'THE BROKEN GATE FALLS OPEN' });
        }
        continue; // a dying mechanism no longer senses
      }
      if (m.broken === 0) continue;

      if (m.kind === 'lever') {
        // hand-pull in progress: the arm sweeps, then the flip lands
        if (m.pullT !== undefined && m.pullT > 0) {
          m.pullT--;
          if (m.pullT === 0) this.flipLever(ctx, m);
        }
      } else if (m.kind === 'plate') {
        const was = m.pressed === true;
        m.pressed = this.sensePlate(ctx, m);
        if (m.pressed) m.state = DEFAULT_TRIGGER_LATCH_FRAMES; // stays open ~7s after weight lifts
        else if (m.state > 0) m.state--;
        if (m.pressed && !was) {
          ctx.audio.tone(140, 90, 0.1, 'square', 0.14);
          ctx.particles.burst(m.x + m.w / 2, m.y - 1, 3, null, () => packRGB(190, 160, 80), 0.45, {
            grav: 0.04,
          });
        }
      } else if (m.kind === 'scale' && m.zone) {
        // SAND SCALE: pure material weight in the pan — bodies don't count,
        // only what you pour or drop stays poured
        let weight = 0;
        for (let X = m.zone.x0; X <= m.zone.x1; X++) {
          for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
            if (!world.inBounds(X, Y)) continue;
            const t = world.types[world.idx(X, Y)];
            if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
          }
        }
        m.reading = weight;
        const enough = weight >= (m.threshold ?? 24);
        if (enough && m.state === 0) {
          ctx.audio.tone(180, 120, 0.14, 'square', 0.15);
          ctx.particles.burst(m.x + m.w / 2, m.y - 2, 4, null, () => packRGB(220, 170, 65), 0.55, {
            grav: 0.05,
            glow: 0.8,
          });
        }
        if (enough) m.state = DEFAULT_TRIGGER_LATCH_FRAMES;
        else if (m.state > 0) m.state--;
      } else if (m.kind === 'buoy' && m.zone) {
        // SLUICE: pooled liquid lifts the float
        let liquid = 0;
        for (let X = m.zone.x0; X <= m.zone.x1; X++) {
          for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
            if (!world.inBounds(X, Y)) continue;
            if (isLiquid(world.types[world.idx(X, Y)])) liquid++;
          }
        }
        m.reading = liquid;
        const afloat = liquid >= (m.threshold ?? 28);
        if (afloat && m.state === 0) {
          ctx.audio.bubble();
          ctx.particles.burst(m.x, m.y - 3, 5, null, () => packRGB(130, 205, 255), 0.6, {
            grav: -0.02,
            glow: 0.8,
          });
        }
        if (afloat) m.state = BUOY_LATCH_FRAMES; // generous latch: pools drain slowly anyway
        else if (m.state > 0) m.state--;
      } else if (m.kind === 'chargelatch' && m.zone) {
        // CHARGE-LATCH: one spark anywhere in the zone latches it forever —
        // lightning, electrified water, even a conducting enemy's blood
        if (m.state === 0) {
          let charged = false;
          for (let X = m.zone.x0; X <= m.zone.x1 && !charged; X++) {
            for (let Y = m.zone.y0; Y <= m.zone.y1 && !charged; Y++) {
              if (world.inBounds(X, Y) && world.charge[world.idx(X, Y)] > 0) charged = true;
            }
          }
          if (charged) {
            m.state = 1;
            ctx.audio.zap();
            ctx.particles.burst(m.x, m.y - 3, 12, null, () => packRGB(120, 200, 255), 2.0, {
              glow: 2.4,
              grav: -0.01,
            });
            ctx.events.emit('toast', { text: 'THE COIL DRINKS THE SPARK — LATCHED' });
          }
        }
      } else if (m.kind === 'plug') {
        // A plug WANTS its body destroyed: when breakFrac of its recorded
        // cells are gone or TRANSFORMED — burned, dissolved, blasted, dug,
        // by any cause — it fires once. The material is the break profile.
        if (m.state === 0 && m.body && m.body.length > 0 && (ctx.state.frameCount + m.id) % 8 === 0) {
          const mat = m.material ?? Cell.Stone;
          let intact = 0;
          for (const [bx, by] of m.body) {
            if (world.inBounds(bx, by) && world.types[world.idx(bx, by)] === mat) intact++;
          }
          m.reading = intact;
          const frac = m.breakFrac ?? 0.5;
          if (intact <= m.body.length * (1 - frac)) this.breakPlug(ctx, m, false);
        }
      } else if (m.kind === 'sensor' && m.zone) {
        // GENERIC SENSOR: bounded zone read on a 4-frame cadence (staggered
        // by id); the latch covers the scan latency.
        const latch = m.latch ?? 'timed';
        if (!(latch === 'permanent' && m.state === 1)) {
          if ((ctx.state.frameCount + m.id) % SENSOR_SCAN_MOD === 0) {
            m.reading = this.senseZone(ctx, m);
          }
          const hot = (m.reading ?? 0) >= (m.threshold ?? 8);
          const was = this.satisfied(m);
          if (latch === 'permanent') {
            if (hot) m.state = 1;
          } else if (latch === 'momentary') {
            // hold just long enough to bridge the scan cadence
            if (hot) m.state = SENSOR_MOMENTARY_LATCH_FRAMES;
            else if (m.state > 0) m.state--;
          } else {
            if (hot) m.state = m.latchFrames ?? DEFAULT_TRIGGER_LATCH_FRAMES;
            else if (m.state > 0) m.state--;
          }
          if (!was && this.satisfied(m)) {
            ctx.audio.tone(220, 110, 0.1, 'triangle', 0.12);
            ctx.particles.burst(m.x, m.y - 2, 4, null, () => packRGB(140, 220, 190), 0.5, {
              grav: 0.02,
              glow: 0.9,
            });
          }
        }
      } else if (m.kind === 'counterweight' && m.zone) {
        // COUNTERWEIGHT: pure material mass in the bucket — bodies don't
        // count, only what stays poured. Latches PERMANENTLY at threshold.
        if (m.state === 0 && (ctx.state.frameCount + m.id) % SENSOR_SCAN_MOD === 0) {
          let weight = 0;
          for (let X = m.zone.x0; X <= m.zone.x1; X++) {
            for (let Y = m.zone.y0; Y <= m.zone.y1; Y++) {
              if (!world.inBounds(X, Y)) continue;
              const t = world.types[world.idx(X, Y)];
              if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
            }
          }
          m.reading = weight;
          if (weight >= (m.threshold ?? 30)) {
            m.state = 1;
            ctx.audio.tone(150, 200, 0.18, 'square', 0.16);
            ctx.particles.burst(m.x + m.w / 2, m.y - 2, 6, null, () => packRGB(200, 170, 90), 0.7, {
              grav: 0.05,
              glow: 0.9,
            });
            ctx.events.emit('toast', { text: 'THE COUNTERWEIGHT SETTLES — SOMETHING SHIFTS' });
          }
        }
      } else if (m.kind === 'brazier') {
        if (m.state === 0) {
          // any flame in the bowl zone latches it permanently
          let lit = false;
          for (let dx = -1; dx <= 1 && !lit; dx++) {
            for (let dy = 1; dy <= 3 && !lit; dy++) {
              const X = m.x + dx,
                Y = m.y - dy;
              if (!world.inBounds(X, Y)) continue;
              const t = world.types[world.idx(X, Y)];
              if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) lit = true;
            }
          }
          if (lit) {
            m.state = 1;
            ctx.audio.brazier();
            ctx.particles.burst(m.x, m.y - 3, 12, Cell.Fire, fireColor, 1.6, {
              glow: 2.2,
              grav: -0.02,
            });
            ctx.events.emit('toast', { text: 'A BRAZIER ROARS TO LIFE' });
          }
        } else if (ctx.state.frameCount % 6 === 0) {
          // keep it burning: re-seed a flame in the bowl
          const X = m.x + Math.floor(Math.random() * 3) - 1,
            Y = m.y - 1 - Math.floor(Math.random() * 2);
          if (world.inBounds(X, Y) && world.types[world.idx(X, Y)] === Cell.Empty) {
            const i = world.idx(X, Y);
            world.replaceCellAt(i, Cell.Fire, fireColor());
            world.life[i] = 18 + Math.floor(Math.random() * 22);
          }
        }
      }
    }

    // ---- 2) Actuators aggregate their triggers: doors, valves, and relays
    //         all read the things whose targetId points at them (default
    //         AND; Burning Seals wires three braziers to one gate). Broken
    //         triggers count as satisfied once their groan timer runs out.
    for (const door of list) {
      if (door.kind === 'valve') {
        this.updateValve(ctx, door, runtime);
        continue;
      }
      if (door.kind === 'relay') {
        this.updateRelay(ctx, door, runtime);
        continue;
      }
      if (door.kind === 'dispenser') {
        this.updateDispenser(ctx, door, runtime);
        continue;
      }
      if (door.kind !== 'door') continue;

      // Door retraction in progress: the gate slides up, 6 cells a frame,
      // dust shaking off the rising edge.
      if (door.dissolve && door.dissolve.length > 0) {
        for (let n = 0; n < 6 && door.dissolve.length; n++) {
          const [X, Y] = door.dissolve.pop()!;
          if (!world.inBounds(X, Y)) continue;
          const i = world.idx(X, Y);
          if (world.types[i] === Cell.Metal) {
            world.clearCellAt(i);
            if (Math.random() < 0.25) {
              ctx.particles.spawn(
                X,
                Y,
                (Math.random() - 0.5) * 0.8,
                -0.3 - Math.random() * 0.5,
                null,
                packRGB(150, 160, 180),
                26,
                { glow: 1.0, grav: 0.05 },
              );
            }
          }
        }
        if (door.dissolve.length === 0) door.dissolve = undefined;
      }

      // Trigger index preserves LIST ORDER (sequence doors read it).
      const triggers = mechanismTriggersFor(runtime, door.id);
      const hasTrigger = triggers.length > 0;
      const want = hasTrigger && this.aggregateWant(ctx, door, triggers);
      if (door.state === 0 && door.closePending === true && !want) {
        setDoorCells(ctx, door, false);
      }
      if (hasTrigger && (door.state === 1) !== want) {
        if (want) {
          // The circuit closes: a spark races from each satisfied trigger to
          // its gate — the wiring teaches itself.
          for (const t of triggers) {
            this.sparkLine(ctx, t.x, t.y - 2, door.x + door.w / 2, door.y + door.h / 2);
          }
        }
        setDoorCells(ctx, door, want);
        ctx.audio.doorGrind();
      }
    }

    // Rune vaults: dissolve struck doors bottom-up, a few cells per frame
    for (const v of runtime.runeVaults) {
      if (!v.active || v.door.length === 0) continue;
      for (let n = 0; n < 3 && v.door.length; n++) {
        const cell = v.door.pop()!;
        const [dx2, dy2] = cell;
        if (world.inBounds(dx2, dy2) && world.types[world.idx(dx2, dy2)] === Cell.Stone) {
          const i = world.idx(dx2, dy2);
          world.clearCellAt(i);
          ctx.particles.spawn(
            dx2,
            dy2,
            (Math.random() - 0.5) * 1.4,
            -0.8 - Math.random(),
            null,
            packRGB(160, 255, 190),
            26,
            { glow: 1.8, grav: 0.02 },
          );
        }
      }
      if (v.door.length === 0) ctx.audio.tone(520, 300, 0.3, 'triangle', 0.12);
    }

    // Builder hazard emitters: drip `burst` real cells on their cadence —
    // the grid does the rest (lava pools, acid eats, water floods). The
    // drip lands one step along `dir` (the object's rotation: 0=down,
    // 90=left, 180=up, 270=right); `phase` staggers banks of emitters.
    if (runtime.emitters) {
      for (const em of runtime.emitters) {
        if ((ctx.state.frameCount + em.phase) % em.rate !== 0) continue;
        const dx = em.dir === 90 ? -1 : em.dir === 270 ? 1 : 0;
        const dy = em.dir === 180 ? -1 : em.dir === 0 ? 1 : 0;
        for (let k = 1; k <= em.burst; k++) {
          const X = em.x + dx * k,
            Y = em.y + dy * k;
          if (!world.inBounds(X, Y)) break;
          const i = world.idx(X, Y);
          if (world.types[i] !== Cell.Empty) continue;
          const fn = COLOR_FN[em.cell];
          world.replaceCellAt(i, em.cell, fn ? fn() : EMPTY_COLOR);
          if (em.cell === Cell.Fire) world.life[i] = 15 + Math.floor(Math.random() * 30);
          else if (em.cell === Cell.Smoke) world.life[i] = 30 + Math.floor(Math.random() * 40);
        }
      }
    }
  }

  /**
   * One actuator's trigger aggregation (doors, valves, relays — extracted
   * verbatim from the door loop; sequence state lives on the actuator).
   */
  private aggregateWant(ctx: Ctx, actuator: Mechanism, triggers: Mechanism[]): boolean {
    let want = false;
    if (actuator.logic === 'or') {
      // ANY satisfied trigger opens (and it closes again when none are)
      want = triggers.some((t) => this.satisfied(t));
    } else if (actuator.logic === 'sequence') {
      // Triggers must FIRE IN ORDER, judged on RISING EDGES — a trigger
      // that merely STAYS satisfied (plate latch, lingering pour) never
      // re-fires the chain. Fail-open holds per step: a fully broken
      // trigger auto-completes its slot (all broken = the chain itself
      // fails open). Completion latches the door open forever.
      if (actuator.seqDone !== true) {
        const chain = this.sequenceScratch;
        chain.length = 0;
        for (const t of triggers) {
          if (t.broken !== 0) chain.push(t);
        }
        // Completion is tracked BY IDENTITY: the cursor is derived each
        // frame as the first chain member not yet fired, so a wrecked
        // trigger collapses its slot whether it sat ahead of the cursor
        // (auto-completes) or behind it (already fired, simply gone).
        const fired = (actuator.seqFired ??= {});
        let cursor = 0;
        while (cursor < chain.length && fired[chain[cursor].id] === true) cursor++;
        if (cursor >= chain.length) {
          actuator.seqDone = true; // includes the every-step-wrecked chain
        } else {
          const prev = (actuator.seqPrev ??= {});
          const edges = this.edgeScratch;
          edges.length = 0;
          for (const t of chain) {
            const sat = this.satisfied(t);
            edges.push(sat && prev[t.id] !== true);
            prev[t.id] = sat;
          }
          if (edges[cursor]) {
            fired[chain[cursor].id] = true;
            cursor++;
            ctx.audio.tone(300 + cursor * 90, 110, 0.1, 'triangle', 0.12); // step chime
            if (cursor >= chain.length) actuator.seqDone = true;
          } else if (edges.some((e, n) => e && n > cursor)) {
            // The chain breaks: forget all progress and spit the
            // resettable mechanisms back out so the player can retry at
            // once. (Braziers/charge latches can never un-fire — the
            // Builder validator refuses to wire them into sequences.)
            for (const k of Object.keys(fired)) delete fired[Number(k)];
            cursor = 0;
            for (const t of chain) {
              if (t.kind === 'plate' || t.kind === 'scale' || t.kind === 'buoy' || t.kind === 'lever') {
                t.state = 0;
                if (t.kind === 'plate') t.pressed = false;
              }
            }
            ctx.audio.tone(120, 200, 0.14, 'sawtooth', 0.1); // sour break
          }
          actuator.seq = cursor; // derived, for HUD/probes
        }
      }
      want = actuator.seqDone === true;
    } else {
      // default AND: every trigger must be satisfied (generated levels)
      want = true;
      for (const t of triggers) {
        if (!this.satisfied(t)) {
          want = false;
          break;
        }
      }
    }
    return want;
  }

  /**
   * VALVE actuator update: tick its retraction, aggregate its triggers like
   * a door, honor oneShot / autoClose. A valve with no triggers is inert
   * (Builder validation flags it).
   */
  private updateValve(ctx: Ctx, m: Mechanism, runtime: LevelRuntime): void {
    // retraction in progress: the gate slides away, 4 cells a frame
    if (m.dissolve && m.dissolve.length > 0) {
      const world = ctx.world;
      const mat = m.material ?? Cell.Metal;
      for (let n = 0; n < 4 && m.dissolve.length; n++) {
        const [X, Y] = m.dissolve.pop()!;
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        if (world.types[i] === mat) {
          world.clearCellAt(i);
          if (Math.random() < 0.25) {
            ctx.particles.spawn(
              X,
              Y,
              (Math.random() - 0.5) * 0.7,
              -0.2 - Math.random() * 0.4,
              null,
              packRGB(150, 145, 125),
              22,
              { glow: 0.8, grav: 0.05 },
            );
          }
        }
      }
      if (m.dissolve.length === 0) m.dissolve = undefined;
    }

    const triggers = mechanismTriggersFor(runtime, m.id, m);
    if (triggers.length === 0) {
      if (m.state === 0 && m.closePending === true) setValveCells(ctx, m, false);
      return;
    }
    const want = this.aggregateWant(ctx, m, triggers);
    const rising = want && m.prevWant !== true;
    m.prevWant = want;

    if (m.state === 1) {
      if (m.oneShot === true) return; // stays open once fired
      if (m.closeT !== undefined) {
        // timed valve: force-close when the timer runs out; it reopens only
        // on a FRESH rising edge (a lingering latched trigger must not
        // bounce it straight open again)
        m.closeT--;
        if (m.closeT <= 0) {
          m.closeT = undefined;
          setValveCells(ctx, m, false);
          ctx.audio.doorGrind();
        }
        return;
      }
      if (!want) {
        setValveCells(ctx, m, false);
        ctx.audio.doorGrind();
      }
    } else {
      const timed = m.autoCloseFrames !== undefined && m.autoCloseFrames > 0;
      if (timed ? rising : want) {
        for (const t of triggers) {
          if (this.satisfied(t)) this.sparkLine(ctx, t.x, t.y - 2, m.x + m.w / 2, m.y + m.h / 2);
        }
        setValveCells(ctx, m, true);
        ctx.audio.doorGrind();
      } else if (m.closePending === true) {
        setValveCells(ctx, m, false);
      }
    }
  }

  /**
   * RELAY actuator update: inputs satisfied -> arm the fuse -> fire ONCE.
   * A fired relay (state 1) counts as a satisfied trigger for its own
   * target; a destroyed relay reaches the same state through the generic
   * fail-open watch (broken 0 = satisfied).
   */
  private updateRelay(ctx: Ctx, m: Mechanism, runtime: LevelRuntime): void {
    if (m.state === 1) return; // fired forever
    if (m.broken !== undefined) return; // groaning/dead: the watch owns it
    if (m.fuseT === undefined) {
      const triggers = mechanismTriggersFor(runtime, m.id, m);
      if (triggers.length === 0) return;
      if (this.aggregateWant(ctx, m, triggers)) {
        m.fuseT = Math.max(0, Math.floor(m.delayFrames ?? 0));
        if (m.fuseT > 0) ctx.audio.tone(260, 90, 0.08, 'triangle', 0.1); // armed tick
      }
    }
    if (m.fuseT !== undefined) {
      if (m.fuseT > 0) {
        m.fuseT--;
        return;
      }
      this.fireRelay(ctx, m, runtime.mechanisms);
    }
  }

  /** The relay fires: latch, spark toward the target, run the output action. */
  private fireRelay(ctx: Ctx, m: Mechanism, list: Mechanism[]): void {
    m.state = 1;
    m.fuseT = undefined;
    ctx.audio.tone(420, 140, 0.12, 'triangle', 0.14);
    ctx.particles.burst(m.x, m.y - 2, 8, null, () => packRGB(255, 196, 90), 1.4, {
      glow: 1.8,
      grav: 0,
    });
    const target = list.find((t) => t.id === m.targetId);
    const tx = target ? Math.floor(target.x + target.w / 2) : m.x;
    const ty = target ? Math.floor(target.y + target.h / 2) : m.y;
    if (target) this.sparkLine(ctx, m.x, m.y - 2, tx, ty);
    const action = m.outputAction ?? 'activate';
    if (action === 'ignite') {
      // seed real Fire in a small disc at the target — the grid takes over
      const world = ctx.world;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx * dx + dy * dy > 5) continue;
          const X = tx + dx,
            Y = ty + dy;
          if (!world.inBounds(X, Y)) continue;
          const i = world.idx(X, Y);
          if (world.types[i] !== Cell.Empty) continue;
          world.replaceCellAt(i, Cell.Fire, fireColor());
          world.life[i] = 18 + Math.floor(Math.random() * 24);
        }
      }
      // also light any flammable body sitting on the target (a crate/barrel the
      // seeded fire would otherwise have to drift into) — relays light props now
      if (ctx.rigidBodies) ctx.rigidBodies.igniteArea(tx, ty, 6);
    } else if (action === 'strike') {
      // a concussive pulse: flips levers, wakes rune glyphs (event round-trip)
      ctx.events.emit('structureStrike', { x: tx, y: ty, radius: 8 });
    } else if (action === 'break') {
      if (target && target.kind === 'plug') this.breakPlug(ctx, target, true);
    }
  }

  /**
   * DISPENSER actuator update: while its linked triggers are satisfied, emit a
   * body every cooldown; capped at dispMax (oldest despawned). A wrecked
   * dispenser (groaning) stops.
   */
  private updateDispenser(ctx: Ctx, m: Mechanism, runtime: LevelRuntime): void {
    if (m.broken !== undefined) return;
    if (m.dispCoolT !== undefined && m.dispCoolT > 0) m.dispCoolT--;
    const triggers = mechanismTriggersFor(runtime, m.id, m);
    if (triggers.length === 0) return;
    if (!this.aggregateWant(ctx, m, triggers)) return;
    if (m.dispCoolT !== undefined && m.dispCoolT > 0) return;
    this.dispense(ctx, m);
    m.dispCoolT = m.dispCooldown ?? 24;
  }

  /** Emit one rigid body from the dispenser's mouth, honoring the active cap. */
  private dispense(ctx: Ctx, m: Mechanism): void {
    const bodies = (m.dispBodies ??= []);
    const cap = m.dispMax ?? 8;
    while (bodies.length >= cap) {
      const old = bodies.shift();
      if (old) ctx.rigidBodies.remove(old);
    }
    const MATS: BodyMaterial[] = ['wood', 'wood', 'stone', 'metal']; // wood-weighted mix
    const mat = MATS[Math.floor(Math.random() * MATS.length)];
    const half = Math.random() < 0.28 ? 5 : 3; // mostly small, the odd large
    const body = ctx.rigidBodies.spawn(
      { kind: 'box', halfW: half, halfH: half },
      m.x,
      m.y + 1 + half,
      {
        material: mat,
        friction: 0.6,
        restitution: 0.2,
        vx: (Math.random() - 0.5) * 0.8,
        vy: 0.6,
        va: (Math.random() - 0.5) * 0.4,
      },
    );
    bodies.push(body);
    ctx.particles.burst(m.x, m.y + 1, 6, null, () => packRGB(180, 172, 150), 1.0, { grav: 0.06 });
    ctx.audio.tone(190, 130, 0.07, 'square', 0.1);
  }

  /**
   * The plug fires (once): latch and announce. `demolish` (relay 'break')
   * also clears its remaining cells into debris — a detonated seal; a plug
   * whose cells the WORLD destroyed keeps whatever survivors remain.
   */
  private breakPlug(ctx: Ctx, m: Mechanism, demolish: boolean): void {
    if (m.state === 1) return;
    m.state = 1;
    const world = ctx.world;
    const mat = m.material ?? Cell.Stone;
    const fn = COLOR_FN[mat];
    if (demolish && m.body) {
      for (const [bx, by] of m.body) {
        if (!world.inBounds(bx, by)) continue;
        const i = world.idx(bx, by);
        if (world.types[i] !== mat) continue;
        world.clearCellAt(i);
        if (Math.random() < 0.3) {
          ctx.particles.spawn(
            bx,
            by,
            (Math.random() - 0.5) * 1.2,
            -0.4 - Math.random() * 0.8,
            null,
            fn ? fn() : packRGB(150, 150, 150),
            24,
            { grav: 0.06 },
          );
        }
      }
    }
    ctx.audio.tone(140, 220, 0.16, 'sawtooth', 0.14);
    ctx.particles.burst(m.x + m.w / 2, m.y + m.h / 2, 8, null, () => packRGB(180, 150, 110), 1.2, {
      grav: 0.05,
    });
    ctx.events.emit('toast', { text: 'A SEAL GIVES WAY' });
  }

  /** One bounded sensor-zone read (the sensorType decides what counts). */
  private senseZone(ctx: Ctx, m: Mechanism): number {
    const world = ctx.world;
    const z = m.zone!;
    const type = m.sensorType ?? 'weight';
    const filter = m.materialFilter;
    let n = 0;
    for (let Y = z.y0; Y <= z.y1; Y++) {
      for (let X = z.x0; X <= z.x1; X++) {
        if (!world.inBounds(X, Y)) continue;
        const i = world.idx(X, Y);
        const t = world.types[i];
        if (type === 'heat') {
          if (t === Cell.Fire || t === Cell.Lava || t === Cell.Ember) n++;
        } else if (type === 'liquid') {
          if (isLiquid(t) && (!filter || filter.length === 0 || filter.includes(t))) n++;
        } else if (type === 'weight') {
          if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) n++;
        } else if (type === 'charge') {
          if (world.charge[i] > 0) n++;
        } else if (filter && filter.includes(t)) {
          n++; // 'material': exact cell-id census
        }
      }
    }
    return n;
  }

  /** A line of staggered amber sparks from trigger to gate (one-shot). */
  private sparkLine(ctx: Ctx, x0: number, y0: number, x1: number, y1: number): void {
    const steps = 12;
    for (let k = 0; k <= steps; k++) {
      const t = k / steps;
      ctx.particles.spawn(
        x0 + (x1 - x0) * t,
        y0 + (y1 - y0) * t,
        (Math.random() - 0.5) * 0.2,
        (Math.random() - 0.5) * 0.2,
        null,
        packRGB(252, 211, 77),
        10 + k * 2, // staggered lifetimes: the spark visibly TRAVELS
        { glow: 2.0, grav: 0 },
      );
    }
  }

  /** One trigger's contribution to its door (fail-open: broken = satisfied). */
  private satisfied(t: Mechanism): boolean {
    if (t.broken === 0) return true;
    if (t.broken !== undefined) return false; // still groaning
    switch (t.kind) {
      case 'lever':
      case 'brazier':
      case 'chargelatch':
      // machine triggers that latch by firing once:
      case 'plug':
      case 'counterweight':
      case 'relay':
        return t.state === 1;
      case 'plate':
        return t.pressed === true || t.state > 0;
      case 'scale':
      case 'buoy':
      case 'sensor': // latch-mode countdown or permanent 1 — both are > 0
        return t.state > 0;
      default:
        return false;
    }
  }

  /** Weight on the rows just above the sill — terrain, liquids, bodies. */
  private sensePlate(ctx: Ctx, m: Mechanism): boolean {
    const world = ctx.world;
    let weight = 0;
    for (let dx = 0; dx < m.w; dx++) {
      for (let dyy = 1; dyy <= 2; dyy++) {
        const X = m.x + dx,
          Y = m.y - dyy;
        if (!world.inBounds(X, Y)) continue;
        const t = world.types[world.idx(X, Y)];
        if (t !== Cell.Empty && !isGas(t) && t !== Cell.Fire) weight++;
      }
    }
    const player = ctx.player;
    if (
      player.y >= m.y - 3 &&
      player.y <= m.y + 1 &&
      player.x + 4 >= m.x &&
      player.x - 4 <= m.x + m.w
    )
      weight += 4;
    for (const e of ctx.enemies) {
      const def = ctx.enemyCtl.defs[e.kind];
      if (e.y >= m.y - 3 && e.y <= m.y + 1 && e.x + def.halfW >= m.x && e.x - def.halfW <= m.x + m.w)
        weight += 4;
    }
    return weight >= 3;
  }

  strike(ctx: Ctx, x: number, y: number, radius: number): void {
    const runtime = ctx.levels.current;
    if (!runtime) return;
    // Concussion flips nearby levers — explosions are valid puzzle inputs
    for (const m of runtime.mechanisms) {
      if (m.kind !== 'lever') continue;
      if (m.pullT !== undefined && m.pullT > 0) continue; // a hand is on it
      const ddx = m.x - x,
        ddy = m.y - y;
      if (ddx * ddx + ddy * ddy <= (radius + 6) * (radius + 6)) this.flipLever(ctx, m);
    }
    // Rune glyphs answer to any strike
    for (const v of runtime.runeVaults) {
      if (v.active) continue;
      const dx = v.rx - x,
        dy = v.ry - y;
      if (dx * dx + dy * dy <= radius * radius) {
        v.active = true;
        ctx.events.emit('toast', { text: 'ANCIENT RUNE STRUCK — A VAULT RUMBLES OPEN' });
        ctx.audio.tone(220, 500, 0.5, 'sine', 0.18);
        setTimeout(() => ctx.audio.tone(330, 400, 0.4, 'sine', 0.14), 240);
        ctx.fx.screenShake = Math.min(ctx.fx.screenShake + 0.012, 0.05);
        ctx.particles.burst(v.rx, v.ry, 18, null, () => packRGB(140, 255, 180), 2.6, {
          glow: 2.6,
          grav: -0.01,
        });
      }
    }
  }

  interact(ctx: Ctx): boolean {
    const runtime = ctx.levels.current;
    if (!runtime || ctx.state.mode !== 'play' || ctx.player.dead) return false;
    if (ctx.player.pullT > 0) return true; // already mid-pull
    for (const m of runtime.mechanisms) {
      if (m.kind !== 'lever' || m.broken !== undefined) continue;
      const dx = m.x - ctx.player.x,
        dy = m.y - 3 - (ctx.player.y - 9);
      if (dx * dx + dy * dy < 22 * 22) {
        // An INTENTIONAL pull: the alchemist plants, grips, and drives the
        // arm across (~half a second). The flip lands when the pull completes
        // (see update); a hand on iron, not a tap on a button.
        m.pullT = 26;
        ctx.player.pullT = 26;
        ctx.player.pullDir = Math.sign(m.x - ctx.player.x) || 1;
        ctx.player.facing = ctx.player.pullDir;
        ctx.audio.tone(180, 140, 0.08, 'square', 0.08); // the grip
        return true;
      }
    }
    // The Refuge's offering shrine: kneel and trade. Shop only — boons are
    // bargained at the portal between depths.
    const shrine = runtime.refuge;
    if (shrine) {
      const dx = shrine.x - ctx.player.x,
        dy = shrine.y - (ctx.player.y - 4);
      if (dx * dx + dy * dy < 16 * 16) {
        ctx.audio.tone(660, 220, 0.18, 'triangle', 0.1);
        ctx.sanctum.openShop(ctx);
        return true;
      }
    }
    return false;
  }

  private flipLever(ctx: Ctx, m: Mechanism): void {
    m.state = m.state === 1 ? 0 : 1;
    ctx.audio.lever();
    ctx.particles.burst(m.x, m.y - 3, 6, null, () => packRGB(255, 210, 110), 1.2, {
      glow: 1.8,
      grav: 0.02,
    });
  }
}
