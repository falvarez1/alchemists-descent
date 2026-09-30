function summarizeResult(result) {
  try {
    return JSON.stringify(result);
  } catch {
    return String(result);
  }
}

function appendOption(parts, name, value) {
  if (value === undefined || value === null || value === '') return;
  parts.push(name, String(value));
}

function appendListOption(parts, name, value) {
  if (value === undefined || value === null || value === '') return;
  parts.push(name, Array.isArray(value) ? value.join(',') : String(value));
}

function appendFlaskOptions(parts, options) {
  if (Array.isArray(options.flasks)) {
    const specs = options.flasks.map((flask) => {
      if (!flask || flask.material === null || flask.material === undefined) return 'empty';
      return flask.count !== undefined ? `${flask.material}:${flask.count}` : String(flask.material);
    });
    appendOption(parts, '--flasks', specs.join(','));
    appendOption(parts, '--active-flask', options.activeFlaskIndex !== undefined ? Number(options.activeFlaskIndex) + 1 : undefined);
    return;
  }
  const flask = options.flask;
  if (flask && typeof flask === 'object' && !Array.isArray(flask)) {
    const material = flask.material === null ? 'empty' : flask.material;
    if (material !== undefined && material !== '') {
      appendOption(parts, '--flask', flask.count !== undefined ? `${material}:${flask.count}` : material);
      return;
    }
  }
  appendOption(parts, '--flask', flask ?? options.flaskMaterial);
  appendOption(parts, '--flask-count', options.flaskCount);
}

export function buildRunCommand(options = {}) {
  const subcommand = options.subcommand ?? options.mode ?? 'test';
  const parts = ['run', subcommand];
  appendOption(parts, '--level', options.level ?? options.levelId);
  appendOption(parts, '--seed', options.seed);
  appendOption(parts, '--loadout', options.loadout);
  appendOption(parts, '--world', options.world ?? options.worldSource);
  appendOption(parts, '--gold', options.gold);
  appendOption(parts, '--hp', options.hp);
  appendOption(parts, '--max-hp', options.maxHp ?? options.maxHP);
  appendOption(parts, '--levit', options.levit ?? options.maxLevit);
  appendListOption(parts, '--cards', options.cards);
  appendListOption(parts, '--perks', options.perks);
  appendFlaskOptions(parts, options);
  return parts.join(' ');
}

export async function waitForConsoleApi(page, { timeout = 20000 } = {}) {
  await page.waitForFunction(
    () => typeof window.__game?.ctx?.console?.exec === 'function',
    null,
    { timeout },
  );
}

export async function execConsoleCommand(page, command, { timeout = 20000, rejectOnError = true } = {}) {
  await waitForConsoleApi(page, { timeout });
  const result = await page.evaluate(async (line) => window.__game.ctx.console.exec(line), command);
  if (rejectOnError && !result?.ok) {
    throw new Error(`Console command failed: ${command}\n${summarizeResult(result)}`);
  }
  return result;
}

export async function waitForRunReady(page, { timeout = 30000 } = {}) {
  await page.waitForFunction(
    () => {
      const ctx = window.__game?.ctx;
      return ctx?.state?.mode === 'play' && ctx.levels?.current != null && !ctx.levels?.transitioning;
    },
    null,
    { timeout },
  );
}

export function isBenignDevConsoleError(text) {
  return (
    /WebSocket connection to 'ws:\/\/[^']+' failed: Error in connection establishment: net::ERR_CONNECTION_REFUSED/.test(
      String(text),
    )
  );
}

export async function startConsoleRun(page, options = {}) {
  const {
    clearSavedExpedition = true,
    timeout = 30000,
    settleMs = 0,
    waitForReady = true,
  } = options;

  await waitForConsoleApi(page, { timeout });
  if (clearSavedExpedition) {
    await page.evaluate(() => localStorage.removeItem('noita-expedition'));
  }

  const command = options.command ?? buildRunCommand(options);
  const result = await execConsoleCommand(page, command, { timeout });
  if (waitForReady) await waitForRunReady(page, { timeout });
  if (settleMs > 0) await page.waitForTimeout(settleMs);
  return result;
}

export async function startConsoleTestRun(page, options = {}) {
  return startConsoleRun(page, { subcommand: 'test', loadout: 'advanced', ...options });
}

export async function startConsolePlayRun(page, options = {}) {
  return startConsoleRun(page, { subcommand: 'new', ...options });
}

export async function getGameViewSize(page) {
  return page.evaluate(async () => {
    const constants = await import('/src/config/constants.ts');
    return { w: constants.VIEW_W, h: constants.VIEW_H };
  });
}

export async function worldToBuilderClient(page, wx, wy, options = {}) {
  const view = options.viewSize ?? await getGameViewSize(page);
  const overlayId = options.overlayId ?? 'builder-overlay';
  return page.evaluate(({ wx, wy, view, overlayId }) => {
    const ctx = window.__game.ctx;
    const overlay = document.getElementById(overlayId);
    if (!overlay) throw new Error(`missing #${overlayId}`);
    const r = overlay.getBoundingClientRect();
    const ux = ((wx - ctx.camera.renderX) / view.w - 0.5) * ctx.camera.zoom + 0.5;
    const uy = ((wy - ctx.camera.renderY) / view.h - 0.5) * ctx.camera.zoom + 0.5;
    return { x: r.left + ux * r.width, y: r.top + uy * r.height };
  }, { wx, wy, view, overlayId });
}

/**
 * Open the Runtime Inspector during a run. The play screen hides the header
 * (and its RUNTIME button), so authoring builds open it with F9 — but only in
 * Play: wait for the run to be in play and unpaused first, and press again if
 * a slow machine swallowed the first press. Throws with the game's state if it
 * never opens, so a CI failure says why.
 */
export async function openRuntimeInspector(page, { timeout = 15000 } = {}) {
  await page.waitForFunction(() => window.__game?.ctx?.state?.mode === 'play', null, { timeout });
  for (let attempt = 0; attempt < 3; attempt++) {
    if (await page.locator('#runtime-inspector.open').count()) return;
    await page.keyboard.press('F9');
    const opened = await page
      .waitForSelector('#runtime-inspector.open', { state: 'attached', timeout: 4000 })
      .then(() => true)
      .catch(() => false);
    if (opened) return;
  }
  const state = await page.evaluate(() => ({
    mode: window.__game?.ctx?.state?.mode,
    paused: window.__game?.ctx?.state?.paused,
    active: document.activeElement?.tagName + '#' + (document.activeElement?.id ?? ''),
    inspector: document.getElementById('runtime-inspector')?.className ?? 'missing',
  }));
  throw new Error(`Runtime Inspector did not open on F9: ${JSON.stringify(state)}`);
}

/**
 * The app boots to the title screen, which covers the Workshop's toolbar and header
 * (their buttons are `not visible` to a real click). An author's way into the material
 * sandbox is Workshops > Material sandbox. The fold remembers being open from an
 * earlier visit: only open it when shut. Leaves the app in the Sandbox (mode 'build'),
 * unpaused, header reachable.
 */
export async function enterSandboxFromTitle(page, { timeout = 30000 } = {}) {
  await page.locator('#expedition-entry').waitFor({ state: 'visible', timeout });
  if (!(await page.locator('#expedition-entry .entry-workshops').evaluate((d) => d.open))) {
    await page.locator('#expedition-entry .entry-workshops > summary').click();
  }
  await page.locator('#expedition-entry [data-entry="sandbox"]').click();
  await page.locator('#expedition-entry').waitFor({ state: 'hidden', timeout: 10000 });
}

/**
 * A first descent opens on the story's plates (~9 s, the world held still behind
 * them; any key skips them). The plates' class lands a beat AFTER `play-active`, so
 * wait to see them start (a resumed run has none), then for them to end. A probe
 * that presses a key or judges movement before this is skipping the opening, not
 * testing the game.
 */
export async function waitForOpeningEnd(page, { timeout = 45000 } = {}) {
  await page
    .waitForFunction(() => document.body.classList.contains('story-cinema-active'), null, { timeout: 4000 })
    .catch(() => undefined);
  await page.waitForFunction(() => !document.body.classList.contains('story-cinema-active'), null, { timeout });
}

/**
 * The Sanctum's descent asks for a boon AND a door: below floors 1-3 the stair forks
 * (`button.sanc-door[data-level]`); above the Kiln there is one way down and the game
 * chooses it. Real clicks: a boon, then `levelId`'s door when the stair forks (the
 * first door when `levelId` is omitted), leaving the descend button armed.
 */
export async function chooseBoonAndDoor(page, levelId) {
  await page.locator('#perk-row .perk-card').first().click();
  const doors = page.locator('#sanctum-overlay .sanc-door');
  if ((await doors.count()) > 0) {
    const wanted = levelId ? page.locator(`#sanctum-overlay .sanc-door[data-level="${levelId}"]`) : doors;
    await wanted.first().click();
  }
}
