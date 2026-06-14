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

export function buildRunCommand(options = {}) {
  const subcommand = options.subcommand ?? options.mode ?? 'test';
  const parts = ['run', subcommand];
  appendOption(parts, '--level', options.level ?? options.levelId);
  appendOption(parts, '--seed', options.seed);
  appendOption(parts, '--loadout', options.loadout);
  appendOption(parts, '--world', options.world ?? options.worldSource);
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
