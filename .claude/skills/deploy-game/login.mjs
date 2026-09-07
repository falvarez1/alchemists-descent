// Log wrangler in to Cloudflare as the account that owns the Pages project.
//
//   node .claude/skills/deploy-game/login.mjs
//
// The OAuth page auto-approves for whoever the BROWSER is signed in as, so the
// browser must already be on frankishere@gmail.com (the "Ajar Red" account)
// before this starts. This script: frees the callback port a stale login may be
// holding, logs out any wrong identity, starts the login detached (its output
// goes to a log file — never pipe it through `tail`, that buffers the URL until
// exit), waits for the user to click Allow, then proves the right account is
// visible. Standalone wrangler 4.129 because the repo-local one crashes on an
// esbuild version mismatch.
import { execSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const ACCOUNT_ID = '55c36c9de5247e3c193b45cdf43bb054';
const EMAIL = 'frankishere@gmail.com';
const CALLBACK_PORT = 8976;
const WRANGLER = ['npx', '-y', '-p', 'wrangler@4.129.0', 'wrangler'];

const run = (extra, opts = {}) =>
  spawnSync(WRANGLER[0], [...WRANGLER.slice(1), ...extra], { shell: true, encoding: 'utf8', ...opts });

// A previous login still listening on the callback port makes the next one fail to bind.
const stale = execSync('netstat -ano', { encoding: 'utf8' })
  .split('\n')
  .filter((l) => l.includes(`:${CALLBACK_PORT} `) && l.includes('LISTENING'))
  .map((l) => l.trim().split(/\s+/).pop());
for (const pid of new Set(stale)) {
  console.log(`killing stale OAuth callback listener pid ${pid}`);
  spawnSync('taskkill', ['/F', '/PID', pid], { shell: true, stdio: 'inherit' });
}

const before = run(['whoami']).stdout || '';
if (before.includes(ACCOUNT_ID)) {
  console.log(`already logged in as ${EMAIL} with access to the project account.`);
  process.exit(0);
}
if (before.includes('logged in')) {
  console.log('logged in as the wrong identity — logging out first');
  run(['logout'], { stdio: 'inherit' });
}

const dir = join(process.env.LOCALAPPDATA || '.', 'Temp', 'alchemists-descent-deploy');
mkdirSync(dir, { recursive: true });
const log = join(dir, `wrangler-login-${Date.now()}.log`);
const fd = openSync(log, 'w');
const child = spawn(WRANGLER[0], [...WRANGLER.slice(1), 'login'], { shell: true, stdio: ['ignore', fd, fd], detached: true });
child.unref();

console.log(`A Cloudflare authorization page is opening in the default browser.`);
console.log(`Make sure that browser is signed in as ${EMAIL}, then click Allow.`);
console.log(`(login output: ${log})`);

const deadline = Date.now() + 10 * 60 * 1000;
let text = '';
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, 2000));
  text = readFileSync(log, 'utf8');
  if (/Successfully logged in|ERROR|denied/.test(text)) break;
}
if (!/Successfully logged in/.test(text)) {
  console.error('login did not complete:\n' + text.split('\n').slice(-6).join('\n'));
  process.exit(1);
}

const after = run(['whoami']).stdout || '';
const email = after.match(/associated with the email (\S+)/)?.[1] ?? '?';
if (!after.includes(ACCOUNT_ID)) {
  console.error(
    `logged in as ${email}, but that identity cannot see the project account "Ajar Red".\n` +
      `Sign the browser in as ${EMAIL} and run this again.`,
  );
  process.exit(1);
}
console.log(`logged in as ${email}; the project account is visible. Deploys will work now.`);
