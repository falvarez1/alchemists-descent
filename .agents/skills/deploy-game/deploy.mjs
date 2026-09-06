// Build a git ref in a clean detached worktree and publish it to Cloudflare Pages.
//
//   node .agents/skills/deploy-game/deploy.mjs <ref> [--skip-tests] [--keep]
//
// Why a worktree: branch checkouts are usually dirty with WIP, and "publish the
// branch" means the COMMITTED tip. Why the standalone wrangler: the repo-local
// 4.114 crashes on an esbuild host/binary mismatch. Why the explicit account id:
// the OAuth token spans several accounts and only "Ajar Red" owns the project.
// See SKILL.md next to this file for the full story.
import { execFileSync, execSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ACCOUNT_ID = '55c36c9de5247e3c193b45cdf43bb054'; // "Ajar Red" (personal login)
const PROJECT = 'alchemists-descent';
const LIVE_URL = 'https://alchemists-descent.pages.dev';
const WRANGLER = 'npx -y -p wrangler@4.129.0 wrangler';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: node .agents/skills/deploy-game/deploy.mjs <ref> [--skip-tests] [--keep]');
  process.exit(0);
}
const ref = args.find((a) => !a.startsWith('--'));
const skipTests = args.includes('--skip-tests');
const keep = args.includes('--keep');
if (!ref) {
  console.error('usage: node deploy.mjs <ref> [--skip-tests] [--keep]');
  process.exit(2);
}

const repo = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
const sh = (cmd, opts = {}) => {
  console.log(`\n$ ${cmd}`);
  const r = spawnSync(cmd, { shell: true, stdio: 'inherit', cwd: repo, ...opts });
  if (r.status !== 0) {
    console.error(`\nFAILED (exit ${r.status}): ${cmd}`);
    process.exit(r.status ?? 1);
  }
};
const out = (cmd, opts = {}) => execSync(cmd, { cwd: repo, encoding: 'utf8', ...opts }).trim();

// Never build with AuthorLink credentials — they would ship in the public bundle.
const env = { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT_ID };
delete env.VITE_AUTHORLINK_RELAY;
delete env.VITE_AUTHORLINK_TOKEN;
delete env.VITE_INCLUDE_BUILDER;
delete env.GH_PAGES;

// 0. Identity — fail early with the fix, not after a 3-minute build.
const who = out(`${WRANGLER} whoami`, { stdio: ['ignore', 'pipe', 'pipe'] });
if (!who.includes(ACCOUNT_ID)) {
  console.error(
    'wrangler is not logged in as an account that owns the project.\n' +
      'Run: node .agents/skills/deploy-game/login.mjs  (browser must be signed in as frankishere@gmail.com)',
  );
  process.exit(1);
}

const commit = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], {
  cwd: repo, encoding: 'utf8',
}).trim();
const sha = out(`git rev-parse --short ${commit}`);
const subject = out(`git log -1 --format=%s ${commit}`);
console.log(`Publishing ${ref} @ ${sha}: ${subject}`);

// 1. Clean detached worktree in the scratchpad (or the OS temp dir when run by hand).
const scratch =
  process.env.DEPLOY_GAME_SCRATCHPAD ||
  join(tmpdir(), 'alchemists-descent-deploy');
mkdirSync(scratch, { recursive: true });
const wt = mkdtempSync(join(resolve(scratch), `deploy-${sha}-`));
sh(`git worktree add --detach "${wt}" ${commit}`);

const depsChanged = out(`git diff ${commit} --stat -- package.json package-lock.json`) !== '';
const nm = join(wt, 'node_modules');
let junctioned = false;
if (!depsChanged && existsSync(join(repo, 'node_modules'))) {
  // A junction, not a copy: identical deps, and cleanup must NOT delete the real one.
  sh(`cmd /c mklink /J "${nm}" "${join(repo, 'node_modules')}"`);
  junctioned = true;
} else {
  console.log('dependencies differ from the current checkout — npm ci in the worktree');
  sh('npm ci', { cwd: wt });
}

const cleanup = () => {
  if (keep) return console.log(`kept worktree at ${wt}`);
  if (junctioned) spawnSync(`cmd /c rmdir "${nm}"`, { shell: true, stdio: 'inherit' });
  spawnSync(`git worktree remove --force "${wt}"`, { shell: true, stdio: 'inherit', cwd: repo });
};
process.on('exit', cleanup);

// 2–3. Build (tsc strict + vite) and test the exact tree being shipped.
sh('npm run build', { cwd: wt, env });
if (!skipTests) sh('npx vitest run', { cwd: wt, env });

const built = readdirSync(join(wt, 'dist', 'assets')).find((f) => /^index-.*\.js$/.test(f));
if (!built) {
  console.error('dist/assets has no index-*.js chunk');
  process.exit(1);
}
if (existsSync(join(wt, 'dist', 'builder.html'))) {
  console.error('dist contains builder.html — this is an authoring build, not the play build');
  process.exit(1);
}

// 4. Deploy to the production branch of the Pages project.
sh(
  `${WRANGLER} pages deploy dist --project-name ${PROJECT} --branch main --commit-dirty=true`,
  { cwd: wt, env },
);

// 5. The live root must reference the chunk we just built.
const html = await (await fetch(LIVE_URL + '/', { cache: 'no-store' })).text();
if (!html.includes(`assets/${built}`)) {
  console.error(`live site does not reference ${built} yet — wrong account/branch, or propagation delay. Re-check in a minute.`);
  process.exit(1);
}
console.log(`\nlive: ${LIVE_URL} serves assets/${built}`);

// 6. Play it the way a tester meets it. The probe runs from the CURRENT checkout,
// not the shipped worktree: it must know every cold-load flow (mode bar PLAY and
// the expedition-entry screen), and an older branch's copy may predate one.
sh(`node scripts/verify-hosted-game.mjs ${LIVE_URL}`, { cwd: repo });

console.log(`\nPublished ${sha} (${subject}) to ${LIVE_URL}`);
