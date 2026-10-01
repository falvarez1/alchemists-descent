/** Adapt authored keyboard hints at the presentation boundary. */
export function touchHint(text: string): string {
  if (!document.body.classList.contains('touch-enabled')) return text;
  return text
    .replace(/left[- ]click|\bLMB\b/gi, 'Aim / cast')
    .replace(/right[- ]click|\bRMB\b/gi, 'Tools > Throw')
    .replace(/\bSpace\b/g, 'Jump')
    .replace(/\bShift\b/g, 'Grip')
    .replace(/\(B\)/g, "(Pause > Wandsmith's bench)")
    .replace(/\b([EQXFGVLZT])(?=\s*(?:[·:]|to\b))/g, (_match, key: string) => touchKey(key))
    .replace(/\b(Press|press|Hold|hold) ([EQXFGVLZT])\b/g, (_match, verb: string, key: string) => `${verb} ${touchKey(key)}`);
}

function touchKey(key: string): string {
  const labels: Record<string, string> = { E: 'Use', Q: 'Pour', X: 'Drink', F: 'Kick', G: 'Carry', V: 'Glowseed', L: 'Lantern', Z: 'Tactical', T: 'Ultimate' };
  return labels[key] ?? key;
}
