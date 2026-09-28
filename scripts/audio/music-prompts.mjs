// The score of Breathing Works: every cue as an ElevenLabs music_v2_5
// composition plan. OFFLINE ONLY — gen-music.mjs turns these into the MP3s in
// public/audio/music/ and the manifest src/content/audio/score.generated.ts.
//
// One musical identity. The title theme is generated first and stored
// server-side; later cues name a window of it (or of their floor's exploration
// track) as an audio reference on their first chunk, which carries the palette
// and feel through the score. The leitmotif itself — "the Breathing Works
// theme", a slow four-note figure that climbs a fifth and sighs back down by
// step — is written into every cue's arrangement in words, in a key and tempo
// the model holds exactly. A floor's exploration and tension cues share key and
// tempo, so the director's crossfade between them never changes harmony.
//
// Floors are the refinery's organs, so each floor has its own band:
//   The Bellows (lungs)        harmonium, bowed cello, a breathing bellows pulse
//   The Rot Gardens (gut)      woody marimba, detuned music box, spore shimmer, insects
//   The Drowned Cisterns (veins) glass harmonica, slow low strings, drips, pressure
//   The Kiln Heart (heart)     forge percussion, low brass swells, a heat drone

export const MUSIC_MODEL = 'music_v2_5';

/** Never in this score. The first chunk's styles weigh most, so every cue repeats these there. */
export const NEVER = [
  'vocals', 'singing', 'choir', 'humming', 'spoken word', 'lyrics',
  'EDM', 'trap beat', 'drum machine', 'dubstep', 'synth lead', 'electric guitar',
  'pop song', 'trailer braams', 'lo-fi hip hop', 'modern pop production',
];

const THEME = 'the Breathing Works theme: a slow, memorable four-note melody that climbs a fifth and sighs back down by step';
const LOOPS = 'seamless loop, no ending, no fade out, return to the opening texture';

/**
 * @typedef {{ text: string, duration_ms: number, positive_styles: string[], negative_styles?: string[], context_adherence?: 'low'|'medium'|'high' }} Chunk
 * @typedef {{
 *   id: string, label: string, group: string, role: 'title'|'explore'|'tension'|'boss'|'sanctum'|'tea'|'workshop'|'victory'|'fallen',
 *   floor?: string, loop: boolean, key: string, bpm: number, summary: string, lufs?: number,
 *   condition?: { cue: string, startMs: number, endMs: number, strength: 'low'|'medium'|'high'|'xhigh' },
 *   chunks: Chunk[], variant?: number,
 * }} Cue
 */

/** First chunk gets the cue's full identity; later chunks inherit it and add their local turn. */
function plan(identity, sections) {
  return sections.map(([text, seconds, styles = [], extra = {}], i) => ({
    text,
    duration_ms: Math.round(seconds * 1000),
    positive_styles: i === 0 ? [...identity, ...styles] : [...styles],
    negative_styles: NEVER,
    ...extra,
  }));
}

/** @type {Cue[]} */
export const CUES = [
  // ------------------------------------------------------------------ title
  {
    id: 'title', label: 'Title — The Breathing Works', group: 'Score · Title', role: 'title', loop: true,
    key: 'D minor', bpm: 72,
    summary: 'The theme. A bellows breath and a harmonium drone; the music box states the four-note theme, the cello sings it, low brass joins in chorale over tapped copper pipes; the music box alone again, slowing.',
    chunks: plan(
      ['instrumental only', 'Victorian industrial chamber music', 'D minor', '72 BPM', 'harmonium', 'bowed cello', 'music box',
        'glass harmonica', 'low brass', 'bellows breathing pulse', 'restrained, intimate, dry wit', 'warm stone hall reverb', 'acoustic, hand-played'],
      [
        ['[Intro]\n{a great bellows breathes in and out; a harmonium drone on D swells with each breath; brass gauges tick faintly}', 14, ['sparse', 'slow swells']],
        [`[Theme]\n{music box states ${THEME}; harmonium chords breathe underneath}`, 24, ['music box melody', 'harmonium chords', 'soft bowed cello pedal on D']],
        ['[Theme II]\n{a bowed cello sings the theme, warm and unhurried; glass harmonica shimmers above; the bellows pulse continues}', 26, ['expressive solo cello', 'glass harmonica shimmer', 'harmonium']],
        ['[Swell]\n{low brass joins in a quiet chorale on the theme; tapped copper pipes keep time like a slow machine}', 24, ['low brass chorale', 'tuba and euphonium', 'metallic percussion, tapped pipes', 'gentle crescendo']],
        ['[Coda]\n{everything falls away; the music box plays the theme one last time, slowing; the bellows exhale; ring out}', 32, ['music box alone', 'decrescendo', 'long reverb tail']],
      ],
    ),
  },

  // ------------------------------------------------------------ the Bellows
  {
    id: 'bellows', label: 'Floor 1 — The Bellows', group: 'Score · Floors', role: 'explore', floor: 'd1', loop: true,
    key: 'D minor', bpm: 72, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'medium' },
    summary: 'The lungs. Harmonium chords rising and falling on a two-bar bellows breath, cello fragments of the theme, ticking gauges and soft pipe knocks, the music box answering.',
    chunks: plan(
      ['instrumental only', 'ambient exploration underscore for a video game', 'Victorian industrial chamber music', 'D minor', '72 BPM',
        'harmonium', 'bowed cello', 'bellows breathing pulse every two bars', 'soft metallic ticks and distant pipe knocks', 'faint steam hiss',
        'patient, curious, restrained', 'no drum kit'],
      [
        ['[Breath]\n{the bellows breathe on a slow two-bar cycle; harmonium chords rise and fall with each breath}', 30],
        ['[Theme fragment]\n{the cello hums a fragment of the Breathing Works theme, then leaves space}', 36, ['bowed cello, sparse phrases', 'harmonium', 'space between phrases']],
        ['[Works]\n{gauges tick and pipes knock softly in rhythm; the harmonium holds; a curious pizzicato line wanders}', 36, ['pizzicato cello', 'ticking metallic percussion', 'curious']],
        [`[Theme]\n{a music box answers with ${THEME}, over the breathing harmonium}`, 36, ['music box', 'harmonium', 'bowed cello pedal']],
        ['[Return]\n{back to the bare breathing harmonium of the opening; keep the cycle going}', 38, ['harmonium', 'bellows breathing pulse', LOOPS]],
      ],
    ),
  },
  {
    id: 'bellows-tension', label: 'Floor 1 — The Bellows (hunted)', group: 'Score · Tension', role: 'tension', floor: 'd1', loop: true,
    key: 'D minor', bpm: 72, condition: { cue: 'bellows', startMs: 0, endMs: 30000, strength: 'medium' },
    summary: 'The same key and tempo with the breath quickened to panting: a driving cello ostinato on D, a low brass pedal, the theme turned sharp on muted brass, clanking pipes on the beat.',
    chunks: plan(
      ['instrumental only', 'tense video game combat underscore', 'D minor', '72 BPM', 'urgent cello spiccato ostinato', 'harmonium drone',
        'bellows panting in short quick breaths', 'low brass pedal', 'metallic clanks on the beat', 'taut, dangerous, restrained, never bombastic', 'no drum kit'],
      [
        ['[Alarm]\n{the bellows pant in short quick breaths; a cello ostinato on D drives in eighth notes}', 22],
        ['[Pursuit]\n{a low brass pedal swells; a fragment of the Breathing Works theme turns sharp on muted brass; pipes clank on each beat}', 24, ['muted brass', 'low brass pedal']],
        ['[Pressure]\n{the ostinato tightens; pressure valves hiss; the harmonium grinds a cluster}', 22, ['pressure valve hiss', 'harmonium cluster']],
        ['[Loop]\n{return to the opening ostinato; keep the tension going}', 20, [LOOPS]],
      ],
    ),
  },

  // -------------------------------------------------------- the Rot Gardens
  {
    id: 'rot', label: 'Floor 2 — The Rot Gardens', group: 'Score · Floors', role: 'explore', floor: 'd2', loop: true,
    key: 'E minor', bpm: 66, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'low' },
    summary: 'The gut. Woody marimba dripping like sap, glassy spore shimmer, clicking insects, a detuned music box playing the theme as if grown over, a creeping bass clarinet.',
    chunks: plan(
      ['instrumental only', 'ambient exploration underscore for a video game', 'dark whimsical fungal garden', 'E minor', '66 BPM',
        'woody marimba', 'detuned music box', 'col legno strings', 'spore shimmer: soft glassy sparkles', 'insect textures: clicks, chirrs, rustles',
        'bass clarinet', 'damp, organic, strange but gentle'],
      [
        ['[Spores]\n{soft marimba pulses like dripping sap; glassy spores drift and sparkle; insects click in the undergrowth}', 30],
        [`[Theme, overgrown]\n{a detuned music box plays ${THEME}, slightly out of tune, as if grown over}`, 36, ['detuned music box', 'marimba']],
        ['[Growth]\n{a bass clarinet creeps upward; col legno strings tap like beetles; marimba patterns overlap}', 36, ['bass clarinet', 'col legno strings', 'polyrhythmic marimba']],
        ['[Bloom]\n{a slow bloom of warm low strings under the marimba; the spores sparkle}', 36, ['warm low strings', 'spore shimmer']],
        ['[Return]\n{back to the soft marimba pulse and insect clicks of the opening}', 38, ['marimba', 'insect clicks', LOOPS]],
      ],
    ),
  },
  {
    id: 'rot-tension', label: 'Floor 2 — The Rot Gardens (hunted)', group: 'Score · Tension', role: 'tension', floor: 'd2', loop: true,
    key: 'E minor', bpm: 66, condition: { cue: 'rot', startMs: 0, endMs: 30000, strength: 'medium' },
    summary: 'The garden notices you: a fast woody marimba ostinato in double time, rattling col legno strings, a buzzing insect swarm, growling bass clarinet and contrabassoon, detuned music-box stabs.',
    chunks: plan(
      ['instrumental only', 'tense video game chase underscore', 'E minor', '66 BPM, double-time feel', 'fast woody marimba ostinato',
        'col legno strings rattling', 'insect swarm buzzing texture', 'bass clarinet and contrabassoon growls', 'detuned music box stabs',
        'hungry, creeping, restrained, never bombastic', 'no drum kit'],
      [
        ['[Stir]\n{the marimba snaps into a fast ostinato; insects swarm; col legno strings rattle}', 22],
        ['[Hunger]\n{contrabassoon growls a fragment of the Breathing Works theme; detuned music box stabs}', 24, ['contrabassoon', 'detuned music box']],
        ['[Swarm]\n{the swarm thickens; marimba and strings overlap in tense cross-rhythms}', 22, ['cross-rhythms', 'insect swarm']],
        ['[Loop]\n{return to the opening ostinato; keep the tension going}', 20, [LOOPS]],
      ],
    ),
  },

  // --------------------------------------------------- the Drowned Cisterns
  {
    id: 'cisterns', label: 'Floor 3 — The Drowned Cisterns', group: 'Score · Floors', role: 'explore', floor: 'd3', loop: true,
    key: 'C minor', bpm: 60, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'low' },
    summary: 'The veins. Drips into deep water, a cold held string chord, the glass harmonica singing the theme as if through water, sub-bass pressure, a lone muted horn far away.',
    chunks: plan(
      ['instrumental only', 'ambient exploration underscore for a video game', 'submerged flooded cistern', 'C minor', '60 BPM',
        'glass harmonica', 'slow low strings', 'water drips with long echoes', 'sub-bass swells like water pressure', 'muffled underwater tone',
        'vast, cold, patient, melancholy'],
      [
        ['[Surface]\n{drips fall into deep water with long echoes; low strings hold a cold chord}', 30],
        [`[Theme, drowned]\n{a glass harmonica sings ${THEME}, slowly, as if heard through water}`, 36, ['glass harmonica melody', 'low strings']],
        ['[Current]\n{slow low string swells move like a current; sub-bass pressure; drips}', 36, ['low string swells', 'sub-bass pressure']],
        ['[Deep]\n{a lone muted horn echoes a fragment of the theme far away; glass harmonica overtones}', 36, ['distant muted horn', 'glass harmonica overtones']],
        ['[Return]\n{back to the drips and the cold held string chord of the opening}', 38, ['water drips', 'held low strings', LOOPS]],
      ],
    ),
  },
  {
    id: 'cisterns-tension', label: 'Floor 3 — The Drowned Cisterns (hunted)', group: 'Score · Tension', role: 'tension', floor: 'd3', loop: true,
    key: 'C minor', bpm: 60, condition: { cue: 'cisterns', startMs: 0, endMs: 30000, strength: 'medium' },
    summary: 'Something moves below: a pulsing low-string ostinato, a deep muffled heartbeat drum, eerie high glass harmonica, sonar pings and sub-bass surges.',
    chunks: plan(
      ['instrumental only', 'tense underwater video game underscore', 'C minor', '60 BPM', 'pulsing low string ostinato', 'deep muffled heartbeat drum',
        'eerie high glass harmonica tones', 'sonar-like pings', 'sub-bass surges', 'something huge moving below', 'restrained dread, never bombastic'],
      [
        ['[Pulse]\n{low strings pulse; a muffled heartbeat drum; a glass harmonica tone hangs high and thin}', 22],
        ['[Sonar]\n{sonar pings; a sub-bass surge; low brass murmurs a fragment of the Breathing Works theme}', 24, ['sonar pings', 'low brass murmur']],
        ['[Undertow]\n{the pulse quickens slightly; surges pull beneath}', 22, ['sub-bass surges']],
        ['[Loop]\n{return to the opening pulse; keep the tension going}', 20, [LOOPS]],
      ],
    ),
  },

  // -------------------------------------------------------- the Kiln Heart
  {
    id: 'kiln', label: 'Floor 4 — The Kiln Heart', group: 'Score · Floors', role: 'explore', floor: 'd4', loop: true,
    key: 'A minor', bpm: 80, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'low' },
    summary: 'The heart. A deep shimmering heat drone, a distant anvil on the downbeat, low brass swells carrying the theme, hammered iron and bellows roar, a faint music box among the embers.',
    chunks: plan(
      ['instrumental only', 'exploration underscore for a video game', 'volcanic furnace heart of an industrial refinery', 'A minor', '80 BPM',
        'forge percussion: anvil strikes, hammered iron', 'low brass swells', 'heat drone: deep shimmering organ-like drone', 'cello and double bass',
        'bellows roar', 'smouldering, heavy, heat haze, restrained'],
      [
        ['[Heat]\n{a deep heat drone shimmers; a distant anvil strikes on the downbeat of every bar}', 30],
        [`[Theme, forged]\n{low brass swells carry ${THEME}, slowly, over the drone}`, 36, ['low brass swells', 'heat drone']],
        ['[Forge]\n{hammered iron patterns and bellows roars; cellos and basses dig in}', 36, ['hammered iron percussion', 'cellos and basses']],
        ['[Embers]\n{the drone thins; a music box plays the theme faintly among crackling embers}', 36, ['music box, faint', 'crackling embers']],
        ['[Return]\n{back to the heat drone and the distant anvil of the opening}', 38, ['heat drone', 'distant anvil', LOOPS]],
      ],
    ),
  },
  {
    id: 'kiln-tension', label: 'Floor 4 — The Kiln Heart (hunted)', group: 'Score · Tension', role: 'tension', floor: 'd4', loop: true,
    key: 'A minor', bpm: 80, condition: { cue: 'kiln', startMs: 0, endMs: 30000, strength: 'medium' },
    summary: 'The furnace turns on you: a driving anvil and forge-drum ostinato, low brass stabs, roaring bellows, a cello and bass ostinato over the heat drone.',
    chunks: plan(
      ['instrumental only', 'tense video game combat underscore', 'A minor', '80 BPM', 'driving anvil and forge-drum ostinato', 'low brass stabs',
        'roaring bellows', 'heat drone', 'cello and double bass ostinato', 'dangerous, heavy, restrained'],
      [
        ['[Flare]\n{anvils and forge drums lock into a driving ostinato; the heat drone rises}', 22],
        ['[Stab]\n{low brass stabs a fragment of the Breathing Works theme; the bellows roar}', 24, ['low brass stabs', 'roaring bellows']],
        ['[Crucible]\n{cellos and basses churn; anvils ring off the beat}', 22, ['syncopated anvils']],
        ['[Loop]\n{return to the opening ostinato; keep the tension going}', 20, [LOOPS]],
      ],
    ),
  },

  // ----------------------------------------------------------------- bosses
  {
    id: 'boss-leviathan', label: 'Boss — The Sunken Leviathan', group: 'Score · Bosses', role: 'boss', loop: true,
    key: 'C minor', bpm: 90, condition: { cue: 'cisterns-tension', startMs: 0, endMs: 30000, strength: 'medium' },
    summary: 'Aquatic menace in the Cisterns\' key: surging low strings, deep water drums and timpani, roaring low brass with the theme inverted, glass harmonica shrieks, the sub-bass of a great body moving through water.',
    chunks: plan(
      ['instrumental only', 'boss battle music for a video game', 'aquatic menace', 'C minor', '90 BPM', 'surging low string ostinato',
        'deep water drums and timpani', 'low brass roars', 'glass harmonica shrieks', 'sub-bass surges like a great body moving through water', 'heavy, dangerous'],
      [
        ['[Emergence]\n{the water heaves; timpani roll; a glass harmonica shrieks; low brass roars once}', 18],
        ['[Assault]\n{surging low string ostinato with deep water drums; brass answers in hits}', 30, ['string ostinato', 'water drums']],
        ['[Theme, monstrous]\n{massive low brass plays the Breathing Works theme inverted and menacing}', 30, ['massive low brass', 'timpani']],
        ['[Undertow]\n{the drums drop to a churning pulse; glass harmonica wails; sub-bass surges}', 22, ['churning pulse']],
        ['[Loop]\n{return to the surging assault; no ending}', 20, [LOOPS]],
      ],
    ),
  },
  {
    id: 'boss-colossus', label: 'Boss — The Kiln Colossus', group: 'Score · Bosses', role: 'boss', loop: true,
    key: 'D minor', bpm: 100, condition: { cue: 'kiln-tension', startMs: 0, endMs: 30000, strength: 'medium' },
    summary: 'The final door, back in the home key of D minor: massive low brass, anvils and hammered iron, big forge drums, roaring bellows, a cello-and-bass ostinato, and the theme blazing on full brass. No choir.',
    chunks: plan(
      ['instrumental only', 'final boss battle music for a video game', 'industrial furnace colossus', 'D minor', '100 BPM',
        'massive low brass: tubas, trombones, horns', 'anvils and hammered iron percussion', 'huge forge drums', 'roaring bellows',
        'cello and double bass ostinato', 'heat drone', 'weighty, relentless, heroic desperation'],
      [
        ['[Awakening]\n{the kiln roars awake; anvils ring; the drone swells to full heat}', 18],
        ['[Onslaught]\n{forge drums and a cello-bass ostinato drive; brass hammers on the off-beats}', 30, ['forge drums', 'brass hits']],
        ['[Theme, defiant]\n{the Breathing Works theme blazes on full brass over anvils}', 32, ['full brass', 'anvils']],
        ['[Crucible]\n{the ostinato climbs; bellows roar; anvils ring in cross-rhythm}', 30, ['rising ostinato', 'cross-rhythm anvils']],
        ['[Loop]\n{return to the onslaught; no ending}', 30, [LOOPS]],
      ],
    ),
  },

  // ------------------------------------------------------------ the story
  // THE KILN ESCAPE (wave 3): the Heart's last heave, and the climb up the old
  // flue ahead of the lava. The title theme, urgent: the same D minor at double
  // time, driving strings and timpani, the four-note figure hammered on brass,
  // then the whole ensemble carrying the theme upward. It loops (a climb that
  // takes longer, or starts again, never runs out of music).
  {
    id: 'escape', label: 'The Kiln Escape — the last heave', group: 'Score · Story', role: 'escape', loop: true,
    key: 'D minor', bpm: 144, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'high' },
    summary: 'The title theme at double time: a great heave and a gasp of the bellows, then driving spiccato strings and timpani, the four-note figure hammered on low brass, and the full ensemble carrying the theme upward, climbing and climbing. No choir.',
    chunks: plan(
      ['instrumental only', 'urgent escape sequence music for a video game', 'D minor', '144 BPM', 'driving spiccato strings in sixteenths',
        'timpani and big orchestral drums', 'low brass: tubas, trombones, horns', 'harmonium', 'bellows breath', 'relentless, heroic, breathless, rising',
        'no drum kit'],
      [
        ['[Heave]\n{a vast low boom and a great gasp of bellows; timpani rolls; strings snap into a driving ostinato}', 8, ['huge impact', 'timpani roll']],
        [`[Climb]\n{urgent spiccato strings race in sixteenths; low brass hammers the four-note Breathing Works theme; timpani drive every beat}`, 24, ['spiccato strings', 'low brass', 'timpani']],
        [`[Theme, urgent]\n{the full ensemble states ${THEME} fast and defiant, horns leading, harmonium underneath}`, 24, ['full orchestra', 'horns lead', 'harmonium']],
        ['[Rising]\n{the music climbs a step at a time, key rising, strings reaching higher, bells and brass pushing upward}', 20, ['rising modulation', 'tubular bells', 'soaring strings']],
        ['[Loop]\n{back to the racing string ostinato and hammered brass; keep climbing; no ending}', 14, ['spiccato strings', LOOPS]],
      ],
    ),
  },
  // THE ENDING: clean air rising up the flue, Kettleby opening a window. The
  // theme at rest at last, in D major: the music box alone, then the cello, the
  // harmonium breathing slow and easy, one warm swell of strings.
  {
    id: 'ending', label: 'The Ending — the Works breathe easy', group: 'Score · Story', role: 'ending', loop: false, lufs: -17,
    key: 'D major', bpm: 66, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'medium' },
    summary: 'The theme at rest in D major: the music box alone, the cello answering, the harmonium breathing slow and easy, one warm swell of strings, a long held chord.',
    chunks: plan(
      ['instrumental only', 'gentle ending music for a video game', 'D major', '66 BPM', 'music box', 'bowed cello', 'harmonium', 'soft strings',
        'glass harmonica', 'tender, relieved, bittersweet, hopeful', 'quiet hall reverb'],
      [
        [`[Morning]\n{a music box plays ${THEME}, slowly, in D major; the bellows breathe out, easy at last}`, 12, ['music box alone']],
        ['[Answer]\n{the cello answers with the theme, warm and unhurried; harmonium chords breathe underneath}', 12, ['solo cello', 'harmonium']],
        ['[Open window]\n{one warm swell of soft strings and glass harmonica; then a long held D major chord that rings out}', 12, ['soft string swell', 'held final chord', 'ending', 'long reverb tail']],
      ],
    ),
  },

  // ------------------------------------------------------- rest and play
  {
    id: 'sanctum', label: 'The Sanctum', group: 'Score · Rest', role: 'sanctum', loop: true, lufs: -17,
    key: 'F major', bpm: 60, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'medium' },
    summary: 'Warm rest between floors, where the old ones trade: slow harmonium, the theme in a major key on the music box, cello answering, candlelight and a teacup.',
    chunks: plan(
      ['instrumental only', 'warm resting music for a safe room in a video game', 'F major', '60 BPM', 'harmonium', 'bowed cello', 'music box',
        'soft glass harmonica', 'candlelit, kind, unhurried, a little wry', 'quiet stone chapel reverb'],
      [
        ['[Rest]\n{a harmonium breathes slow warm chords}', 22],
        [`[Theme, kind]\n{a music box plays ${THEME}, gently, in a major key; the cello answers}`, 30, ['music box', 'bowed cello']],
        ['[Tea]\n{cello and harmonium; a teacup clinks softly}', 20, ['bowed cello', 'harmonium']],
        ['[Return]\n{back to the slow warm harmonium chords}', 18, ['harmonium', LOOPS]],
      ],
    ),
  },
  {
    id: 'tea-engine', label: 'The Unreasonable Bell & Tea Engine', group: 'Score · Set pieces', role: 'tea', loop: true,
    key: 'G major', bpm: 112, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'low' },
    summary: 'A played Rube Goldberg machine: a clock wound, pizzicato strings and bassoon bouncing through the mechanism, woodblock dominoes, the theme on xylophone and music box, briskly, in major.',
    chunks: plan(
      ['instrumental only', 'playful Rube Goldberg machine music', 'G major', '112 BPM', 'pizzicato strings', 'clockwork ticking and woodblocks',
        'music box', 'bassoon and clarinet', 'xylophone', 'sly, clever, dry British humour', 'no slide whistle', 'no cartoon sound effects'],
      [
        ['[Wind-up]\n{a clock is wound; pizzicato ticks begin}', 8],
        ['[Chain reaction]\n{pizzicato and bassoon bounce through a busy mechanism; woodblock dominoes tumble in rhythm}', 20, ['pizzicato strings', 'bassoon', 'woodblocks']],
        ['[Theme, clockwork]\n{xylophone and music box play the Breathing Works theme briskly in major}', 16, ['xylophone', 'music box']],
        ['[Loop]\n{back to the busy pizzicato mechanism}', 12, ['pizzicato strings', LOOPS]],
      ],
    ),
  },
  {
    id: 'workshop', label: 'The Workshop', group: 'Score · Set pieces', role: 'workshop', loop: true,
    key: 'B-flat major', bpm: 92, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'low' },
    summary: 'Playful tinkering in the material sandbox: pizzicato and marimba, soft ticking clocks, bubbling flasks, the clarinet trying out the theme in major.',
    chunks: plan(
      ['instrumental only', 'playful tinkering workshop music for a video game', 'B-flat major', '92 BPM', 'pizzicato strings', 'marimba', 'clarinet',
        'music box', 'soft ticking clocks', 'bubbling flask textures', 'curious, cosy, inventive, dry wit'],
      [
        ['[Bench]\n{soft ticking clocks; marimba and pizzicato set out a gentle pattern; a flask bubbles}', 24],
        ['[Tinker]\n{the clarinet noodles curiously over pizzicato; small tuned percussion tries things out}', 30, ['clarinet', 'pizzicato strings', 'glockenspiel']],
        ['[Theme, workshop]\n{the clarinet plays the Breathing Works theme playfully in major; the music box joins}', 28, ['clarinet melody', 'music box']],
        ['[Return]\n{back to the gentle marimba and pizzicato pattern}', 30, ['marimba', 'pizzicato strings', LOOPS]],
      ],
    ),
  },

  // -------------------------------------------------------------- verdicts
  {
    id: 'victory', label: 'Victory — The Kiln is quiet', group: 'Score · Verdicts', role: 'victory', loop: false,
    key: 'D major', bpm: 72, condition: { cue: 'title', startMs: 10000, endMs: 40000, strength: 'medium' },
    summary: 'The theme resolved into D major: a warm low-brass chorale, one understated swell of the whole ensemble, a final held chord and a distant kettle, finally allowed to boil.',
    chunks: plan(
      ['instrumental only', 'victory resolution music for a video game', 'D major', '72 BPM', 'warm brass chorale', 'harmonium', 'bowed cello',
        'music box', 'glass harmonica', 'dignified, relieved, quietly triumphant, understated'],
      [
        ['[Resolve]\n{low brass sings the Breathing Works theme in D major, broad and warm}', 14],
        ['[Swell]\n{the whole ensemble swells once, harmonium and cello beneath the brass}', 14, ['full ensemble swell']],
        ['[Kettle]\n{a final held D major chord; far off, a kettle whistles; ring out}', 12, ['held final chord', 'distant kettle whistle', 'ending', 'long reverb tail']],
      ],
    ),
  },
  {
    id: 'fallen', label: 'Fallen', group: 'Score · Verdicts', role: 'fallen', loop: false, lufs: -19,
    // Unconditioned on purpose: the title's reference window is a harmonium drone, and with it the
    // model buried the music box under a cello drone. The music box must lead here.
    key: 'D minor', bpm: 72,
    summary: 'A solo music box begins the theme and runs down, slowing and sagging in pitch, over one low cello D. Dry, not maudlin.',
    chunks: plan(
      ['solo music box', 'instrumental only', 'game over music', 'D minor', 'bright plucked music box comb, close-miked, clearly audible melody',
        'music box spring running down, tempo slowing to a stop', 'soft low cello note underneath', 'melancholy but dry, not maudlin', 'intimate dry room'],
      [
        ['[Wind-down]\n{a solo music box plays the first four notes of the Breathing Works theme, then slows and sags in pitch as its spring runs down; a low cello D sustains beneath}', 12, ['music box slowing down', 'pitch sagging']],
        ['[Stop]\n{the music box clicks to a stop; the cello note fades out}', 6, ['ending', 'fade to silence']],
      ],
    ),
  },
];

/** Cues in dependency order (a conditioned cue after the cue it references). */
export function orderedCues(cues = CUES) {
  const done = new Set();
  const out = [];
  const visit = (cue) => {
    if (done.has(cue.id)) return;
    if (cue.condition) visit(cues.find((c) => c.id === cue.condition.cue));
    done.add(cue.id);
    out.push(cue);
  };
  cues.forEach(visit);
  return out;
}

export const cueSeconds = (cue) => cue.chunks.reduce((s, c) => s + c.duration_ms, 0) / 1000;
