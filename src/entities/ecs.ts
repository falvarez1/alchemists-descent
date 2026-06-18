declare const EntityIdBrand: unique symbol;

/** Opaque runtime handle for a transient gameplay entity. */
export type EntityId = number & { readonly [EntityIdBrand]: true };

export interface EntityPoolOptions {
  /** Dense pool capacity. Omit for an unbounded pool. */
  max?: number;
  /**
   * Skip id allocation and the WeakMap/Map side tables. Use for high-churn
   * pools (e.g. particles) that only ever use add/removeAt/list/full/clear and
   * never reference entities by EntityId (idOf/get/has/create/remove/removeId/
   * retain). In this mode add() returns null and the id-keyed lookups always
   * miss; the dense list and swap-remove stay fully intact.
   */
  untracked?: boolean;
}

let nextEntityId = 1;

/**
 * Dense, order-free entity pool for runtime objects that already want
 * swap-remove iteration. The array remains the hot path; ids are a side table
 * for cross-system references and lifecycle bookkeeping.
 */
export class EntityPool<T extends object> {
  readonly list: T[] = [];

  private readonly ids = new WeakMap<T, EntityId>();
  private readonly slots = new Map<EntityId, number>();
  private readonly max: number;
  private readonly tracked: boolean;

  constructor(options: EntityPoolOptions = {}) {
    this.max = options.max ?? Number.POSITIVE_INFINITY;
    this.tracked = options.untracked !== true;
  }

  get size(): number {
    return this.list.length;
  }

  get capacity(): number {
    return this.max;
  }

  get full(): boolean {
    return this.list.length >= this.max;
  }

  add(entity: T): EntityId | null {
    // Untracked pools push straight onto the dense list — no id, no side tables.
    if (!this.tracked) {
      if (this.full) return null;
      this.list.push(entity);
      return null;
    }
    const existing = this.ids.get(entity);
    if (existing !== undefined && this.slots.has(existing)) return existing;
    if (this.full) return null;
    const id = allocateEntityId();
    this.list.push(entity);
    this.ids.set(entity, id);
    this.slots.set(id, this.list.length - 1);
    return id;
  }

  /**
   * Create and insert a fresh entity. The factory receives the id that will be
   * assigned; returning an object already active in this pool is a programmer
   * error because external component side effects may already reference it.
   */
  create(factory: (id: EntityId) => T): T | null {
    if (this.full) return null;
    const id = allocateEntityId();
    const entity = factory(id);
    const existing = this.ids.get(entity);
    if (existing !== undefined && this.slots.has(existing)) {
      throw new Error('EntityPool.create factory must return a fresh entity');
    }
    this.list.push(entity);
    this.ids.set(entity, id);
    this.slots.set(id, this.list.length - 1);
    return entity;
  }

  idOf(entity: T): EntityId | undefined {
    return this.ids.get(entity);
  }

  has(id: EntityId): boolean {
    return this.slots.has(id);
  }

  get(id: EntityId): T | undefined {
    const slot = this.slots.get(id);
    return slot === undefined ? undefined : this.list[slot];
  }

  remove(entity: T): T | undefined {
    const id = this.ids.get(entity);
    if (id === undefined) return undefined;
    return this.removeId(id);
  }

  removeId(id: EntityId): T | undefined {
    const slot = this.slots.get(id);
    return slot === undefined ? undefined : this.removeAt(slot);
  }

  removeAt(index: number): T | undefined {
    if (!Number.isInteger(index) || index < 0 || index >= this.list.length) return undefined;

    // Untracked pools keep no id tables, so swap-remove is just list churn.
    if (!this.tracked) {
      const removed = this.list[index];
      const last = this.list.length - 1;
      if (index !== last) this.list[index] = this.list[last];
      this.list.pop();
      return removed;
    }

    const removed = this.list[index];
    const removedId = this.ids.get(removed);
    const last = this.list.length - 1;

    if (index !== last) {
      const moved = this.list[last];
      this.list[index] = moved;
      const movedId = this.ids.get(moved);
      if (movedId !== undefined) this.slots.set(movedId, index);
    }

    this.list.pop();
    this.ids.delete(removed);
    if (removedId !== undefined) this.slots.delete(removedId);
    return removed;
  }

  retain(keep: (entity: T, id: EntityId) => boolean): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const entity = this.list[i];
      const id = this.ids.get(entity);
      if (id === undefined || !keep(entity, id)) this.removeAt(i);
    }
  }

  clear(): void {
    // Untracked pools have empty side tables, so just drop the list.
    if (this.tracked) {
      for (const entity of this.list) this.ids.delete(entity);
      this.slots.clear();
    }
    this.list.length = 0;
  }

}

/**
 * Sparse component table keyed by globally unique EntityId.
 * Component lifetime is explicit: delete or clear component rows when the
 * owning entity pool removes entities.
 */
export class ComponentStore<T> {
  private readonly values = new Map<EntityId, T>();

  get size(): number {
    return this.values.size;
  }

  set(id: EntityId, value: T): void {
    this.values.set(id, value);
  }

  get(id: EntityId): T | undefined {
    return this.values.get(id);
  }

  has(id: EntityId): boolean {
    return this.values.has(id);
  }

  delete(id: EntityId): boolean {
    return this.values.delete(id);
  }

  clear(): void {
    this.values.clear();
  }

  entries(): IterableIterator<[EntityId, T]> {
    return this.values.entries();
  }
}

export interface Position2 {
  x: number;
  y: number;
}

export interface Velocity2 {
  vx: number;
  vy: number;
}

export interface Lifetime {
  life: number;
}

function allocateEntityId(): EntityId {
  if (nextEntityId > Number.MAX_SAFE_INTEGER) {
    throw new Error('EntityId space exhausted');
  }
  return nextEntityId++ as EntityId;
}
