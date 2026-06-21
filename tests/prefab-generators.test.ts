import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('prefab generators', () => {
  it('match the committed builtin prefab JSON', () => {
    expect(runNodeScript('scripts/gen-builtin-prefabs.mjs', '--check')).toBe('');
  });

  it('match the committed machine prefab JSON', () => {
    expect(runNodeScript('scripts/gen-machine-prefabs.mjs', '--check')).toBe('');
  });
});

function runNodeScript(script: string, flag: string): string {
  const result = spawnSync(process.execPath, [script, flag], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return [result.stdout, result.stderr].filter(Boolean).join('\n');
  }
  return '';
}
