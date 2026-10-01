import type { FighterRole } from '@/content/fighters';
import type { RoleFilter } from '@/ui/fighterRosterModel';

/**
 * The Fighter Roster's line icons: the design document's set, 24-unit stroke shapes drawn as DOM so the
 * roster never parses markup. A shape is an SVG path string or a circle [cx, cy, r].
 */
type Shape = string | readonly [number, number, number];

const SHAPES = {
  flask: ['M9 3h6m-5 0v7l-5 8a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-8V3M8 15h8', 'M10 18h.01m4-1h.01'],
  all: ['M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z'],
  duelist: ['m4 3 5 2 11 14-2 2L5 8 4 3Zm16 0-5 2-3 4M4 19l5-6M2 17l5 5m10-5 5 5'],
  hunter: [[12, 12, 7], [12, 12, 2], 'M12 2v4m0 12v4M2 12h4m12 0h4'],
  controller: ['m12 2 3 7 7 3-7 3-3 7-3-7-7-3 7-3 3-7Z', [12, 12, 2]],
  bulwark: ['m12 3 8 3v6c0 5-8 9-8 9S4 17 4 12V6l8-3Z', 'M12 7v9M8 11h8'],
  support: ['M9 3h6v6h6v6h-6v6H9v-6H3V9h6V3Z'],
  search: [[10.5, 10.5, 6.5], 'm16 16 5 5'],
  close: ['m6 6 12 12M6 18 18 6'],
  check: ['m5 12 4 4L19 6'],
  sheet: ['M4 3h16v18H4zM4 9h16M4 15h16M10 3v18M15 3v18'],
  right: ['M4 12h16m-6-6 6 6-6 6'],
  left: ['M20 12H4m6-6-6 6 6 6'],
  chevron: ['m6 9 6 6 6-6'],
  passive: ['M3 12h4l3-7 4 14 3-7h4'],
  tactical: ['m13 2-9 12h7l-1 8 10-13h-7l1-7Z'],
  ultimate: ['m12 2 2.5 6.5L21 6l-2.5 6L22 17l-7-.5L12 22l-3-5.5-7 .5 3.5-5L3 6l6.5 2.5L12 2Z'],
  zoom: ['M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5', 'M9 12h6m-3-3v6'],
  record: ['M5 3h14v18H5zM9 7h6M9 11h6M9 15h4'],
  lock: ['M5 11h14v10H5z', 'M8 11V8a4 4 0 0 1 8 0v3', 'M12 15v2'],
} as const satisfies Record<string, readonly Shape[]>;

export type IconName = keyof typeof SHAPES;

const SVG_NS = 'http://www.w3.org/2000/svg';

/** A decorative 24x24 line icon in the current text colour. */
export function icon(name: IconName, className = ''): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.setAttribute('class', className ? `fr-icon ${className}` : 'fr-icon');
  for (const shape of SHAPES[name] as readonly Shape[]) {
    if (typeof shape === 'string') {
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', shape);
      svg.appendChild(path);
    } else {
      const circle = document.createElementNS(SVG_NS, 'circle');
      circle.setAttribute('cx', String(shape[0]));
      circle.setAttribute('cy', String(shape[1]));
      circle.setAttribute('r', String(shape[2]));
      svg.appendChild(circle);
    }
  }
  return svg;
}

export function roleIconName(role: FighterRole | RoleFilter): IconName {
  switch (role) {
    case 'Duelist': return 'duelist';
    case 'Hunter': return 'hunter';
    case 'Controller': return 'controller';
    case 'Bulwark': return 'bulwark';
    case 'Support': return 'support';
    case 'All': return 'all';
  }
}
