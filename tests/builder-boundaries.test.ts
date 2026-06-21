import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function runBoundaryCheck(...args: string[]): { error?: Error; output: string; status: number | null } {
  const result = spawnSync(process.execPath, ['scripts/verify-builder-boundaries.mjs', ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return {
    error: result.error,
    output: `${result.stdout}${result.stderr}`,
    status: result.status,
  };
}

describe('builder boundary checker', () => {
  it('passes the current runtime and authoring graph', () => {
    const result = runBoundaryCheck('--strict');

    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.output).toContain('Builder boundary check passed with no violations.');
  });

  it('fails closed for runtime Builder imports and authoring runtime imports', () => {
    const result = runBoundaryCheck('--self-test');

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.output).toContain('Builder boundary violations found:');
    expect(result.output).toContain('src/input/__boundary_self_test.ts static @/builder/document');
    expect(result.output).toContain('runtime/player-facing code imports Builder-owned module');
    expect(result.output).toContain('src/config/__boundary_self_test.ts static @/authoring/../builder/document -> src/builder/document');
    expect(result.output).toContain('src/ui/__boundary_self_test.ts static @/ui/editor/PanelRegistry');
    expect(result.output).toContain('runtime/player-facing code imports Builder editor shell module');
    expect(result.output).toContain('src/authoring/__boundary_self_test.ts static @/game/instantiate');
    expect(result.output).toContain('src/authoring/__boundary_alias_self_test.ts static @/authoring/../game/instantiate -> src/game/instantiate');
    expect(result.output).toContain('neutral authoring contract imports forbidden src/game/');
    expect(result.output).toContain('src/authoring/__boundary_self_test_ctx.ts type Ctx');
    expect(result.output).toContain('neutral authoring contract imports full runtime Ctx');
    expect(result.output).toContain('src/authoring/__boundary_self_test_dom.ts global localStorage');
    expect(result.output).toContain('neutral authoring contract references browser/global API localStorage');
  });
});
