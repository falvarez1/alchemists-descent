interface Position { x: number; y: number }

/** Previous fixed-tick positions live only in the presentation layer. */
export class RenderPoses {
  private readonly previous = new WeakMap<object, Position>();
  capture(body: Position): void {
    let pose = this.previous.get(body);
    if (!pose) { pose = { x: body.x, y: body.y }; this.previous.set(body, pose); }
    pose.x = body.x; pose.y = body.y;
  }
  offset(body: Position, axis: 'x' | 'y', alpha: number): number {
    const previous = this.previous.get(body);
    if (!previous || Math.hypot(body.x - previous.x, body.y - previous.y) > 80) return 0;
    return (previous[axis] - body[axis]) * (1 - Math.max(0, Math.min(1, alpha)));
  }
  moving(body: Position): boolean {
    const previous = this.previous.get(body);
    return !!previous && (previous.x !== body.x || previous.y !== body.y);
  }
}
