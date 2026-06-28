import type { CardDef, EnemyDef, EnemyKind, MaterialParams } from '@/core/types';
import { ALL_CARD_IDS, CARD_DEFS } from '@/combat/wands/cards';
import { REVIEW_WAND_LOADOUTS, STARTING_WAND_LOADOUTS, WAND_FRAMES } from '@/combat/wands/wandCatalog';
import { ENEMY_DEFS } from '@/content/enemyDefs';
import { POTION_DEFS } from '@/core/pickupDefs';
import { RECIPES } from '@/content/recipes';
import { LEVELS, populationForLevel } from '@/config/worldgraph';
import { EXTRAS } from '@/world/biomeExtras';
import type { ContentDependency, ContentItem, ContentStatus } from '@/content/types';

export interface ContentRegistryInput {
  materials?: Record<number, MaterialParams>;
}

export function listBuiltInContent(input: ContentRegistryInput = {}): ContentItem[] {
  const items: ContentItem[] = [
    ...listCards(),
    ...listWandFrames(),
    ...listWandLoadouts(),
    ...listPotions(),
    ...listRecipesAndElixirs(input.materials ?? {}),
    ...listMaterials(input.materials ?? {}),
    ...listEnemies(),
    ...listEncounterScenarios(),
    ...listSpellLabScenarios(),
  ];
  return [...items, buildCookReport(items)];
}

function listCards(): ContentItem[] {
  return ALL_CARD_IDS.map((id) => {
    const def = CARD_DEFS[id];
    const kind = def.kind === 'projectile' ? 'card' : 'modifier';
    const status: ContentStatus | undefined =
      id === 'watertrail' ||
      id === 'oiltrail' ||
      id === 'electriccharge' ||
      id === 'critwet' ||
      id === 'shorthoming' ||
      id === 'frostcharge' ||
      id === 'shattercrit'
        ? 'review'
        : undefined;
    return item({
      id,
      kind,
      name: def.name,
      description: def.blurb,
      tags: [
        'spell',
        def.kind,
        `mana-${def.manaCost}`,
        kind === 'modifier' ? 'wand-shaping' : 'payload',
        ...(status ? [status] : []),
      ],
      status,
      source: 'src/combat/wands/cards.ts:CARD_DEFS',
      dependencies: [
        dep('code', 'src/combat/wands/compiler.ts', 'compiler reads card kind and grouping rules'),
        dep('code', 'src/combat/wands/WandSystem.ts', 'runtime executes the compiled action'),
        dep('test', 'tests/wands.test.ts', 'wand compiler and cast behavior coverage'),
        ...cardMaterialDeps(def),
      ],
      payload: def,
    });
  });
}

function listWandFrames(): ContentItem[] {
  return Object.values(WAND_FRAMES).map((frame) => item({
    id: frame.id,
    kind: 'wandFrame',
    name: frame.name,
    description: `${frame.capacity} slots, ${frame.manaMax} mana, ${frame.castDelay}f cast delay, ${frame.recharge}f recharge.`,
    tags: ['wand', 'frame', `capacity-${frame.capacity}`],
    source: 'src/combat/wands/WandSystem.ts:WAND_FRAMES',
    dependencies: [
      dep('code', 'src/combat/wands/WandSystem.ts', 'runtime frame stats and save/load path'),
      dep('code', 'src/ui/Hud.ts', 'HUD mirrors active wand frame slots'),
    ],
    payload: frame,
  }));
}

function listWandLoadouts(): ContentItem[] {
  return [...STARTING_WAND_LOADOUTS, ...REVIEW_WAND_LOADOUTS].map((loadout) => item({
    id: loadout.id,
    kind: 'wandLoadout',
    name: loadout.name,
    description: `${loadout.frameId} frame with ${loadout.cards.join(', ')}.`,
    tags: ['wand', 'loadout', loadout.status],
    status: loadout.status,
    source: 'src/combat/wands/WandSystem.ts:STARTING_WAND_LOADOUTS/REVIEW_WAND_LOADOUTS',
    dependencies: [
      dep('wandFrame', loadout.frameId, 'loadout frame'),
      ...loadout.cards.map((id) => {
        const def = CARD_DEFS[id];
        return dep(def.kind === 'projectile' ? 'card' : 'modifier', id, 'slotted card');
      }),
    ],
    payload: loadout,
  }));
}

function listPotions(): ContentItem[] {
  return Object.entries(POTION_DEFS).map(([id, potion]) => item({
    id,
    kind: 'potion',
    name: titleCase(potion.name),
    description: `${potion.frames} frames of ${potion.status}.`,
    tags: ['pickup', 'potion', potion.status],
    source: 'src/core/pickupDefs.ts:POTION_DEFS',
    dependencies: [
      dep('status', potion.status, 'timed player status'),
      dep('code', 'src/game/Pickups.ts', 'pickup collection applies the timer'),
    ],
    payload: { id, ...potion },
  }));
}

function listRecipesAndElixirs(materials: Record<number, MaterialParams>): ContentItem[] {
  const out: ContentItem[] = [];
  for (const recipe of RECIPES) {
    out.push(item({
      id: recipe.id,
      kind: 'recipe',
      name: titleCase(recipe.name),
      description: recipe.needs.map((need) => `${need.min} ${materialName(materials, need.cell)}`).join(' + '),
      tags: ['brew', 'recipe'],
      source: 'src/game/Brewing.ts:RECIPES',
      dependencies: [
        dep('elixir', `cell-${recipe.elixir}`, 'brews this elixir'),
        ...recipe.needs.map((need) => dep('material', `cell-${need.cell}`, `requires ${need.min} cells`)),
        dep('code', 'src/game/Brewing.ts', 'cauldron sampler and transmutation'),
      ],
      payload: recipe,
    }));
    out.push(item({
      id: `cell-${recipe.elixir}`,
      kind: 'elixir',
      name: titleCase(recipe.name),
      description: `Brewed cell ${recipe.elixir}; discovered through the ${recipe.id} recipe.`,
      tags: ['brew', 'elixir', `cell-${recipe.elixir}`],
      source: 'src/game/Brewing.ts:RECIPES',
      dependencies: [
        dep('recipe', recipe.id, 'discovery recipe'),
        dep('material', `cell-${recipe.elixir}`, 'runtime material produced by the brew'),
      ],
      payload: { id: recipe.id, name: recipe.name, cell: recipe.elixir },
    }));
  }
  return out;
}

function listMaterials(materials: Record<number, MaterialParams>): ContentItem[] {
  return Object.entries(materials).map(([rawId, params]) => {
    const id = Number(rawId);
    const tags = ['cell', 'material', ...materialParamTags(params)];
    return item({
      id: `cell-${id}`,
      kind: 'material',
      name: params.name ?? `Cell ${id}`,
      description: materialDescription(id, params),
      tags,
      source: 'src/config/params.ts:MATERIAL_PARAMS',
      dependencies: [dep('cell', String(id), 'stable Cell id')],
      payload: { id, ...params },
    });
  });
}

function listEnemies(): ContentItem[] {
  return (Object.entries(ENEMY_DEFS) as Array<[EnemyKind, EnemyDef]>).map(([kind, def]) => item({
    id: kind,
    kind: 'enemy',
    name: titleCase(kind),
    description: `${def.hp} hp, ${def.bounty} gold bounty, ${def.h} cells tall.`,
    tags: ['enemy', `hp-${def.hp}`, `bounty-${def.bounty}`],
    source: 'src/entities/Enemies.ts:ENEMY_DEFS',
    dependencies: [
      dep('material', `cell-${def.gore}`, 'death/gore material'),
      dep('code', 'src/entities/Enemies.ts', 'AI and combat behavior'),
    ],
    payload: { kind, hp: def.hp, halfW: def.halfW, h: def.h, bounty: def.bounty, gore: def.gore },
  }));
}

function listEncounterScenarios(): ContentItem[] {
  return Object.values(LEVELS).map((level) => {
    const foes = EXTRAS[level.biome].foes;
    const population = populationForLevel(level, foes);
    const specialPopulation: Record<string, number> = {};
    if (foes.bat) specialPopulation.bat = 3;
    if (foes.slime) specialPopulation.eggs = 1;
    const combinedPopulation = { ...population };
    for (const [kind, count] of Object.entries(specialPopulation)) {
      combinedPopulation[kind as keyof typeof combinedPopulation] = (combinedPopulation[kind as keyof typeof combinedPopulation] ?? 0) + count;
    }
    return item({
      id: level.id,
      kind: 'encounterScenario',
      name: titleCase(level.name),
      description: `${level.biome} depth ${level.depth}${level.branch ? ' branch' : ''} encounter envelope.`,
      tags: ['encounter', 'level', level.biome, level.branch ? 'branch' : 'spine'],
      source: 'src/config/worldgraph.ts:LEVELS',
      dependencies: Object.entries(combinedPopulation)
        .filter(([, count]) => (count ?? 0) > 0)
        .map(([enemy, count]) => dep('enemy', enemy, `${count} generated foes at this depth`)),
      payload: { ...level, population: combinedPopulation, foes, specialPopulation },
    });
  });
}

function listSpellLabScenarios(): ContentItem[] {
  return [...STARTING_WAND_LOADOUTS, ...REVIEW_WAND_LOADOUTS].map((loadout) => item({
    id: `${loadout.id}-spell-lab`,
    kind: 'spellLabScenario',
    name: `${loadout.name} Lab`,
    description: `Read-only Spell Lab metadata for the ${loadout.name} loadout.`,
    tags: ['spell-lab', 'scenario', loadout.status],
    status: loadout.status === 'review' ? 'review' : 'editorOnly',
    source: 'src/combat/wands/WandSystem.ts:*_WAND_LOADOUTS',
    dependencies: [dep('wandLoadout', loadout.id, 'loadout under test')],
    payload: { id: `${loadout.id}-spell-lab`, loadoutId: loadout.id, cards: loadout.cards },
  }));
}

function buildCookReport(items: readonly ContentItem[]): ContentItem {
  const counts = items.reduce<Record<string, number>>((acc, item) => {
    acc[item.kind] = (acc[item.kind] ?? 0) + 1;
    return acc;
  }, {});
  const reviewCount = items.filter((item) => item.status === 'review').length;
  const messages = [
    `${items.length} built-in content items indexed`,
    `${reviewCount} review item(s) require explicit promotion before shipping`,
    'Spell Lab scenarios are read-only metadata until the scenario store lands',
  ];
  return item({
    id: 'builtin-content-cook',
    kind: 'cookReport',
    name: 'Built-in Content Cook Report',
    description: 'Generated summary of the built-in content registry indexed by the Builder Asset Database.',
    tags: ['cook', 'report', 'content'],
    status: 'editorOnly',
    source: 'src/content/registry.ts:listBuiltInContent',
    dependencies: [],
    validation: { errors: 0, warnings: 1, infos: messages.length, messages },
    payload: { counts, reviewCount, generatedFrom: 'built-in-content-registry' },
  });
}

function item<TPayload>(input: Omit<ContentItem<TPayload>, 'status' | 'validation'> & {
  status?: ContentStatus;
  validation?: ContentItem<TPayload>['validation'];
}): ContentItem<TPayload> {
  return {
    ...input,
    status: input.status ?? 'live',
    validation: input.validation ?? { errors: 0, warnings: 0, infos: 0, messages: [] },
  };
}

function dep(kind: ContentDependency['kind'], id: string, reason: string): ContentDependency {
  return { kind, id, reason };
}

function cardMaterialDeps(def: CardDef): ContentDependency[] {
  const deps: ContentDependency[] = [];
  if (def.id === 'flame') deps.push(dep('material', 'cell-5', 'emits fire'));
  if (def.id === 'bomb') deps.push(dep('material', 'cell-8', 'blast/gunpowder behavior'));
  if (def.id === 'vitriol') deps.push(dep('material', 'cell-7', 'sprays acid'));
  if (def.id === 'cryojet') deps.push(dep('material', 'cell-16', 'sprays liquid nitrogen'));
  if (def.id === 'frostshard' || def.id === 'icelance' || def.id === 'frostcharge' || def.id === 'shattercrit') {
    deps.push(dep('material', 'cell-10', 'freezing/ice behavior'));
  }
  if (def.id === 'meteor' || def.id === 'conjure') deps.push(dep('material', 'cell-12', 'creates or throws stone'));
  if (def.id === 'vitrify') deps.push(dep('material', 'cell-31', 'creates glass'));
  return deps;
}

function materialParamTags(params: MaterialParams): string[] {
  const tags: string[] = [];
  if (params.flowRate !== undefined) tags.push('liquid');
  if (params.flammability !== undefined || params.burnDuration !== undefined || params.igniteChance !== undefined) tags.push('flammable');
  if (params.bloomWeight !== undefined) tags.push('emissive');
  if (params.conductivity !== undefined) tags.push('conductor');
  if (params.corrosiveSpeed !== undefined) tags.push('corrosive');
  return tags;
}

function materialDescription(id: number, params: MaterialParams): string {
  const keys = Object.keys(params).filter((key) => key !== 'name');
  return keys.length > 0 ? `Cell ${id}: ${keys.join(', ')}.` : `Cell ${id}: runtime material.`;
}

function materialName(materials: Record<number, MaterialParams>, cell: number): string {
  return materials[cell]?.name ?? `cell ${cell}`;
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_-]+/g)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(' ');
}
