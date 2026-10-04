import type { DuelApi } from '@/core/duel';
import type { FighterId } from '@/content/fighters';
import type { CellPatch } from '@/authoring/cellPatch';
import type { SessionTransport, SessionTransportFactory } from '@/net/SessionTransport';
import { DUEL_PROTOCOL, parseServerMessage, type DuelRoomState, type DuelCommand } from './protocol';
import { DuelInputBuffer, type DuelInput, type DuelTickInput } from './input';
import { decodeDuelSnapshot, encodeDuelSnapshot, type ArenaPresentation, type DuelSnapshot } from './snapshot';

/** Adapter boundary for the game. Moving authority to a server does not change
 * the room protocol, controls, or replica format. No game/DOM imports here. */
export interface DuelRuntime {
  prepare(fighters: readonly FighterId[], valid: () => boolean): Promise<boolean>;
  stop(): void;
  pause(paused: boolean): void;
  sample(): Omit<DuelInput, 'seq'>;
  clearInput(): void;
  pollControls?(): void;
  input(slot: number, input: DuelTickInput): void;
  capture(meta: Pick<DuelSnapshot, 'epoch' | 'seq' | 'base' | 'baseline'>): {
    snapshot: DuelSnapshot;
    cells: CellPatch;
  };
  receive(snapshot: DuelSnapshot, cells: CellPatch, now: number): boolean;
  /** True when new state or interpolation requires composing the replica. */
  present(now: number): boolean;
}

/** Room lifecycle above an injected transport. SpacetimeDB-specific reducers,
 * generated bindings, and credentials belong in future adapters, never here. */
export class DuelSession implements DuelApi {
  active = false;
  room: DuelRoomState | null = null;
  slot: 0 | 1 | null = null;
  status = '';
  latency = 0;
  connected = false;
  snapshotCount = 0;
  presentation: ArenaPresentation | null = null;
  private transport: SessionTransport | null = null;
  private token: string | undefined;
  private role: 'host' | 'guest' = 'host';
  private roomCode = '';
  private generation = 0;
  private preparation = 0;
  private openedAt = 0;
  private preparedEpoch = 0;
  private preparingEpoch = 0;
  private nextConnect = Infinity;
  private retry = 0;
  private disconnectedAt = 0;
  private inputSeq = 0;
  private lastInput = 0;
  private lastPing = 0;
  private lastHeard = 0;
  private nextSnapshot = 0;
  private sentSeq = 0;
  private receivedSeq = 0;
  private needsBaseline = true;
  private readonly inputs = [new DuelInputBuffer(), new DuelInputBuffer()];
  constructor(
    private readonly factory: SessionTransportFactory,
    private readonly runtime: DuelRuntime,
    private readonly build: string,
    private readonly changed: () => void,
    private readonly now = () => performance.now(),
  ) {}
  get replica(): boolean {
    return this.active && this.slot === 1;
  }
  get playing(): boolean {
    return this.connected && this.room?.phase === 'playing' && this.preparedEpoch === this.room.epoch;
  }
  host(): void {
    this.begin('host', '');
  }
  join(room: string): void {
    this.begin('guest', room.trim().toUpperCase());
  }
  private begin(role: 'host' | 'guest', room: string): void {
    this.leave();
    this.active = true;
    this.role = role;
    this.roomCode = room;
    this.status = 'Connecting to the LAN server…';
    this.disconnectedAt = this.now();
    this.open();
    this.changed();
  }
  private open(): void {
    this.nextConnect = Infinity;
    const generation = this.generation,
      transport = this.factory();
    this.transport = transport;
    this.openedAt = this.now();
    if (!transport.supportsBinary || !transport.sendBinary) {
      this.fail('This multiplayer connection cannot stream the match world.');
      return;
    }
    const current = (): boolean => this.active && generation === this.generation && transport === this.transport;
    transport.open({
      onOpen: () => {
        if (current())
          transport.send(
            JSON.stringify({
              type: 'hello',
              protocol: DUEL_PROTOCOL,
              build: this.build,
              role: this.role,
              room: this.roomCode,
              token: this.token,
            }),
          );
      },
      onMessage: (data) => {
        if (!current()) return;
        const message = parseServerMessage(data);
        if (!message) {
          this.fail('Invalid response from the LAN server.');
          return;
        }
        this.lastHeard = this.now();
        switch (message.type) {
          case 'welcome':
            this.connected = true;
            this.retry = 0;
            this.token = message.token;
            this.slot = message.slot;
            this.roomCode = message.state.room;
            this.needsBaseline = true;
            this.receivedSeq = 0;
            this.acceptRoom(message.state);
            if (this.replica && this.preparedEpoch === message.state.epoch && message.state.epoch > 0)
              this.send({ type: 'resync' });
            break;
          case 'prepare':
            this.acceptRoom(message.state);
            break;
          case 'room':
            this.acceptRoom(message.state);
            break;
          case 'input':
            if (this.slot === 0 && this.playing && message.epoch === this.preparedEpoch)
              this.inputs[1].accept(message, this.now());
            break;
          case 'resync':
            this.needsBaseline = true;
            break;
          case 'pong':
            this.latency = Math.max(0, Math.round(this.now() - message.at));
            this.changed();
            break;
          case 'ended':
          case 'error':
            this.fail(message.message);
            break;
        }
      },
      onBinary: (data) => {
        if (!current() || !this.replica || this.preparedEpoch === 0) return;
        const packet = decodeDuelSnapshot(data);
        if (!packet) {
          this.fail('Invalid match snapshot. Reload both computers.');
          return;
        }
        const { snapshot, cells } = packet;
        if (snapshot.epoch !== this.preparedEpoch || snapshot.seq <= this.receivedSeq) return;
        if (!snapshot.baseline && (this.needsBaseline || snapshot.base !== this.receivedSeq)) {
          if (!this.needsBaseline) this.send({ type: 'resync' });
          this.needsBaseline = true;
          return;
        }
        if (!this.runtime.receive(snapshot, cells, this.now())) {
          this.fail('The match world does not match this game build.');
          return;
        }
        this.presentation = snapshot.arena;
        this.receivedSeq = snapshot.seq;
        this.needsBaseline = false;
        this.lastHeard = this.now();
        this.snapshotCount++;
      },
      onClose: () => {
        if (current()) this.disconnected();
      },
      onError: () => {
        if (current()) {
          this.status = 'Could not reach the LAN server.';
          this.changed();
        }
      },
    });
  }
  private acceptRoom(room: DuelRoomState): void {
    const oldPhase = this.room?.phase;
    this.room = room;
    this.status =
      room.phase === 'lobby'
        ? 'Choose your fighter and ready up.'
        : room.phase === 'loading'
          ? 'Loading both fighters…'
          : room.phase === 'paused'
            ? room.seats.every((s) => s.connected)
              ? 'Match paused. The host can resume.'
              : 'Connection lost. Waiting for the other player…'
            : '';
    if (room.phase === 'lobby' && (this.preparedEpoch > 0 || this.preparingEpoch > 0)) {
      this.preparation++;
      this.preparedEpoch = this.preparingEpoch = 0;
      this.presentation = null;
      this.runtime.stop();
    }
    if (room.phase === 'loading' && room.epoch !== this.preparedEpoch && room.epoch !== this.preparingEpoch)
      void this.prepare(room);
    if (oldPhase !== room.phase || room.phase !== 'playing') this.release();
    this.runtime.pause(!this.playing || this.replica);
    this.changed();
    if (oldPhase === 'playing' && room.phase === 'paused') this.publish(true);
  }
  private async prepare(room: DuelRoomState): Promise<void> {
    const generation = this.generation,
      preparation = ++this.preparation;
    this.preparingEpoch = room.epoch;
    this.preparedEpoch = 0;
    this.presentation = null;
    this.receivedSeq = this.sentSeq = 0;
    this.needsBaseline = true;
    this.release();
    const valid = (): boolean =>
      this.active &&
      generation === this.generation &&
      preparation === this.preparation &&
      this.room?.epoch === room.epoch &&
      this.room.phase !== 'lobby';
    try {
      const loaded = await this.runtime.prepare(
        room.seats.map((s) => s.fighter),
        valid,
      );
      if (!valid()) return;
      if (!loaded) {
        this.fail('Could not load both fighters. Create a new room.');
        return;
      }
      this.preparedEpoch = room.epoch;
      this.preparingEpoch = 0;
      this.runtime.pause(true);
      this.lastHeard = this.now();
      this.send({ type: 'loaded', epoch: room.epoch });
    } catch (error) {
      if (valid()) this.fail(error instanceof Error ? error.message : 'Could not load the match.');
    }
  }
  private disconnected(): void {
    this.transport?.close();
    this.transport = null;
    this.connected = false;
    this.disconnectedAt = this.now();
    this.nextConnect = this.now() + Math.min(5000, 500 * 2 ** Math.min(4, this.retry++));
    this.runtime.pause(true);
    this.release();
    this.status = 'Connection lost. Reconnecting…';
    this.changed();
  }
  private fail(message: string): void {
    this.leave();
    this.status = message;
    this.changed();
  }
  private send(command: DuelCommand): void {
    this.transport?.send(JSON.stringify(command));
  }
  leave(): void {
    if (this.active) {
      this.send({ type: 'leave' });
      this.runtime.stop();
    }
    this.generation++;
    this.inputSeq = 0;
    this.inputs.forEach((input) => input.reset());
    this.transport?.close();
    this.transport = null;
    this.active = this.connected = false;
    this.room = null;
    this.slot = null;
    this.token = undefined;
    this.presentation = null;
    this.preparedEpoch = this.preparingEpoch = this.sentSeq = this.receivedSeq = this.retry = 0;
    this.nextConnect = Infinity;
    this.status = '';
    this.release();
    this.changed();
  }
  choose(fighter: FighterId): void {
    this.send({ type: 'choose', fighter });
  }
  ready(): void {
    if (this.slot !== null) this.send({ type: 'ready', ready: !this.room?.seats[this.slot].ready });
  }
  start(): void {
    this.send({ type: 'start' });
  }
  pause(): void {
    this.send({ type: 'pause' });
  }
  resume(): void {
    this.send({ type: 'resume' });
  }
  rematch(): void {
    this.send({ type: 'rematch' });
  }
  lobby(): void {
    this.send({ type: 'lobby' });
  }
  private release(): void {
    this.inputs.forEach((i) => i.clear());
    this.runtime.clearInput();
  }
  /** Event-driven edges bypass the presentation cadence; polling still covers controllers and held input. */
  flushInput(): void {
    if (!this.playing) return;
    const now = this.now();
    this.lastInput = now;
    const input = { ...this.runtime.sample(), seq: ++this.inputSeq };
    if (this.slot === 0) this.inputs[0].accept(input, now);
    else this.send({ type: 'input', epoch: this.preparedEpoch, ...input });
  }
  frame(now: number): boolean {
    if (!this.active) return false;
    this.runtime.pollControls?.();
    if (!this.connected && now >= this.nextConnect) {
      if (this.retry > 8 || now - this.disconnectedAt > 55_000) {
        this.fail('Connection could not be restored. Create a new room.');
        return false;
      }
      this.open();
    }
    if (!this.connected && this.transport && now - this.openedAt > 15_000) {
      this.disconnected();
      return false;
    }
    if (this.connected && now - this.lastHeard > (this.room?.phase === 'loading' ? 60_000 : 15_000)) {
      this.disconnected();
      return false;
    }
    if (this.connected && now - this.lastPing > 1000) {
      this.lastPing = now;
      this.send({ type: 'ping', at: this.now() });
    }
    if (this.playing && now - this.lastInput >= 1000 / 60) this.flushInput();
    this.runtime.pause(!this.playing || this.replica);
    return this.replica && this.runtime.present(now);
  }
  beforeTick(): void {
    if (!this.playing || this.slot !== 0) return;
    for (const slot of [0, 1]) this.runtime.input(slot, this.inputs[slot].take(this.now()));
  }
  afterTick(): void {
    this.publish(false);
  }
  private publish(force: boolean): void {
    const now = this.now();
    if (
      (!this.playing && !(force && this.connected && this.room?.phase === 'paused')) ||
      !this.room?.seats.every((s) => s.connected) ||
      this.preparedEpoch === 0 ||
      this.slot !== 0 ||
      (!force && now < this.nextSnapshot) ||
      !this.transport?.sendBinary ||
      (this.transport.bufferedBytes ?? 0) > 256_000
    )
      return;
    this.nextSnapshot = now + 1000 / 30;
    // Ordered reliable delivery needs a baseline only for initialization or recovery.
    const baseline = this.needsBaseline;
    try {
      const packet = this.runtime.capture({
        epoch: this.preparedEpoch,
        seq: this.sentSeq + 1,
        base: this.sentSeq,
        baseline,
      });
      if (!this.transport.sendBinary(encodeDuelSnapshot(packet.snapshot, packet.cells))) {
        this.needsBaseline = true;
        return;
      }
      this.sentSeq++;
      this.snapshotCount++;
      this.needsBaseline = false;
    } catch (error) {
      this.fail(error instanceof Error ? error.message : 'Could not publish match state.');
    }
  }
  dispose(): void {
    this.leave();
  }
}
