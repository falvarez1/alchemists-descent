/** A melee approach has a destination and a wider restart band. Small opponent motion does not cause strafing. */
export class StockFootwork {
  private approaching = false;
  private direction = 0;
  private committedAt = -Infinity;
  goal(x: number, targetX: number, tick: number): number | null {
    const distance = Math.abs(targetX - x), dir = Math.sign(targetX - x);
    if (distance <= 16) this.approaching = false;
    else if (distance > 24) this.approaching = true;
    if (!this.approaching || !dir) return null;
    if (dir !== this.direction) {
      if (tick - this.committedAt < 18) return null;
      this.direction = dir; this.committedAt = tick;
    }
    return targetX - dir * 10;
  }
  reset(): void { this.approaching = false; this.direction = 0; this.committedAt = -Infinity; }
}
