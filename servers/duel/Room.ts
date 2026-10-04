import type { DuelCommand, DuelRoomState, DuelServerMessage } from '../../src/net/duel/protocol.ts';

/** Session authority, independent of sockets, browser APIs, and the simulation.
 * A database-backed implementation must preserve these ownership and epoch rules. */
export class DuelRoom {
  readonly state: DuelRoomState;
  private loaded = [false, false];
  private inputSeq = [-1, -1];
  constructor(
    readonly id: string,
    readonly build: string,
    private readonly send: (slot: number, message: DuelServerMessage) => void,
  ) {
    this.state = {
      room: id,
      epoch: 0,
      phase: 'lobby',
      seats: [
        { fighter: 'ilyra-voss', ready: false, connected: false },
        { fighter: 'brann-rook', ready: false, connected: false },
      ],
    };
  }
  private broadcast(message: DuelServerMessage): void {
    for (const slot of [0, 1]) if (this.state.seats[slot].connected) this.send(slot, message);
  }
  private changed(): void {
    this.broadcast({ type: 'room', state: this.state });
  }
  connect(slot: number): void {
    this.state.seats[slot].connected = true;
    this.changed();
  }
  disconnect(slot: number): void {
    this.state.seats[slot].connected = false;
    this.state.seats[slot].ready = false;
    if (this.state.phase === 'loading') {
      this.state.phase = 'lobby';
      this.loaded.fill(false);
      this.state.seats.forEach((s) => {
        s.ready = false;
      });
    } else if (this.state.phase !== 'lobby') this.state.phase = 'paused';
    this.changed();
  }
  canPublish(slot: number): boolean {
    return (
      slot === 0 && this.state.epoch > 0 && this.state.phase !== 'lobby' && this.state.seats.every((s) => s.connected)
    );
  }
  command(slot: number, command: DuelCommand): void {
    const s = this.state,
      seat = s.seats[slot];
    if (!seat?.connected) return;
    switch (command.type) {
      case 'choose':
        if (s.phase === 'lobby') {
          seat.fighter = command.fighter;
          seat.ready = false;
          this.changed();
        }
        break;
      case 'ready':
        if (s.phase === 'lobby') {
          seat.ready = command.ready;
          this.changed();
        }
        break;
      case 'start':
        if (slot === 0 && s.phase === 'lobby' && s.seats.every((p) => p.connected && p.ready)) this.prepare();
        break;
      case 'rematch':
        if (slot === 0 && s.phase !== 'lobby' && s.phase !== 'loading' && s.seats.every((p) => p.connected))
          this.prepare();
        break;
      case 'loaded':
        if (command.epoch !== s.epoch || s.phase !== 'loading') break;
        this.loaded[slot] = true;
        if (this.loaded.every(Boolean) && s.seats.every((p) => p.connected)) {
          s.phase = 'playing';
          this.changed();
        }
        break;
      case 'pause':
        if (s.phase === 'playing') {
          s.phase = 'paused';
          this.changed();
        }
        break;
      case 'resume':
        if (slot === 0 && s.phase === 'paused' && this.loaded.every(Boolean) && s.seats.every((p) => p.connected)) {
          this.send(0, { type: 'resync' });
          s.phase = 'playing';
          this.changed();
        }
        break;
      case 'lobby':
        if (slot === 0) {
          s.phase = 'lobby';
          this.loaded.fill(false);
          s.seats.forEach((p) => {
            p.ready = false;
          });
          this.changed();
        }
        break;
      case 'input':
        if (slot === 1 && s.phase === 'playing' && command.epoch === s.epoch && command.seq > this.inputSeq[slot]) {
          this.inputSeq[slot] = command.seq;
          this.send(0, command);
        }
        break;
      case 'resync':
        if (slot === 1 && s.epoch > 0) this.send(0, { type: 'resync' });
        break;
      case 'ping':
        this.send(slot, { type: 'pong', at: command.at });
        break;
      case 'leave':
        break; // The connection host owns identity leases and teardown.
    }
  }
  private prepare(): void {
    this.state.epoch++;
    this.state.phase = 'loading';
    this.loaded.fill(false);
    this.inputSeq.fill(-1);
    this.broadcast({ type: 'prepare', state: this.state });
  }
}
