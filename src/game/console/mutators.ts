import type { Ctx } from '@/core/types';
import { difficultyMods } from '@/config/difficulty';
import { MAX_MUTATORS, MUTATOR_DEFS, MUTATOR_ORDER, cleanMutators, isMutatorId, mutatorLoadText } from '@/content/mutators';
import { isRunTainted, taintRun } from '@/core/runTaint';
import type { ConsoleCommandDefinition } from '@/game/console/registry';
import { currentToken, info, matching, result } from '@/game/console/kit';

/**
 * The tester's `mutator` command (complications, content/mutators): list them, put them in force, take them
 * out. Listing never taints. Changing the set does: a complication put on by hand is not the descent the
 * player chose on the title, so the run becomes a test run (no autosave over a real expedition, no ledger
 * credit, no unlocks), like `tier` and `kit`. Registered behind `__AUTHORING__` with the travel commands.
 *
 * The dials follow at once (foes spawned from now on, gravity, damage, healing, gold); the floor dressing
 * (puddles, vents) is laid when a floor is built, so a floor already built keeps what it had, as `tier` does.
 */

const TAINT_SENTENCE = 'DEBUG TAINT: this run is now a test run (no autosave over a real expedition, no ledger credit, no unlocks).';

function names(ids: readonly string[]): string {
  return ids.length === 0 ? 'none' : ids.join(', ');
}

/** The alchemist's health follows the HP dial the way the title's choice would have set it (a ratio, so a hurt alchemist stays hurt in proportion). */
function rescaleHealth(ctx: Ctx, before: number, after: number): void {
  if (before === after || before <= 0) return;
  const ratio = after / before;
  const maxHp = Math.max(1, Math.round(ctx.player.maxHp * ratio));
  ctx.player.hp = Math.max(1, Math.min(maxHp, Math.round(ctx.player.hp * ratio)));
  ctx.player.maxHp = maxHp;
}

export function createMutatorCommands(): ConsoleCommandDefinition[] {
  const defs: ConsoleCommandDefinition[] = [];
  defs.push({
    name: 'mutator',
    aliases: ['mut'],
    info: info('game.mutator', 'Complications', 'mutator [list|add <id>|remove <id>|set <ids>|clear]', 'List the complications, or put them in force for this run. Changing the set taints the run.', 'game'),
    run: (ctx, args) => {
      const now = ctx.mutators?.ids ?? [];
      const verb = (args[0] ?? 'list').toLowerCase();
      if (verb === 'list') {
        const rows = MUTATOR_ORDER.map((id) => {
          const def = MUTATOR_DEFS[id];
          const on = now.includes(id);
          return { id, name: def.name, regulation: def.regulation, weight: def.weight, ladder: def.ladder, on };
        });
        const text = [
          `Complications (* in force; at most ${MAX_MUTATORS}):`,
          ...rows.map((r) => `  ${(r.on ? '* ' : '  ') + r.id.padEnd(14)}${r.name.padEnd(15)}${(r.weight > 0 ? '+' : '') + r.weight}  ${r.regulation}`),
          'mutator add <id> | remove <id> | set <id,id> | clear.',
        ].join('\n');
        return result(true, text, { action: 'mutators', mutators: rows, active: [...now] });
      }
      const wanted = ((): readonly string[] | null => {
        if (verb === 'clear') return [];
        if (verb === 'add' || verb === 'remove') {
          const id = (args[1] ?? '').toLowerCase();
          if (!isMutatorId(id)) return null;
          return verb === 'add' ? [...now, id] : now.filter((n) => n !== id);
        }
        if (verb === 'set') return cleanMutators(args.slice(1).flatMap((a) => a.toLowerCase().split(',')).filter(Boolean));
        return null;
      })();
      if (wanted === null) {
        const bad = verb === 'add' || verb === 'remove' ? ` Unknown complication "${args[1] ?? ''}".` : '';
        return result(false, `Usage: mutator [list|add <id>|remove <id>|set <ids>|clear].${bad} Ids: ${MUTATOR_ORDER.join(', ')}.`, { code: 'usage' });
      }
      if (!ctx.mutators) return result(false, 'mutator: the run systems are not loaded yet.', { code: 'not-ready' });
      if (ctx.state.mode !== 'play') return result(false, 'mutator needs a run in progress.', { code: 'no-run' });
      const next = cleanMutators(wanted);
      if (verb === 'add' && next.length === now.length) {
        return result(false, `${args[1]} is already in force, or ${MAX_MUTATORS} are (the most there may be). Now: ${names(now)}.`, { code: 'no-change', active: [...now] });
      }
      const wasTainted = isRunTainted(ctx.state);
      taintRun(ctx);
      const hpBefore = difficultyMods(ctx.state).playerHp;
      // The run remembers them (its ledger and a resume read the run's own state); with no tracked run the layer is set directly.
      if (!ctx.run?.debugSetMutators?.(ctx, next)) ctx.mutators.activate(ctx, next);
      rescaleHealth(ctx, hpBefore, difficultyMods(ctx.state).playerHp);
      const note = wasTainted ? '' : ` ${TAINT_SENTENCE}`;
      return result(true, `In force: ${names(next)}${next.length > 0 ? ` (${mutatorLoadText(next)})` : ''}. Dials follow now; puddles and vents are laid when a floor is built.${note}`, { action: 'mutator', active: [...next], tainted: true });
    },
    complete: (_ctx, req) => (req.completingArg === 0 ? matching(['list', 'add', 'remove', 'set', 'clear'], currentToken(req)) : req.completingArg === 1 && ['add', 'remove', 'set'].includes((req.args[0] ?? '').toLowerCase()) ? matching(MUTATOR_ORDER, currentToken(req)) : []),
  });
  return defs;
}
