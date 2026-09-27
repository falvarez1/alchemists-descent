/**
 * The dev-only sound audition page (audition.html).
 *
 * Discovers every `src/content/audio/*Manifest.ts` that exports
 * `AUDITION_ENTRIES` — the sound effects here, the score and narration from
 * their own workstream — and lists each cue by group with its prompt and
 * every take. Takes play through plain WebAudio (loop toggle for beds and
 * sustained sounds; "at mix level" applies the game's own gain for that cue
 * when the manifest provides one). A reject checkbox per take builds a list
 * the generators consume: export it as scripts/audio/sfx-rejects.json and
 * re-run the generator to replace exactly those takes.
 */
interface AuditionEntry {
  id: string;
  group: string;
  label: string;
  prompt: string;
  urls: string[];
  loop?: boolean;
  /** Optional: the linear gain the game plays this cue at. */
  gain?: number;
}

interface Reject { id: string; take: number; url: string; group: string }

const REJECTS_KEY = 'bw-audition-rejects-v1';
const manifests = import.meta.glob('/src/content/audio/*Manifest.ts', { eager: true }) as Record<string, { AUDITION_ENTRIES?: AuditionEntry[] }>;

const entries: AuditionEntry[] = [];
for (const [path, mod] of Object.entries(manifests)) {
  for (const e of mod.AUDITION_ENTRIES ?? []) entries.push({ ...e, group: e.group || path });
}

const list = document.getElementById('list')!;
const stats = document.getElementById('stats')!;
const filterInput = document.getElementById('filter') as HTMLInputElement;
const mixLevel = document.getElementById('mix-level') as HTMLInputElement;
const loopAll = document.getElementById('loop-all') as HTMLInputElement;

// ------------------------------------------------------------ rejects
const rejectKey = (id: string, take: number): string => `${id}#${take}`;
const rejects = new Map<string, Reject>();
try {
  const saved = JSON.parse(localStorage.getItem(REJECTS_KEY) ?? '[]') as Reject[];
  for (const r of saved) rejects.set(rejectKey(r.id, r.take), r);
} catch { /* storage blocked or corrupt: start clean */ }
const saveRejects = (): void => {
  try { localStorage.setItem(REJECTS_KEY, JSON.stringify([...rejects.values()])); } catch { /* ignore */ }
  updateStats();
};
const exportJson = (): string => JSON.stringify({
  generated: new Date().toISOString(),
  note: 'Save as scripts/audio/sfx-rejects.json and run the generator; ids from other manifests are for their own generators.',
  rejected: [...rejects.values()].sort((a, b) => a.id.localeCompare(b.id) || a.take - b.take),
}, null, 2);

// ------------------------------------------------------------ playback
let audioCtx: AudioContext | null = null;
const decoded = new Map<string, Promise<AudioBuffer>>();
const playing = new Set<{ src: AudioBufferSourceNode; button: HTMLButtonElement }>();

function context(): AudioContext {
  audioCtx ??= new AudioContext();
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  return audioCtx;
}

function bufferFor(url: string): Promise<AudioBuffer> {
  let p = decoded.get(url);
  if (!p) {
    p = fetch(url).then((r) => r.arrayBuffer()).then((b) => context().decodeAudioData(b));
    decoded.set(url, p);
  }
  return p;
}

function stopAll(): void {
  for (const v of playing) { try { v.src.stop(); } catch { /* ended */ } v.button.classList.remove('playing'); }
  playing.clear();
}

async function play(entry: AuditionEntry, url: string, button: HTMLButtonElement): Promise<void> {
  for (const v of playing) if (v.button === button) { try { v.src.stop(); } catch { /* ended */ } return; }
  const ac = context();
  const buffer = await bufferFor(url);
  const src = ac.createBufferSource();
  src.buffer = buffer;
  src.loop = loopAll.checked || entry.loop === true;
  const gain = ac.createGain();
  gain.gain.value = mixLevel.checked ? Math.min(1.5, entry.gain ?? 1) : 1;
  src.connect(gain).connect(ac.destination);
  const handle = { src, button };
  playing.add(handle);
  button.classList.add('playing');
  src.onended = () => { playing.delete(handle); button.classList.remove('playing'); };
  src.start();
}

// ------------------------------------------------------------ render
function render(): void {
  const q = filterInput.value.trim().toLowerCase();
  const groups = new Map<string, AuditionEntry[]>();
  for (const e of entries) {
    if (q && !`${e.id} ${e.group} ${e.label} ${e.prompt}`.toLowerCase().includes(q)) continue;
    const g = groups.get(e.group) ?? [];
    g.push(e);
    groups.set(e.group, g);
  }
  list.replaceChildren();
  if (groups.size === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = entries.length === 0 ? 'No manifest exports AUDITION_ENTRIES yet.' : 'Nothing matches the filter.';
    list.append(empty);
    return;
  }
  for (const [group, items] of [...groups.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const details = document.createElement('details');
    details.className = 'group';
    details.open = q.length > 0 || groups.size <= 3;
    const summary = document.createElement('summary');
    const takes = items.reduce((n, e) => n + e.urls.length, 0);
    summary.innerHTML = `<span></span><span class="count">${items.length} cues · ${takes} takes</span>`;
    (summary.firstChild as HTMLElement).textContent = group;
    details.append(summary);
    for (const entry of items) details.append(renderEntry(entry));
    list.append(details);
  }
}

function renderEntry(entry: AuditionEntry): HTMLElement {
  const row = document.createElement('div');
  row.className = 'entry';
  const head = document.createElement('div');
  const id = document.createElement('div');
  id.className = 'id';
  id.textContent = entry.id;
  if (entry.loop) {
    const badge = document.createElement('span');
    badge.className = 'loop-badge';
    badge.textContent = '⟲ loop';
    id.append(badge);
  }
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = entry.label.replace(entry.id, '').trim();
  head.append(id, meta);
  const prompt = document.createElement('div');
  prompt.className = 'prompt';
  prompt.textContent = entry.prompt || '—';
  const takes = document.createElement('div');
  takes.className = 'takes';
  entry.urls.forEach((url, i) => {
    const take = i + 1;
    const key = rejectKey(entry.id, take);
    const box = document.createElement('span');
    box.className = 'take' + (rejects.has(key) ? ' rejected' : '');
    const button = document.createElement('button');
    button.className = 'play';
    button.type = 'button';
    button.textContent = `▶ ${take}`;
    button.title = `Play take ${take}`;
    button.addEventListener('click', () => { void play(entry, url, button); });
    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = rejects.has(key);
    check.title = `Reject take ${take}`;
    check.addEventListener('change', () => {
      if (check.checked) rejects.set(key, { id: entry.id, take, url, group: entry.group });
      else rejects.delete(key);
      box.classList.toggle('rejected', check.checked);
      row.classList.toggle('rejected', entry.urls.some((_, j) => rejects.has(rejectKey(entry.id, j + 1))));
      saveRejects();
    });
    const x = document.createElement('span');
    x.className = 'x';
    x.textContent = 'reject';
    box.append(button, check, x);
    takes.append(box);
  });
  row.classList.toggle('rejected', entry.urls.some((_, j) => rejects.has(rejectKey(entry.id, j + 1))));
  row.append(head, prompt, takes);
  return row;
}

function updateStats(): void {
  const takes = entries.reduce((n, e) => n + e.urls.length, 0);
  stats.textContent = `${entries.length} cues · ${takes} takes · ${rejects.size} rejected`;
}

// ------------------------------------------------------------ wiring
filterInput.addEventListener('input', render);
document.getElementById('stop')!.addEventListener('click', stopAll);
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') stopAll(); });
document.getElementById('clear')!.addEventListener('click', () => {
  if (!rejects.size || !confirm(`Clear ${rejects.size} rejects?`)) return;
  rejects.clear();
  saveRejects();
  render();
});
document.getElementById('copy')!.addEventListener('click', () => { void navigator.clipboard?.writeText(exportJson()); });
document.getElementById('export')!.addEventListener('click', () => {
  const blob = new Blob([exportJson()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'sfx-rejects.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

render();
updateStats();
