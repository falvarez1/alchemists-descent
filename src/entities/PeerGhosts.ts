import type { PeerGhost, PeerGhostPose, PeerGhostsApi } from '@/core/types';

/**
 * Remote players, rendered as non-authoritative phantoms.
 *
 * Stage 3 of docs/MULTIPLAYER-ARCHITECTURE.md, taken deliberately as
 * co-presence FIRST: you see a peer move through your world, but neither
 * simulation yields authority. That ordering answers the genuinely risky
 * question — does streamed movement feel alive at 60 Hz — without the 46-file
 * refactor a shared player roster needs.
 *
 * WHY INTERPOLATE ON RECEIVE TIME, NOT SENDER TIME. Two browsers have
 * unsynchronised clocks, and a sender's `sentAt` can sit seconds off ours.
 * Sequencing on OUR arrival time is immune to that: samples arrive in order, so
 * the spacing between them is the true spacing plus network jitter, which is
 * exactly what the delay buffer below exists to absorb. Trusting sender clocks
 * would need clock sync to buy nothing.
 *
 * THE DELAY BUFFER. Ghosts render `INTERP_DELAY_MS` in the past so there are
 * almost always two real samples straddling the render time. Rendering at
 * "now" would mean extrapolating constantly, which reads as rubber-banding
 * every time a packet is late. A sixth of a second of latency is invisible on
 * a character you do not control; jitter is not.
 *
 * This store is pure — no `Ctx`, no rendering, no socket. `AuthorLink` feeds
 * it and the sprite reads it, which keeps the interpolation testable without a
 * browser.
 */

/** Render this far behind the newest sample, so interpolation has both ends. */
const INTERP_DELAY_MS = 120;
/**
 * Coast on last known velocity at most this long past the newest sample.
 *
 * SHORT ON PURPOSE — about one and a half publish intervals. Because poses are
 * published ON CHANGE, a gap in samples usually means the peer STOPPED, not
 * that a packet was lost. Coasting far past the last sample would sail the
 * phantom beyond where the peer is actually standing and then snap it back
 * when the next sample lands, which is the rubber-banding this delay buffer
 * exists to prevent. This covers genuine network jitter and nothing more.
 */
const EXTRAPOLATE_MAX_MS = 80;
/**
 * Silence is NOT absence.
 *
 * Poses publish on change, so a peer who is simply standing still sends
 * nothing at all — expiring them quickly would make a motionless teammate
 * blink out of existence, which is both wrong and alarming. The reliable
 * "they left" signal is the room roster, and `AuthorLink` clears phantoms when
 * the peer count drops to zero. This timeout is only a safety net for a peer
 * that vanishes without the roster noticing, so it is deliberately long.
 */
const STALE_MS = 30_000;
/** Fade only near the very end, as a visible hint that something went wrong. */
const FADE_AFTER_MS = 25_000;
/** Enough history for ~1s at the publish cadence; oldest is discarded. */
const MAX_SAMPLES = 12;
/** Beyond this the peer teleported (respawn, level change) — snap, don't slide. */
const TELEPORT_CELLS = 120;

interface Sample {
  at: number;
  pose: PeerGhostPose;
}

interface Peer {
  samples: Sample[];
  last: number;
}

const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;

export class PeerGhosts implements PeerGhostsApi {
  private readonly peers = new Map<string, Peer>();
  private readonly out: PeerGhost[] = [];

  get count(): number {
    return this.peers.size;
  }

  note(id: string, pose: PeerGhostPose, atMs: number): void {
    let peer = this.peers.get(id);
    if (!peer) {
      peer = { samples: [], last: atMs };
      this.peers.set(id, peer);
    }
    const prev = peer.samples[peer.samples.length - 1];
    // A jump this large is a teleport, not motion. Interpolating across it
    // would drag the phantom through the level at implausible speed; dropping
    // the history makes it appear at the new place instead.
    if (prev && Math.hypot(pose.x - prev.pose.x, pose.y - prev.pose.y) > TELEPORT_CELLS) {
      peer.samples.length = 0;
    }
    peer.samples.push({ at: atMs, pose });
    if (peer.samples.length > MAX_SAMPLES) peer.samples.shift();
    peer.last = atMs;
  }

  drop(id: string): void {
    this.peers.delete(id);
  }

  clear(): void {
    this.peers.clear();
  }

  /**
   * The phantoms to draw right now.
   *
   * Returns a reused array — this runs every frame, and allocating a list of
   * objects per frame is exactly the garbage this renderer avoids elsewhere.
   */
  sample(nowMs: number): readonly PeerGhost[] {
    this.out.length = 0;
    for (const [id, peer] of this.peers) {
      const silent = nowMs - peer.last;
      if (silent > STALE_MS) {
        this.peers.delete(id);
        continue;
      }
      const pose = this.poseAt(peer, nowMs - INTERP_DELAY_MS);
      if (!pose) continue;
      // Fade rather than vanish: a peer that stops publishing has usually just
      // stopped moving, and blinking out would read as a bug.
      const alpha =
        silent <= FADE_AFTER_MS ? 1 : Math.max(0, 1 - (silent - FADE_AFTER_MS) / (STALE_MS - FADE_AFTER_MS));
      this.out.push({ id, pose, alpha });
    }
    return this.out;
  }

  private poseAt(peer: Peer, at: number): PeerGhostPose | null {
    const s = peer.samples;
    if (s.length === 0) return null;
    // A single sample is held, never extrapolated: with change-based
    // publishing, one sample and then silence means "moved here, then stopped",
    // so coasting would walk the phantom away from where the peer really is.
    if (s.length === 1 || at <= s[0].at) return s[0].pose;

    const newest = s[s.length - 1];
    if (at >= newest.at) {
      // Past the newest sample: coast on last known velocity, briefly. Held
      // still afterwards rather than flying off, because a peer that stopped
      // sending has far more often stopped moving than kept going.
      const ahead = Math.min(at - newest.at, EXTRAPOLATE_MAX_MS);
      if (ahead <= 0) return newest.pose;
      const frames = ahead / (1000 / 60);
      return {
        ...newest.pose,
        x: newest.pose.x + newest.pose.vx * frames,
        y: newest.pose.y + newest.pose.vy * frames,
        stride: newest.pose.stride + Math.abs(newest.pose.vx) * frames * 0.1,
      };
    }

    for (let k = s.length - 1; k > 0; k--) {
      const b = s[k];
      const a = s[k - 1];
      if (at >= a.at && at <= b.at) {
        const span = b.at - a.at;
        const t = span <= 0 ? 1 : (at - a.at) / span;
        return {
          x: lerp(a.pose.x, b.pose.x, t),
          y: lerp(a.pose.y, b.pose.y, t),
          vx: lerp(a.pose.vx, b.pose.vx, t),
          vy: lerp(a.pose.vy, b.pose.vy, t),
          aim: lerpAngle(a.pose.aim, b.pose.aim, t),
          stride: lerp(a.pose.stride, b.pose.stride, t),
          // Facing and flags are discrete: blending them would produce a
          // wizard facing 0.4 of the way left, which is not a thing.
          facing: t < 0.5 ? a.pose.facing : b.pose.facing,
          flags: t < 0.5 ? a.pose.flags : b.pose.flags,
        };
      }
    }
    return s[0].pose;
  }
}

/** Shortest-way angle blend, so aiming across ±π does not spin the arm around. */
function lerpAngle(a: number, b: number, k: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
