/** Save-compatible sparse scars with a dense, directly uploadable render mask.
 * Set iteration remains authoritative; the mask avoids scanning every scar in
 * a level each time the camera presents a frame. */
export class ColorOverrides extends Set<number> {
  readonly #mask: Uint8Array;
  #revision = 0;
  get mask(): Uint8Array { return this.#mask; }
  get revision(): number { return this.#revision; }

  constructor(cellCount: number) {
    super();
    this.#mask = new Uint8Array(cellCount);
  }

  override add(index: number): this {
    super.add(index);
    this.#mask[index] = 255;
    // Re-staining an existing member can change its color without its size.
    this.#revision++;
    return this;
  }

  override delete(index: number): boolean {
    const removed = super.delete(index);
    if (removed) { this.#mask[index] = 0; this.#revision++; }
    return removed;
  }

  override clear(): void {
    if (this.size === 0) return;
    super.clear();
    this.#mask.fill(0);
    this.#revision++;
  }
}
