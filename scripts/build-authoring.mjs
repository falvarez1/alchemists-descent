// Production build WITH the authoring surface (Builder route + debug toggles).
//
// A node wrapper rather than `VITE_INCLUDE_BUILDER=1 vite build` in the npm
// script, because that env-var prefix is POSIX shell syntax and npm runs
// scripts through cmd.exe on Windows, where it silently fails — producing a
// PLAY build under a name that promises the opposite. Setting it here works on
// every platform.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['vite', 'build'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, VITE_INCLUDE_BUILDER: '1' },
});
process.exit(result.status ?? 1);
