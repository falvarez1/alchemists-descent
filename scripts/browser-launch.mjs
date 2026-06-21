import { chromium } from 'playwright-core';

const activeBrowsers = new Set();
let cleanupInstalled = false;

async function closeActiveBrowsers() {
  const browsers = [...activeBrowsers];
  activeBrowsers.clear();
  await Promise.all(browsers.map((browser) => browser.close().catch(() => undefined)));
}

function installCleanupHandlers() {
  if (cleanupInstalled) return;
  cleanupInstalled = true;
  process.once('SIGINT', async () => {
    await closeActiveBrowsers();
    process.exit(130);
  });
  process.once('SIGTERM', async () => {
    await closeActiveBrowsers();
    process.exit(143);
  });
  process.once('uncaughtException', async (error) => {
    console.error(error);
    await closeActiveBrowsers();
    process.exit(1);
  });
  process.once('unhandledRejection', async (reason) => {
    console.error(reason);
    await closeActiveBrowsers();
    process.exit(1);
  });
}

function trackBrowser(browser) {
  activeBrowsers.add(browser);
  browser.on('disconnected', () => activeBrowsers.delete(browser));
  installCleanupHandlers();
  return browser;
}

/**
 * Browser launcher for local probes: prefer Edge on developer machines, then
 * fall back to Playwright's managed Chromium when CI provides one.
 */
export async function launchBrowser(options = {}) {
  const headless = options.headless ?? process.env.PLAYWRIGHT_HEADLESS !== '0';
  const preferredChannel = process.env.PLAYWRIGHT_BROWSER_CHANNEL ?? 'msedge';
  const launchOptions = { ...options, headless };
  delete launchOptions.channel;

  if (preferredChannel && preferredChannel !== 'chromium') {
    try {
      return trackBrowser(await chromium.launch({ ...launchOptions, channel: preferredChannel }));
    } catch (error) {
      if (process.env.PLAYWRIGHT_REQUIRE_CHANNEL === '1') throw error;
      console.warn(
        `Playwright could not launch ${preferredChannel}; falling back to managed Chromium. ` +
          `Set PLAYWRIGHT_REQUIRE_CHANNEL=1 to make this fatal.`,
      );
    }
  }

  try {
    return trackBrowser(await chromium.launch(launchOptions));
  } catch (error) {
    throw new Error(
      'Playwright could not launch Edge or managed Chromium. Install Edge or run `npx playwright install chromium`.\n' +
        String(error),
    );
  }
}
