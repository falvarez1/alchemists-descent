const DEATH_LINES: Record<string, string[]> = {
  unknown: [
    'The caves decline to specify. Suspicious.',
    'Cause of death: alchemy happened.',
    'The descent wrote the report in dust.',
  ],
  probe: ['A debug probe ended the experiment. Very scientific.'],
  fire: [
    'Cooked by open flame. The robe was not rated for this.',
    'Fire solved the alchemist problem.',
  ],
  burning: [
    'Burned to death while still technically on fire.',
    'Stopped, dropped, and forgot the rolling part.',
  ],
  'oiled-fire': [
    'Oiled, then lit. Classic wizard candle behavior.',
    'Turned into a lesson about accelerants.',
  ],
  lava: [
    'Lava bath. Zero stars, no refund.',
    'Attempted geology by immersion.',
  ],
  acid: [
    'Dissolved by acid. Very clean work, chemically speaking.',
    'Acid reduced the alchemist to a smaller argument.',
  ],
  toxic: [
    'Poison did the paperwork slowly.',
    'Toxic sludge won the debate.',
  ],
  electrocution: [
    'Electrocuted. The sparks were not applause.',
    'Conducted electricity better than good judgment.',
  ],
  'wet-electrocution': [
    'Self-inflicted electrocution in water. Excellent conductivity, poor planning.',
    'Wet, shocked, and briefly educational.',
  ],
  explosion: [
    'Exploded by local cave policy.',
    'A blast made a persuasive counterargument.',
  ],
  'self-explosion': [
    'Self-inflicted explosion. The wand technically worked.',
    'Own spell, own crater.',
  ],
  'barrel-explosion': [
    'An explosive barrel fulfilled its destiny nearby.',
    'Barrel chemistry: one, alchemist: zero.',
  ],
  gunpowder: [
    'Gunpowder remembered it was gunpowder.',
    'Powder line became a full stop.',
  ],
  lightning: [
    'Self-administered lightning. Bold, brief.',
    'Lightning found the shortest path through you.',
  ],
  'hostile-fireball': [
    'A hostile fireball delivered kiln-to-door service.',
    'Fireball to the face. Elegant? No. Effective? Yes.',
  ],
  frostbolt: [
    'Frozen stiff by a hostile frostbolt.',
    'Put on ice by something with aim.',
  ],
  acidglob: [
    'Tagged by an acid glob. The glob was smug about it.',
    'A caustic lob made its point.',
  ],
  'slime-bite': [
    'A slime bounced, bit, and somehow won.',
    'Slime contact: humiliating, but documented.',
  ],
  'acidslime-bite': [
    'An acid slime turned a hug into a hazard.',
    'Acid slime contact. Sticky, sour, final.',
  ],
  'bat-bite': [
    'A bat cashed in the smallest possible assassination.',
    'Bitten out of the air by a flying nuisance.',
  ],
  'weaver-bite': [
    'The Weaver got its revenge.',
    'The Weaver filed you under caught.',
    'The Weaver brought teeth. The web was optional.',
  ],
  'weaver-needle': [
    'Pinned by the Weaver. No corkboard survived.',
    'The Weaver threaded the needle through you.',
  ],
  'leviathan-bite': [
    'The Leviathan surfaced for a snack.',
    'Eaten by the problem in the pool.',
  ],
  'leviathan-water': [
    'The Leviathan threw the pool at you.',
    'Defeated by high-velocity plumbing.',
  ],
  'leviathan-graze': [
    'The Leviathan brushed past and took most of you with it.',
    'Grazed by a basement-sized appetite.',
  ],
  'golem-slam': [
    'A golem explained gravity with its fists.',
    'Flattened by stone with an opinion.',
  ],
  'golem-rock': [
    'Rock, thrown by golem. Case closed.',
    'A golem skipped the warning and threw punctuation.',
  ],
  'powder-mage-debris': [
    'A Powder Mage made the cave throw things at you.',
    'Telekinetic debris: local, organic, fatal.',
  ],
  'hostile-debris': [
    'Hostile debris introduced itself at speed.',
    'Hit by cave mail, postage due.',
  ],
  'colossus-slam': [
    'The Kiln Colossus stamped your ticket.',
    'A furnace with fists ended the expedition.',
  ],
  'colossus-fireball': [
    'The Kiln Colossus served you extra crispy.',
    'Molten rock, express delivery.',
  ],
  'colossus-death': [
    'The Kiln died loudly and took you as a footnote.',
    'Victory explosion. Timing could improve.',
  ],
  bomber: [
    'A bomber slime chose mutual destruction. You were not consulted.',
    'The fuse had one joke.',
  ],
  impact: [
    'Killed by impact. The floor was technically uninvolved.',
    'Physics submitted the final blow.',
  ],
  status: [
    'A status effect finished the job quietly.',
    'The aftereffect got the last word.',
  ],
};

function normalizeDeathSource(source: string | null | undefined): string {
  if (!source) return 'unknown';
  return DEATH_LINES[source] ? source : 'unknown';
}

export function deathCauseLine(source: string | null | undefined, frame = 0): string {
  const key = normalizeDeathSource(source);
  const lines = DEATH_LINES[key] ?? DEATH_LINES.unknown;
  return lines[Math.abs(Math.floor(frame)) % lines.length];
}

export function knownDeathCauseSources(): string[] {
  return Object.keys(DEATH_LINES).sort();
}
