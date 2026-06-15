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
