import type { CommandInfo, CommandResult, ConsoleApi, Ctx } from '@/core/types';

/**
 * ctx.console with the command set (game/console/commands, ~55 KB) loaded on
 * first use. A player build never opens the console; the dev console, the
 * AuthorLink `cmd` relay and the headless probes all go through the async
 * `exec`, which first waits for `beforeExec` (the play systems) so a
 * `run test …` issued the moment the title shows starts a complete run.
 * `complete`/`list` answer empty until the commands are in (they are asked
 * for, and arrive within a frame or two).
 */
export function createLazyConsoleApi(ctx: Ctx, beforeExec: () => Promise<unknown>, opts: { eager?: boolean } = {}): ConsoleApi {
  let api: ConsoleApi | null = null;
  let pending: Promise<ConsoleApi> | null = null;
  const load = (): Promise<ConsoleApi> => {
    pending ??= import('@/game/console/commands').then(({ createConsoleApi }) => (api = createConsoleApi(ctx)));
    return pending;
  };
  const prefetch = (): void => {
    load().catch((error: unknown) => console.warn('[console] the command set could not load', error));
  };
  // Authoring builds open the console at will: fetch the commands with the boot.
  if (opts.eager) prefetch();
  return {
    async exec(line: string): Promise<CommandResult> {
      const [commands] = await Promise.all([load(), beforeExec()]);
      return commands.exec(line);
    },
    complete(partial: string): string[] {
      if (api) return api.complete(partial);
      prefetch();
      return [];
    },
    list(): CommandInfo[] {
      if (api) return api.list();
      prefetch();
      return [];
    },
  };
}
