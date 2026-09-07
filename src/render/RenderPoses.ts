interface Position { x: number; y: number }

/** A rigid body's presentation pose between fixed ticks: the solver records
 * its previous pose each step, so sprites can follow it at frame rate. A
 * jump longer than a teleport threshold is drawn where the body IS. */
export function interpolateBody(
  b: { x: number; y: number; angle: number; previousX?: number; previousY?: number; previousAngle?: number },
  alpha: number,
): { x: number; y: number; angle: number } {
  const px = b.previousX ?? b.x, py = b.previousY ?? b.y, pa = b.previousAngle ?? b.angle;
  const t = Math.max(0, Math.min(1, alpha));
  if (Math.hypot(b.x - px, b.y - py) > 80) return { x: b.x, y: b.y, angle: b.angle };
  return { x: px + (b.x - px) * t, y: py + (b.y - py) * t, angle: pa + Math.atan2(Math.sin(b.angle - pa), Math.cos(b.angle - pa)) * t };
}

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
