// Event log -> editor marks. Every EventBus emit, explosion and one-shot SFX
// call is stamped with the captured frame it happened in; the ones that read
// on screen (inside the camera view, or unpositioned) become cut/SFX marks.

const KIND = {
  explosion: 'impact',
  alchemyKill: 'kill',
  enemyKilled: 'kill',
  combatCallout: 'callout',
  bossMove: 'boss',
  storyLetterbox: 'boss',
  treeFelled: 'impact',
  treeLanded: 'impact',
  corpseMoment: 'impact',
  telekinesis: 'action',
  lanternHooded: 'light',
  eyeshineCaught: 'light',
  lightDevice: 'light',
  groundImpact: 'impact',
  structureStrike: 'impact',
  floraMoment: 'impact',
  organism: 'creature',
  cardCast: 'action',
  flaskUsed: 'action',
  levelCurtain: 'title',
  'sfx:boom': 'sfx',
  'sfx:lightning': 'sfx',
  'sfx:zap': 'sfx',
  'sfx:shatter': 'sfx',
  'sfx:steam': 'sfx',
  'sfx:doorGrind': 'sfx',
  'sfx:groan': 'sfx',
  'sfx:brazier': 'sfx',
  'sfx:lever': 'sfx',
  'sfx:hollowKnock': 'sfx',
};

function label(e) {
  const d = e.detail ?? {};
  switch (e.type) {
    case 'explosion': return `explosion r${Math.round(d.radius ?? 0)}`;
    case 'alchemyKill': return `${String(d.cause ?? 'alchemy').toUpperCase()} ${d.kind ?? ''}${d.chain > 1 ? ` x${d.chain}` : ''}`.trim();
    case 'enemyKilled': return `kill ${d.kind ?? ''}`.trim();
    case 'combatCallout': return `callout "${d.text ?? ''}"`;
    case 'bossMove': return `${d.kind ?? 'boss'} ${d.move ?? ''}`.trim();
    case 'storyLetterbox': return `letterbox ${d.on ? 'in' : 'out'}`;
    case 'telekinesis': return `telekinesis ${d.phase ?? ''}`;
    case 'corpseMoment': return `corpse ${d.kind ?? ''}`;
    case 'lanternHooded': return d.hooded ? 'lantern hooded' : 'lantern unhooded';
    case 'eyeshineCaught': return `eyeshine ${d.kind ?? ''}`;
    case 'floraMoment': return `flora ${d.kind ?? ''}`;
    case 'organism': return `${d.kind ?? 'organism'} ${d.action ?? ''}`;
    case 'cardCast': return `cast ${d.id ?? ''}`;
    case 'flaskUsed': return `flask ${d.verb ?? ''}`;
    case 'groundImpact': return `ground impact r${Math.round(d.radius ?? 0)}`;
    case 'lightDevice': return `light ${d.kind ?? ''}`;
    default: return e.type.startsWith('sfx:') ? `sfx ${e.type.slice(4)}` : e.type;
  }
}

/** Is this event worth a mark? (big enough, on screen) */
function marked(e) {
  if (!(e.type in KIND)) return false;
  if (e.inView === false) return false;
  const d = e.detail ?? {};
  if (e.type === 'groundImpact' && (d.strength ?? 1) < 0.35) return false;
  if (e.type === 'corpseMoment' && (d.strength ?? 1) < 0.3 && !['bowl', 'splash', 'ignite', 'shatter'].includes(d.kind)) return false;
  if (e.type === 'telekinesis' && !['grab', 'hurl'].includes(d.phase)) return false;
  if (e.type === 'floraMoment' && !['crack', 'snap', 'whoosh', 'bloom'].includes(d.kind)) return false;
  if (e.type === 'organism' && ['swell', 'lower'].includes(d.action)) return false;
  return true;
}

const round = (v) => Math.round(v * 1000) / 1000;

export function buildMarks(shot, page, { fps, clipS, scale, fromTick }) {
  const recorded = page.events.filter((e) => e.f >= 0);
  const events = recorded.map((e) => ({
    t: round(e.f / fps),
    type: e.type,
    detail: { ...(e.detail ?? {}), tick: e.t, ...(e.inView === null ? {} : { inView: e.inView }) },
  }));
  const marks = [];
  const lastAt = new Map();
  for (const e of recorded) {
    if (!marked(e)) continue;
    const name = label(e);
    const key = `${e.type}|${name}`;
    const prev = lastAt.get(key);
    if (prev !== undefined && e.f - prev < 8) continue; // one mark per burst
    lastAt.set(key, e.f);
    marks.push({ t: round(e.f / fps), label: name, kind: KIND[e.type] });
  }
  for (const m of page.marks) if (m.f >= 0) marks.push({ t: round(m.f / fps), label: m.label, kind: m.kind });
  for (const m of shot.marks ?? []) {
    const t = m.tick !== undefined ? (m.tick - fromTick) / scale / fps : m.t;
    if (t >= 0 && t <= clipS) marks.push({ t: round(t), label: m.label, kind: m.kind ?? 'beat' });
  }
  marks.sort((a, b) => a.t - b.t);
  return { marks, events };
}
