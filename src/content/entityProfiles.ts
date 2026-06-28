import type { EnemyKind } from '@/core/types';

export interface EntityTraitProfile {
  behaviors: string[];
  emotions: string[];
  strengths: string[];
  weaknesses: string[];
}

export interface EntityProfile {
  description: string;
  traits: EntityTraitProfile;
}

export const PLAYER_ENTITY_PROFILE: EntityProfile = {
  description:
    'The procedural wizard: stride-wheel boots, swaying robe, 4-segment spring hat, wand glow toward the aim. ' +
    'He faces your cursor; CAST aims the wand straight at it. ' +
    'TACTICAL SPELLS put him on a firing range — live casts against a target dummy or the practice fort, real cells and all. ' +
    'FORCE PUSH (F) fires the real kick: a blast of air that bursts a patch of ash into flying motes (in play it blows enemies back, smashes small foes into walls, scatters critters, and bends vines).',
  traits: {
    behaviors: [
      'Reads the cursor for facing, wand aim, kicks, pulls, and tactical spell demos.',
      'Walks, jumps, crawls, climbs, dives, skids, and casts through the same runtime controls used in play.',
      'Uses real cells as tools: digging opens terrain, fire burns, water douses, slime gums, and force push moves bodies.',
    ],
    emotions: [
      'Focused under pressure: most poses keep the wand or body angled toward the next action.',
      'Cautious in tight spaces: crawl, climb, and wall-grab poses sell deliberate survival movement.',
      'Defiant when hurt: stagger, hitstop, and robe/hat motion make damage readable without hiding control recovery.',
    ],
    strengths: [
      'Most flexible entity in the cave: movement, wand builds, kicking, material handling, and status effects stack.',
      'Can turn terrain into tactics by carving, burning, freezing, shocking, flooding, or collapsing it.',
      'Progression unlocks higher tempo and stronger tools instead of starting at full speed.',
    ],
    weaknesses: [
      'Low body mass and limited health make careless contact damage expensive.',
      'Bad footing, cramped gaps, pools, fire, acid, toxic clouds, and cold all constrain movement plans.',
      'Early progression is intentionally slower until the player earns stronger traversal and wand options.',
    ],
  },
};

export const ENEMY_ENTITY_PROFILES: Record<EnemyKind, EntityProfile> = {
  slime: {
    description: 'Squash-and-stretch hopper. Splits its gaze around the room until alerted.',
    traits: {
      behaviors: [
        'Charges a visible hop before lunging at close and mid range.',
        'Bites on body contact, then resets through a short cooldown.',
        'Wanders or patrols until alerted, then aims its hops at the alchemist.',
      ],
      emotions: ['Hungry and uncomplicated.', 'Stubborn once it notices prey.', 'More curious than tactical when unalerted.'],
      strengths: [
        'Small footprint makes it easy to hide in broken cave floors.',
        'Burst hops can punish players who stand still after the windup.',
        'Slime blood and splashes create readable green mess in combat spaces.',
      ],
      weaknesses: [
        'Hop windup is clear and punishable.',
        'Short reach forces it to commit to contact.',
        'Acid, fire, freezing, shock, and knockback all interrupt its simple plan.',
      ],
    },
  },
  imp: {
    description: 'Self-lit hover-flapper. Dives in arcs.',
    traits: {
      behaviors: [
        'Hovers at standoff range, strafes, and lobs hostile fireballs.',
        'Uses bobbing flight to stay off floors and above low obstacles.',
        'Keeps pressure from outside melee distance when the player is alive.',
      ],
      emotions: ['Cunning and smug.', 'Aggressive when it has space.', 'Skittish when pinned close.'],
      strengths: [
        'Fire and lava immunity lets it fight comfortably around burning terrain.',
        'Flight ignores most floor hazards and ledges.',
        'Ranged fireballs force movement instead of simple face-tanking.',
      ],
      weaknesses: [
        'Low body mass makes gusts and impacts throw it around.',
        'Cold, water, shock, and hard walls still matter.',
        'Needs space; cramped tunnels reduce its kiting advantage.',
      ],
    },
  },
  golem: {
    description: 'Heavy strider with a pulsing core. Leaves dents in the dark.',
    traits: {
      behaviors: [
        'Marches toward the player, vaults low ledges, and uses thrusters for pits or high ledges.',
        'Throws rocks at range and slams hard on contact.',
        'Punches or erodes blocking terrain when stuck behind a wall.',
      ],
      emotions: [
        'Implacable and blunt.',
        'Patient enough to grind through obstructions.',
        'Angry only in the readable, heavy-footed sense.',
      ],
      strengths: [
        'High health and mass let it shrug off light chaos.',
        'Can solve terrain problems that stop smaller walkers.',
        'Rock volleys and melee slams threaten both range bands.',
      ],
      weaknesses: [
        'Large body is easy to hit and easy to route around.',
        'Slow acceleration gives the player time to bait rocks or reposition.',
        'Gravity, pits, freezing, shock, and terrain traps still create openings.',
      ],
    },
  },
  acidslime: {
    description: 'A slime in acid greens — its blood eats the floor.',
    traits: {
      behaviors: [
        'Uses the slime hop pattern, but leaves corrosive acid at its feet.',
        'Bites on contact with a sharper acid threat.',
        'Bleeds acid into the level when damaged or killed.',
      ],
      emotions: ['Meaner than a normal slime.', 'Instinctive and territorial.', 'Unbothered by the acid it spreads.'],
      strengths: [
        'Immune to acid hazards that kill most enemies.',
        'Acid trail and gore make safe footing worse over time.',
        'Small, hopping profile can carry acid pressure into tight spaces.',
      ],
      weaknesses: [
        'Still telegraphs its hop before committing.',
        'Short reach means it must enter player threat range.',
        'Fire, cold, shock, water displacement, and knockback can break its approach.',
      ],
    },
  },
  wisp: {
    description: 'A guttering diamond of light. The room follows it.',
    traits: {
      behaviors: [
        'Hovers high near the player and fires frostbolts from range.',
        'Retreats harder when cornered.',
        'Radiates cold into nearby cells, freezing water and sometimes skinning lava to stone.',
      ],
      emotions: ['Nervous and watchful.', 'Protective of its personal space.', 'Coldly persistent when it has room.'],
      strengths: [
        'Cold immunity keeps its own frost ecology safe.',
        'Flight and range let it harass across broken terrain.',
        'Can reshape water and lava lanes with cold cell effects.',
      ],
      weaknesses: [
        'Low health makes clean hits matter.',
        'Cornering it removes much of its spacing game.',
        'Fire, acid, shock, and fast projectiles can overwhelm it.',
      ],
    },
  },
  mage: {
    description: 'Hooded telekinetic — hands flare when it channels.',
    traits: {
      behaviors: [
        'Walks slowly while preparing a telegraphed telekinesis volley.',
        'Roots during the channel and throws real debris through the combat stack.',
        'Performs one emergency blink when bloodied, if it can find open space.',
      ],
      emotions: ['Calculating and theatrical.', 'Cowardly once wounded.', 'Confident when terrain gives it ammunition.'],
      strengths: [
        'Long threat range pressures players who turtle behind distance.',
        'Telegraph particles make the attack readable but dangerous.',
        'Emergency blink can reset a losing exchange.',
      ],
      weaknesses: [
        'Slow body and rooted channel are punishable.',
        'Needs room and viable cells for its best tricks.',
        'Close pressure, silence-by-impact, freezing, shock, and fire can break the plan.',
      ],
    },
  },
  bat: {
    description: 'Sleeps on ceilings; wakes as a flutter of leather.',
    traits: {
      behaviors: [
        'Sleeps on ceilings, wakes when disturbed, then flutters into erratic pursuit.',
        'Flares its wings before a committed bite dart.',
        'Hunts moths when the player is not the easiest prey.',
      ],
      emotions: ['Flighty and reactive.', 'Startled from roosting into panic.', 'Predatory only in quick, nervous bursts.'],
      strengths: [
        'Small flying body is hard to pin in open chambers.',
        'Fast bite darts punish players who ignore the flare.',
        'Low mass makes it expressive when kicked or slammed into walls.',
      ],
      weaknesses: [
        'Slime gums its wings, drops it to the floor, and disables its bite for about seven seconds.',
        'Very low health makes clean hits decisive.',
        'Walls, gusts, shock, fire, and cramped ceilings limit its flight lanes.',
      ],
    },
  },
  spitter: {
    description: 'Lobs corrosive gobs from range.',
    traits: {
      behaviors: [
        'Roots into place and lobs arcing acid globs from range.',
        'Recoils visibly after each shot.',
        'Prefers spacing over pursuit.',
      ],
      emotions: ['Patient and defensive.', 'Mean from a distance.', 'Uncomfortable when rushed.'],
      strengths: [
        'Can threaten over uneven terrain and low cover.',
        'Acidglob arcs punish predictable lanes.',
        'Does not need to expose itself to melee to contribute damage.',
      ],
      weaknesses: [
        'Poor mobility once engaged.',
        'Its projectile cadence leaves clear windows to advance.',
        'Close attacks, terrain breaks, shock, cold, and fire can shut it down.',
      ],
    },
  },
  bomber: {
    description: 'Walks its payload to you, fuse first.',
    traits: {
      behaviors: [
        'Fast-hops toward the player and starts a short fuse at close range.',
        'Slows while fusing, then detonates through the normal death explosion path.',
        'Wanders or patrols until a target comes within its chase envelope.',
      ],
      emotions: ['Reckless and eager.', 'Single-minded once it picks a target.', 'Visibly frantic while fusing.'],
      strengths: [
        'High approach speed creates urgent spacing tests.',
        'Explosion punishes panic movement and clustered terrain.',
        'Small profile can enter tunnels before the player notices the fuse.',
      ],
      weaknesses: [
        'Fuse telegraph gives a final disengage window.',
        'Can be baited into blowing terrain or other enemies instead.',
        'Knockback, pits, freezing, shock, and long sightlines expose it.',
      ],
    },
  },
  weaver: {
    description: 'Eight-legged lair guardian. Plants long IK feet, writes vine threads, and stumbles when stripped of growth.',
    traits: {
      behaviors: [
        'Reads real footing under its body and anchors with long procedural legs.',
        'Writes vine threads, bites point-blank, and telegraphs needle or web attacks.',
        'Gets cranky and unstable when its growth support is burned or stripped away.',
      ],
      emotions: [
        'Territorial and calculating.',
        'Patient while supported by its lair.',
        'Agitated when its webbed footing fails.',
      ],
      strengths: [
        'Lair control: vines and anchors turn terrain into a weapon.',
        'Large body and IK legs make its intent readable without making it harmless.',
        'Can pressure walls, floors, and chokepoints instead of only chasing.',
      ],
      weaknesses: [
        'Burning or cutting vine support weakens its confidence and movement.',
        'Large footprint gives terrain edits and area attacks high value.',
        'Shock, fire, footing loss, and forced relocation disrupt its setup.',
      ],
    },
  },
  colossus: {
    description: 'The Kiln Colossus. Water is the strategy.',
    traits: {
      behaviors: [
        'Marches slowly with screen-shaking footfalls.',
        'Ground-slams at close range and throws molten volleys at distance.',
        'Takes thermal-shock damage and loses attack tempo while wet.',
      ],
      emotions: [
        'Furnace-calm and inevitable.',
        'Angry as heat rather than as panic.',
        'Staggered, not frightened, by water.',
      ],
      strengths: [
        'Huge health pool and boss mass ignore normal shove tactics.',
        'Controls both close and medium range with slam and fireball patterns.',
        'Fire identity makes the arena itself feel hostile around it.',
      ],
      weaknesses: [
        'Water is the core counter: dousing cracks it and delays attacks.',
        'Lightning can stun and extend openings.',
        'Very slow movement lets prepared players route the arena.',
      ],
    },
  },
  eggs: {
    description: 'A clutch. It is not dormant.',
    traits: {
      behaviors: [
        'Sits in place as a slime clutch until time or player proximity triggers hatching.',
        'Spawns multiple slimes when it opens.',
        'Pays its bounty if destroyed before the hatch finishes.',
      ],
      emotions: [
        'Quietly ominous.',
        'Dormant only on the surface.',
        'A delayed threat rather than an active hunter.',
      ],
      strengths: [
        'Turns ignored space into future enemy pressure.',
        'Small and low to the ground, easy to miss in clutter.',
        'Forces a prioritization choice: spend damage now or fight the brood later.',
      ],
      weaknesses: [
        'No movement, no chase, and no direct attack.',
        'Low health makes early cleanup efficient.',
        'Fire, acid, shock, freezing, and area spells remove it before it becomes a fight.',
      ],
    },
  },
  leviathan: {
    description: 'The Sunken Leviathan. Water is its armor — take the water away.',
    traits: {
      behaviors: [
        'Swims fast while submerged, lunges after a coiled windup, and volleys pool water at range.',
        'Heaves and flops when beached outside its water armor.',
        'Conductive water and blood make electricity a direct counter while submerged.',
      ],
      emotions: ['Predatory and patient under water.', 'Desperate when drained.', 'Territorial around its cistern.'],
      strengths: [
        'Water armor reduces ordinary damage while submerged.',
        'Fast aquatic pursuit covers the basin quickly.',
        'Can weaponize its own pool instead of leaving the player safe at range.',
      ],
      weaknesses: [
        'Drain the basin and it becomes slow, exposed meat.',
        'Electricity travels through its water and bypasses the shield.',
        'Its lunge has a readable windup that can be baited.',
      ],
    },
  },
  rootloper: {
    description: 'Tanglewrist Root Loper. Plants root-arms into living growth and pulls itself through the cave.',
    traits: {
      behaviors: [
        'Samples nearby vines, moss, fungus, grass, and wood before it commits to movement.',
        'Writes capped patches of soft growth that can become footing, cover, or fuel.',
        'Telegraphs a short tendril lash before striking at close range.',
      ],
      emotions: [
        'Cautious when unrooted.',
        'Predatory when surrounded by growth.',
        'Panicked when fire or acid strips away its anchors.',
      ],
      strengths: [
        'Moves best through overgrown fungal and timber rooms.',
        'Can make traversal scaffolds and combat clutter from real cells.',
        'Its growth can help or hurt the player depending on how the room is used.',
      ],
      weaknesses: [
        'Fire burns its support and forces a stumble window.',
        'Acid and toxic pools undercut its anchor confidence.',
        'Bare stone and metal rooms make it slower and easier to read.',
      ],
    },
  },
  stonemaw: {
    description: 'Stone Maw. A blind burrower that listens through rock and chews only what can safely become a tunnel.',
    traits: {
      behaviors: [
        'Turns toward vibration and pressure, then opens short bites through allowed rock.',
        'Leaves passable pockets and loose spoil instead of creating blockers.',
        'Recoils when cold, acid, or toxic cells touch its chewing face.',
      ],
      emotions: [
        'Patient and subterranean.',
        'Brutal once its mouth finds purchase.',
        'Defensive when its bite is chemically or thermally interrupted.',
      ],
      strengths: [
        'Can create shortcuts, expose ore, and connect hazards in useful or dangerous ways.',
        'Heavy body and high health make it difficult to shove around casually.',
        'Its terrain edits are real, persistent scars in the expedition.',
      ],
      weaknesses: [
        'Metal and glass stop its chewing.',
        'Freeze, acid, toxic sludge, and electrification create reliable stun windows.',
        'Its bounded bite cadence gives players time to bait or avoid the next tunnel.',
      ],
    },
  },
  rillback: {
    description: 'Rillback Silt Eel. A small pool predator whose spine comes alive in liquid and fails on dry stone.',
    traits: {
      behaviors: [
        'Swims through water, blood, and slime with a short coiled lunge.',
        'Flops weakly when beached outside a wet footprint.',
        'Pulses a small charge into nearby water and blood, creating brief conductor threats.',
      ],
      emotions: [
        'Sinuous and confident while submerged.',
        'Desperate and messy on dry ground.',
        'Opportunistic around flooded fights and spilled blood.',
      ],
      strengths: [
        'Wet rooms let it steer freely and attack from odd angles.',
        'Local charge pulses make flooded combat tactically volatile.',
        'Its body language clearly changes between swimming and beaching.',
      ],
      weaknesses: [
        'Draining, freezing, or walling off pools removes most of its threat.',
        'Acid, toxic sludge, and lava punish it like other flesh enemies.',
        'Dry trenches and stone barriers make it predictable.',
      ],
    },
  },
};
