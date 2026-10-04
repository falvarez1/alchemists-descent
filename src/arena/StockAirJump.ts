/** One additional jump per airborne sequence. Recovery and wall movement do not refill it. */
export class StockAirJump {
  private used = false;
  reset(): void { this.used = false; }
  step(pressed: boolean, grounded: boolean, canAct: boolean): boolean {
    if (grounded) this.used = false;
    if (grounded || !pressed || !canAct || this.used) return false;
    this.used = true;
    return true;
  }
}
