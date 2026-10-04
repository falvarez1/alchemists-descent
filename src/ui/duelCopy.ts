import { FIGHTER_DEFS, fighterPortraitUrl, type FighterId } from '@/content/fighters';

/**
 * The Duel screens' words and small glyphs (docs/arena/platform-fighter/concepts/local-versus.png): the short name a
 * nameplate shouts, the title without its article, a winner's line, and the inline icons the lobby and HUD share.
 */

/** 'Ilyra Voss' -> 'Ilyra'; an honorific keeps the surname ('Father Thorne' -> 'Thorne'). */
export function duelShortName(id: FighterId): string {
  const words = FIGHTER_DEFS[id].name.split(' ');
  return words[0] === 'Father' ? words[words.length - 1] : words[0];
}

/** The Duel's painted bust of a fighter (facing right), under public/assets/arena/fighters/<id>/. */
export function duelBustUrl(id: FighterId): string {
  return `${import.meta.env.BASE_URL}assets/arena/fighters/${id}/bust.webp`;
}

/** Where the face is in a bust (its bust.json, fractions of the image): the eye point and the eye-to-chin height. */
interface BustAnchor { eye: [number, number]; face: number }
const anchors = new Map<FighterId, Promise<BustAnchor | null>>();
function bustAnchor(id: FighterId): Promise<BustAnchor | null> {
  let anchor = anchors.get(id);
  if (!anchor) {
    anchor = fetch(`${import.meta.env.BASE_URL}assets/arena/fighters/${id}/bust.json`)
      .then(r => r.ok ? r.json() as Promise<BustAnchor> : null)
      .then(a => a && Array.isArray(a.eye) && typeof a.face === 'number' ? a : null, () => null);
    anchors.set(id, anchor);
  }
  return anchor;
}

/**
 * Show a fighter's bust in `img`, falling back to the roster portrait when the bust is missing. `data-art` says which
 * one is showing ('bust' | 'portrait') so the styles can frame each (a full-body portrait needs a tighter crop). The
 * bust's face anchor lands on the img as --ex / --ey / --face, so every frame (lobby, HUD, results) places the face the
 * same way for all ten (versus.css `.bust-fit`).
 */
export function showFighterArt(img: HTMLImageElement, id: FighterId): void {
  if (img.dataset.fighter === id) return;
  img.dataset.fighter = id; img.dataset.art = 'bust';
  img.onerror = () => {
    if (img.dataset.fighter !== id || img.dataset.art !== 'bust') return;
    img.dataset.art = 'portrait'; img.src = fighterPortraitUrl(id);
  };
  img.src = duelBustUrl(id);
  void bustAnchor(id).then(a => {
    if (!a || img.dataset.fighter !== id) return;
    img.style.setProperty('--ex', String(a.eye[0])); img.style.setProperty('--ey', String(a.eye[1])); img.style.setProperty('--face', String(a.face));
  });
}

/** The arcade names of the select screen's choices. */
export function duelDeviceLabel(device: string): string {
  return device === 'keyboard' ? 'Keyboard' : device === 'cpu' ? 'CPU' : device.startsWith('pad:') ? `Pad ${Number(device.slice(4)) + 1}` : device;
}
export const DUEL_CPU_LEVELS = ['Gentle', 'Easy', 'Normal', 'Hard', 'Expert'] as const;

/** 'The Cinder Alchemist' -> 'Cinder Alchemist'. */
export function duelTitle(id: FighterId): string {
  return FIGHTER_DEFS[id].title.replace(/^The /, '');
}

/** The results card: a line under "<NAME> WINS" and the winner's parting words. */
export const DUEL_VICTORY: Readonly<Record<FighterId, { tagline: string; quote: string }>> = {
  'ilyra-voss': { tagline: 'Sparks leave a longer memory.', quote: 'Some things burn brighter on the second fall.' },
  'brann-rook': { tagline: 'The furnace keeps its own.', quote: 'Pressure holds. Pilgrims hold longer.' },
  'sable-fen': { tagline: 'The mire remembers every step.', quote: 'You bled. I only had to follow.' },
  'mara-quell': { tagline: 'The last bell rings for you.', quote: 'Stone fractures. So does certainty.' },
  'kest-rel': { tagline: 'The rooftops belong to the quick.', quote: 'You kept looking where I had been.' },
  'nox-calder': { tagline: 'Every lamp goes out eventually.', quote: 'You fought the dark. The dark was patient.' },
  'edda-morrow': { tagline: 'Glass holds what flesh lets go.', quote: 'Mended light still cuts.' },
  'selene-wraith': { tagline: 'Never quite where you struck.', quote: 'You hit the echo. I was already behind you.' },
  'rusk-emberjaw': { tagline: 'The pit never taught staying down.', quote: 'Teeth of clay. Heart of a kiln.' },
  'father-thorne': { tagline: 'Roots break stone given time.', quote: 'Everything you planted, I will outgrow.' },
};

/** 24-unit inline SVG glyphs (stroke = currentColor). */
const svg = (body: string, fill = false): string =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="${fill ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const DUEL_ICON = {
  controller: svg('<path d="M7.5 7h9c2.6 0 4.2 2.4 4.9 6.3.5 2.8-.4 4.7-2.1 4.7-1.4 0-2.2-1-3.1-2.4H7.8C6.9 17 6.1 18 4.7 18 3 18 2.1 16.1 2.6 13.3 3.3 9.4 4.9 7 7.5 7Z"/><path d="M7.5 10.2v3.4M5.8 11.9h3.4"/><circle cx="15.6" cy="11" r=".6" fill="currentColor"/><circle cx="17.6" cy="12.9" r=".6" fill="currentColor"/>'),
  keyboard: svg('<rect x="2.5" y="6.5" width="19" height="11" rx="1.6"/><path d="M6 10h.01M9 10h.01M12 10h.01M15 10h.01M18 10h.01M6 13.5h.01M18 13.5h.01M8.5 13.5h7"/>'),
  cpu: svg('<rect x="6.5" y="6.5" width="11" height="11" rx="1"/><rect x="9.5" y="9.5" width="5" height="5"/><path d="M9.5 3v3.5M14.5 3v3.5M9.5 17.5V21M14.5 17.5V21M3 9.5h3.5M3 14.5h3.5M17.5 9.5H21M17.5 14.5H21"/>'),
  stock: svg('<circle cx="12" cy="7.5" r="3.6"/><path d="M4.8 20.5c.6-4.3 3.4-6.8 7.2-6.8s6.6 2.5 7.2 6.8Z"/>', true),
  hourglass: svg('<path d="M6.5 3h11M6.5 21h11M7.5 3c0 4.6 4.5 6.4 4.5 9s-4.5 4.4-4.5 9M16.5 3c0 4.6-4.5 6.4-4.5 9s4.5 4.4 4.5 9"/><path d="M9.2 18.6 12 16.4l2.8 2.2Z" fill="currentColor"/>'),
  noHazards: svg('<circle cx="12" cy="12" r="8.6"/><path d="M5.9 5.9 18.1 18.1"/>'),
  shield: svg('<path d="M12 3.2 19 6v5.4c0 4.4-3 7.7-7 9.4-4-1.7-7-5-7-9.4V6Z"/>'),
  burst: svg('<path d="M12 20V5M6.5 10.5 12 5l5.5 5.5"/>'),
  air: svg('<path d="M3.5 9.5h11a3 3 0 1 0-3-3M3.5 14.5h14a3 3 0 1 1-3 3"/>'),
  check: svg('<path d="M5 12.6 9.6 17.2 19 7.4" stroke-width="2.6"/>'),
  ledge: svg('<path d="M4 6h9v14M13 6c3.5 0 6 2.2 6 5"/><path d="M17 9.5l2 1.6 1.6-2"/>'),
  /** The house mark beside the game's name: a circle in a triangle, a line through both. */
  sigil: svg('<path d="M12 2.8 21.4 19.6H2.6Z"/><circle cx="12" cy="13.6" r="5.2"/><path d="M12 2.8v16.8M7 19.6l5-5.8 5 5.8"/>'),
  /** The compass rose behind the lobby's VS. */
  compass: `<svg viewBox="0 0 120 120" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1">
    <circle cx="60" cy="60" r="57" opacity=".22"/><circle cx="60" cy="60" r="47" opacity=".42"/><circle cx="60" cy="60" r="44.5" opacity=".2"/><circle cx="60" cy="60" r="31" opacity=".3"/>
    <path d="M60 1 65.5 54.5 119 60 65.5 65.5 60 119 54.5 65.5 1 60 54.5 54.5Z" opacity=".5" fill="currentColor" fill-opacity=".06"/>
    <path d="M60 27 62.6 57.4 93 60 62.6 62.6 60 93 57.4 62.6 27 60 57.4 57.4Z" transform="rotate(45 60 60)" opacity=".38"/>
    <path d="M60 9v7M60 104v7M9 60h7M104 60h7M24 24l4 4M92 92l4 4M96 24l-4 4M28 92l-4 4" opacity=".45"/></svg>`,
} as const;
