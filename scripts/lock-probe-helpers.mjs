import assert from 'node:assert/strict';

/**
 * Shared real-input helpers for the lock probes (verify-gas-bell / verify-weir / verify-crucible):
 * walk like a player (hold the direction, hop what stops you), aim the mouse at a world cell, wait for
 * the HUD's own cadence (it re-reads its objective and the hint line on its own clock), take screenshots.
 */
export function lockProbeTools(page, output) {
  const ctxEval = (fn, arg) => page.evaluate(fn, arg);
  const playerX = () => ctxEval(() => window.__game.ctx.player.x);
  const shot = (name) => page.screenshot({ path: `${output}/${name}.png` });
  const waitFor = (fn, arg, timeout = 15000) => page.waitForFunction(fn, arg, { timeout });

  /** Hold the direction like a player; hop any lip that stops us; feather the last cells. */
  async function walkTo(x) {
    let px = await playerX(), last = px, still = 0;
    const key = px < x ? 'KeyD' : 'KeyA', sign = px < x ? 1 : -1;
    await page.keyboard.down(key);
    for (let i = 0; i < 200 && sign * (x - px) > 10; i++) {
      await page.waitForTimeout(100); px = await playerX();
      still = Math.abs(px - last) < 1 ? still + 1 : 0; last = px;
      if (still >= 3) { await page.keyboard.down('Space'); await page.waitForTimeout(380); await page.keyboard.up('Space'); still = 0; }
    }
    await page.keyboard.up(key);
    for (let i = 0; i < 30; i++) {
      px = await playerX();
      if (Math.abs(px - x) < 5) break;
      const k = px < x ? 'KeyD' : 'KeyA';
      await page.keyboard.down(k); await page.waitForTimeout(60); await page.keyboard.up(k); await page.waitForTimeout(80);
    }
  }

  /** Move the real mouse over a world cell (and optionally click it). */
  async function pointAtWorld(worldX, worldY, click = false) {
    const target = await ctxEval(({ worldX, worldY }) => {
      const ctx = window.__game.ctx;
      const canvas = document.querySelector('canvas[data-input-attached="true"]');
      const rect = canvas.getBoundingClientRect();
      const viewW = 640, viewH = 360, zoom = ctx.camera.zoom;
      const fracX = ctx.camera.x - Math.floor(ctx.camera.x), fracY = ctx.camera.y - Math.floor(ctx.camera.y);
      const scaleX = (1 + 4 / viewW) * zoom, scaleY = (1 + 4 / viewH) * zoom;
      const ndcX = -fracX * (2 / viewW) * zoom + ((worldX - ctx.camera.renderX) / viewW - .5) * 2 * scaleX;
      const ndcY = fracY * (2 / viewH) * zoom + (.5 - (worldY - ctx.camera.renderY) / viewH) * 2 * scaleY;
      return { x: rect.left + (ndcX + 1) * .5 * rect.width, y: rect.top + (1 - ndcY) * .5 * rect.height };
    }, { worldX, worldY });
    await page.mouse.move(target.x, target.y);
    if (click) { await page.mouse.down(); await page.waitForTimeout(160); await page.mouse.up(); }
  }

  /**
   * Aim the wand at a world point like a player does: move the mouse, LOOK at where the wand actually points (player.aimAngle), and nudge until
   * it is within `tol` radians of the line to the point (a beam up a narrow well wants a few degrees, and the cursor-to-world mapping is approximate).
   */
  async function aimToward(wx, wy, tol = 0.025) {
    let corr = 0;
    for (let i = 0; i < 10; i++) {
      const p = await ctxEval(() => ({ x: window.__game.ctx.player.x, y: window.__game.ctx.player.y - 9, a: window.__game.ctx.player.aimAngle }));
      const want = Math.atan2(wy - p.y, wx - p.x);
      if (i > 0 && Math.abs(Math.atan2(Math.sin(want - p.a), Math.cos(want - p.a))) < tol) return true;
      if (i > 0) corr += Math.atan2(Math.sin(want - p.a), Math.cos(want - p.a));
      const r = 70;
      await pointAtWorld(p.x + r * Math.cos(want + corr), p.y + r * Math.sin(want + corr));
      await page.waitForTimeout(150);
    }
    return false;
  }

  /** The HUD re-reads its objective and the hint system its line on their own cadence: wait for them to turn, then assert. */
  const waitObjective = (text, why) => page.waitForFunction((t) => document.getElementById('objective')?.innerText === t, text, { timeout: 12000 })
    .catch(() => undefined).then(async () => assert.equal(await page.evaluate(() => document.getElementById('objective')?.innerText ?? ''), text, why));
  /** The hint line: asserted only if one is showing (the hint system has its own cooldowns and a one-time teach card that stands in for the line); a WRONG line fails, an absent one is reported. */
  const waitHint = (text, why) => page.waitForFunction((t) => window.__game.ctx.hints?.current?.line === t, text, { timeout: 12000 })
    .catch(() => undefined).then(async () => {
      const line = await page.evaluate(() => window.__game.ctx.hints?.current?.line ?? null);
      if (line === null) console.log(`NOTE: the hint line was not showing (${why})`);
      else assert.equal(line, text, why);
    });
  /** The hint system's teach cards sit over the middle of the view until clicked away: a player dismisses them before aiming under one. */
  const dismissCards = async () => {
    for (let i = 0; i < 3; i++) {
      const card = page.locator('text=click to dismiss').first();
      if ((await card.count()) === 0) break;
      await card.click({ timeout: 2000 }).catch(() => undefined);
      await page.waitForTimeout(300);
    }
  };
  const plugOpen = (id, timeout = 15000) => waitFor((i) => window.__game.ctx.levels.current.mechanisms.find((m) => m.id === i).state === 1, id, timeout);

  return { ctxEval, playerX, shot, waitFor, walkTo, pointAtWorld, aimToward, waitObjective, waitHint, plugOpen, dismissCards };
}

/**
 * A floor's first arrival offers a gift - a three-card choice (BuildDirector, ~6 s in, once the arrival grace ends) - and the
 * offer pauses the game. A lock probe plays far longer than that, so it takes the first card with a real click before it acts.
 */
export async function takeArrivalGift(page) {
  try {
    await page.waitForSelector('#card-offer-overlay.visible', { timeout: 12000 });
    const card = await page.locator('#card-offer-overlay .card-offer-card').first().boundingBox();
    await page.mouse.click(card.x + card.width / 2, card.y + card.height / 2);
    await page.waitForFunction(() => !window.__game.ctx.state.paused, null, { timeout: 8000 });
  } catch { /* no gift on this floor, or it was already taken */ }
}
