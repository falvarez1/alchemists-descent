// Event log -> editor marks. Every EventBus emit, explosion and one-shot SFX
// call is stamped with the captured frame it happened in; the ones that read
// on screen (inside the camera view, or unpositioned) become cut/SFX marks.
//
// Labels are short and stable across re-records (the edit syncs to them):
// `explosion`, `alchemyKill`, `kill`, `callout`, the boss move name (`roar`,
// `stomp`, `lance`…), `fell`/`fall` (a tree cut / a tree hitting the ground),
// `grab`/`hurl`, `corpse-bowl`, `flora-crack`, `creature-scatter`,
// `lantern-on`… The specifics ride in `detail`. Shot authors own the plain
// verbs they mark by hand (`ignite`, `reveal`…).

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

/** [label, detail] for an event. */
function name(e) {
  const d = e.detail ?? {};
  switch (e.type) {
    case 'explosion': return ['explosion', `r${Math.round(d.radius ?? 0)}`];
    case 'alchemyKill': return ['alchemyKill', `${String(d.cause ?? '').toUpperCase()} ${d.kind ?? ''}${d.chain > 1 ? ` x${d.chain}` : ''}`.trim()];
    case 'enemyKilled': return ['kill', d.kind ?? ''];
    case 'combatCallout': return ['callout', d.text ?? ''];
    case 'bossMove': return [String(d.move ?? 'move'), d.kind ?? ''];
    case 'storyLetterbox': return [d.on ? 'letterbox-in' : 'letterbox-out', ''];
    case 'treeFelled': return ['fell', d.cause ?? ''];
    case 'treeLanded': return ['fall', d.first === false ? 'bounce' : ''];
    case 'telekinesis': return [String(d.phase ?? 'telekinesis'), d.target ?? ''];
    case 'corpseMoment': return [`corpse-${d.kind ?? 'moment'}`, d.species ?? ''];
    case 'lanternHooded': return [d.hooded ? 'lantern-off' : 'lantern-on', ''];
    case 'eyeshineCaught': return ['eyeshine', d.kind ?? ''];
    case 'floraMoment': return [`flora-${d.kind ?? 'moment'}`, ''];
    case 'organism': return [`creature-${d.action ?? 'moment'}`, d.kind ?? ''];
    case 'cardCast': return ['cast', d.id ?? ''];
    case 'flaskUsed': return [String(d.verb ?? 'flask'), ''];
    case 'groundImpact': return ['impact', `r${Math.round(d.radius ?? 0)}`];
    case 'structureStrike': return ['strike', ''];
    case 'lightDevice': return [String(d.kind ?? 'light'), ''];
    default: return [e.type.startsWith('sfx:') ? `sfx-${e.type.slice(4)}` : e.type, ''];
  }
}

/** Is this event worth a mark? (big enough, on screen) */
function marked(e) {
  if (!(e.type in KIND)) return false;
  const d = e.detail ?? {};
  if (d.inView === false) return false;
  if (e.type === 'groundImpact' && (d.strength ?? 1) < 0.35) return false;
  if (e.type === 'corpseMoment' && (d.strength ?? 1) < 0.3 && !['bowl', 'splash', 'ignite', 'shatter'].includes(d.kind)) return false;
  if (e.type === 'telekinesis' && !['grab', 'hurl'].includes(d.phase)) return false;
  if (e.type === 'floraMoment' && !['crack', 'snap', 'whoosh', 'bloom'].includes(d.kind)) return false;
  if (e.type === 'organism' && ['swell', 'lower'].includes(d.action)) return false;
  return true;
}

const round = (v) => Math.round(v * 1000) / 1000;

/** Page event log (frame-stamped) -> sidecar events (seconds). */
export function toEvents(pageEvents, fps) {
  return pageEvents.filter((e) => e.f >= 0).map((e) => ({
    t: round(e.f / fps),
    type: e.type,
    detail: { ...(e.detail ?? {}), tick: e.t, ...(e.inView === null ? {} : { inView: e.inView }) },
  }));
}

/** Sidecar events + manual marks -> sorted marks (one per burst per label). */
export function marksFrom(events, manual = []) {
  const marks = [];
  const lastAt = new Map();
  for (const e of events) {
    if (!marked(e)) continue;
    const [label, detail] = name(e);
    const key = `${e.type}|${label}|${detail}`;
    const prev = lastAt.get(key);
    if (prev !== undefined && e.t - prev < 0.14) continue;
    lastAt.set(key, e.t);
    marks.push({ t: e.t, label, kind: KIND[e.type], ...(detail ? { detail } : {}) });
  }
  marks.push(...manual);
  return marks.sort((a, b) => a.t - b.t);
}

/** Manual marks: the shot's `marks` (seconds or ticks) and page `T.mark()` calls. */
export function manualMarks(shot, page, { fps, clipS, scale, fromTick }) {
  const out = [];
  for (const m of page.marks) if (m.f >= 0) out.push({ t: round(m.f / fps), label: m.label, kind: m.kind, manual: true });
  for (const m of shot.marks ?? []) {
    // Shot marks are authored on the 1x timeline; a slow-mo variant remaps them.
    const tick = m.tick !== undefined ? m.tick : m.t * fps;
    const t = scale === 1 && m.tick === undefined ? m.t : (tick - fromTick) / scale / fps;
    if (t >= 0 && t <= clipS) out.push({ t: round(t), label: m.label, kind: m.kind ?? 'beat', manual: true });
  }
  return out;
}
