// THE OWNERSHIP MAP (docs/split/SPLIT-PLAN.md, Phase 0): which package or app every module in src/ is headed for, and
// who may import whom once the repo is split. The survey (survey.mjs) and the ratchet test
// (tests/split-boundaries.test.ts) both read it; this file is the map, the generated per-module listing is
// verify-out/split/survey.json.
//
// A module's owner is its OVERRIDES entry if it has one, else the first RULES match. The rules are broad strokes
// (a folder, a naming pattern); the overrides are the cases the strokes get wrong, each with the reason. When a
// phase moves a module's job (a framework pulled out of campaign code), change its owner here in the same commit.

// Arena-named modules that are not the arena: campaign test arenas, the lantern, a terrain plane.
const NOT_ARENA = /^(game\/Lantern|world\/(wardenArenas|weaverArena|physicsArena|sandboxArena|looseStock)|render\/terrainArtPlane)\.ts$/;
const ARENA_NAMED = /^(arena|fighters)\/|^render\/(duel|player\/looks)\/|^net\/duel\/|duel|arena|fighter|versus|stock|foundry|lobby/i;

/** First match wins. */
export const RULES = [
  ['kernel', /^game\/Game\.ts$/], // the composition root: splits into the engine kernel + one root per app (Phase 2)
  ['ui-kit', /^ui\/foundryKit\.ts$/],
  ['fighters', /^fighters\/(?!telemetry\/\w+Harness)|^content\/fighter(s|Bodies|Loadouts|Techniques)\.ts$|^core\/fighter(s|Body)\.ts$|^render\/player\/(looks\/|FighterArt|fighterLook)|^render\/(FighterFx|fighterReveal)\.ts$/],
  ['clashforged', /^config\/ai\w+\.ts$|^game\/console\/(arena|fighters|ai)\.ts$/],
  ['clashforged', (m) => ARENA_NAMED.test(m) && !NOT_ARENA.test(m)],
  ['authoring', /^builder\/|^ui\/editor\/|^app\/(AuthorLink\w*|BuilderHost|BuilderLauncher|LinkControl|authorLink\w*|builder\w*)\.ts$|^net\/(AuthorLinkClient|authorLinkProtocol|tuningPatch)\.ts$/],
  ['descent', /^(game|world|ui|content|app)\/|^main\.ts$/],
  ['descent', /^config\/(biomes|difficulty\w*|floorLooks|gen|pacing|worldgraph)\.ts$/],
  ['descent', /^core\/(boons|run|runTaint|progressionPacing|story|grimoireStore)\.ts$/],
  ['descent', /^audio\/(Narrator|narration\w*)\.ts$/],
  // The creature ROSTER and its art are campaign content (plan 4.5: the engine keeps the enemy framework and a kind
  // registry; the roster registers from Descent). The framework modules beside them stay engine (the fallback).
  ['descent', /^creatures\/(species|bosses)\/|^render\/creatures\/(bat|brute|gel|imp|lens|lizard|mage|rime|rootloper|serpents|weaver|wisp)\.ts$/],
  ['descent', /^(creatures\/weaverAnatomy|entities\/weaverLocomotion|render\/sprites\/WeaverRigSprites)\.ts$/],
  // The campaign's own render layers (plan 4.5: the tea machine, flora, organisms and story figures register as
  // FrameComposer layers from the app).
  ['descent', /^render\/(TeaMachineDecor|TeaMachineLinkages|organisms|WorksFixtures|HabitatScenery|FloraArt|FloraPainter)\.ts$|^render\/story\//],
  ['engine', /./],
];

/** Modules the rules place wrongly. Reason first, so a reviewer can argue with it. */
export const OVERRIDES = {
  // The kernel's fixed-step accumulator (plan 4.1: the engine keeps the loop), not campaign code.
  'game/FixedStepClock.ts': 'engine',
  // The console FRAMEWORK (plan 4.5: apps register command packs into it); the packs stay with their game.
  'game/console/registry.ts': 'engine',
  'game/console/kit.ts': 'engine',
  // The engine's own SFX bank and its catalog (plan 4.5 and section 5: materials, explosions, spells, player foley).
  'content/audio/sfxCues.ts': 'engine',
  'content/audio/sfxCatalog.ts': 'engine',
  'content/audio/sfxManifest.ts': 'engine',
  // The score's data format: MusicDirector streams it, and both games' generated scores are written in it.
  'content/audio/scoreTypes.ts': 'engine',
  // A DOM focus trap with no game in it; the Builder and the fighter roster both use it.
  'ui/modalFocusTrap.ts': 'engine',
};

export function owner(m) {
  if (Object.hasOwn(OVERRIDES, m)) return OVERRIDES[m];
  for (const [pkg, rule] of RULES) if (typeof rule === 'function' ? rule(m) : rule.test(m)) return pkg;
  return 'engine';
}

/** Who may depend on whom in the target layout (type-only imports count: a package's types are its API). */
export const ALLOWED = {
  engine: ['engine'],
  'ui-kit': ['ui-kit', 'engine'],
  fighters: ['fighters', 'engine'],
  authoring: ['authoring', 'engine'],
  descent: ['descent', 'engine', 'authoring'],
  clashforged: ['clashforged', 'engine', 'fighters', 'ui-kit', 'authoring'],
  kernel: ['kernel', 'engine', 'descent', 'clashforged', 'fighters', 'ui-kit', 'authoring'],
};

/** Shared code (headed for the engine, Descent or authoring) that names an arena service through ctx. */
export const SEAM_RE = /ctx\.(fighters|arena|versus|duel)\b/g;
export const SEAM_OWNERS = ['engine', 'descent', 'authoring'];
