/**
 * Select art from an authoritative 60 Hz animation age.
 * Pass a frozen age during hitstop. This function does not advance simulation.
 * @param {{totalTicks:number,loop:boolean,frames:Array<{durationTicks:number}>}} animation
 * @param {number} ageTicks
 */
export function frameAtTick(animation, ageTicks) {
  if (!Number.isFinite(ageTicks) || animation.totalTicks <= 0 || !animation.frames.length) throw new Error('Invalid animation age or clip');
  const age = Math.max(0, ageTicks);
  if(!animation.loop&&animation.endBehavior==='hide'&&age>=animation.totalTicks)return -1;
  let remaining = animation.loop ? age % animation.totalTicks : Math.min(age, animation.totalTicks);
  for (let i = 0; i < animation.frames.length; i++) {
    if (remaining < animation.frames[i].durationTicks) return i;
    remaining -= animation.frames[i].durationTicks;
  }
  return animation.frames.length - 1;
}

/**
 * Select an attack drawing inside the current authoritative combat phase.
 * Phase scaling preserves hit windows if runtime tuning changes.
 */
export function frameForAttack(animation, attack) {
  if (!attack.spec || attack.phase === 'idle') return 0;
  const phaseFrames = animation.frames.filter(f => f.phase === attack.phase);
  if (!phaseFrames.length) throw new Error('Animation has no frames for combat phase ' + attack.phase);
  const before = attack.phase === 'startup' ? 0 : attack.phase === 'active' ? attack.spec.startup : attack.spec.startup + attack.spec.active;
  const duration = attack.spec[attack.phase];
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('Invalid attack phase duration');
  const authoredDuration = phaseFrames.reduce((n,f)=>n+f.durationTicks,0);
  let remaining = Math.max(0,Math.min(1,(attack.age-before)/duration))*authoredDuration;
  for(const frame of phaseFrames) {
    if(remaining<frame.durationTicks)return frame.index;
    remaining-=frame.durationTicks;
  }
  return phaseFrames.at(-1).index;
}

/**
 * Place the sprite pivot at x/y: a ledge contact for grip anchors, feet otherwise.
 * Image pixels never determine collision dimensions.
 * @param {CanvasRenderingContext2D} ctx
 * @param {CanvasImageSource} image
 * @param {{totalTicks:number,loop:boolean,frames:Array<{durationTicks:number,rect:{x:number,y:number,w:number,h:number},pivot:{x:number,y:number}}>} animation
 */
export function drawAnimation(ctx, image, animation, ageTicks, x, y, scale = 1, facing = 1) {
  const index=frameAtTick(animation,ageTicks);
  if(index<0)return;
  const frame = animation.frames[index], r = frame.rect;
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(facing < 0 ? -scale : scale, scale);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, r.x, r.y, r.w, r.h, -frame.pivot.x, -frame.pivot.y, r.w, r.h);
  ctx.restore();
}
