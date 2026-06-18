/** Small, dependency-free string helpers shared across game + builder UI.
 *  Foundation module: safe to import from any layer. */

/** Escape the five HTML-significant characters so untrusted text is safe in
 *  BOTH element and attribute contexts. Canonical single-source; previously
 *  copy-pasted (often as a weaker &,<,> -only variant) across editor panels. */
export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** Escape text for an HTML attribute value. escapeHtml already covers both quote
 *  styles (&quot; and &#39;), so it is fully attribute-safe and this is a true
 *  alias — kept as a separate name only so attribute-context call sites read
 *  intentionally (and could diverge later without touching every caller). Widely
 *  used across the Builder UI; do not inline-replace at the call sites. */
export function escapeAttr(value: string): string {
  return escapeHtml(value);
}

/** Turn a code identifier into human Title Case:
 *  "densityWeight" -> "Density Weight", "rune_door" -> "Rune Door". */
export function humanizeIdentifier(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Count-correct word form (no number): pluralize(1, 'issue') -> "issue",
 *  pluralize(2, 'issue') -> "issues". Pass an explicit plural for irregulars. */
export function pluralize(n: number, singular: string, pluralForm?: string): string {
  return n === 1 ? singular : pluralForm ?? `${singular}s`;
}

/** Count + count-correct word: plural(1, 'issue') -> "1 issue",
 *  plural(2, 'issue') -> "2 issues". */
export function plural(n: number, singular: string, pluralForm?: string): string {
  return `${n} ${pluralize(n, singular, pluralForm)}`;
}

/** Capitalize the first character only (sentence case): "on fire" -> "On fire".
 *  Idempotent for already-capitalized labels. */
export function sentenceCase(label: string): string {
  return label.length === 0 ? label : label.charAt(0).toUpperCase() + label.slice(1);
}

/** Decimal places implied by a slider step: stepDecimals(0.05) -> 2, (1) -> 0. */
export function stepDecimals(step: number): number {
  if (!Number.isFinite(step) || step <= 0) return 2;
  const s = String(step);
  const dot = s.indexOf('.');
  return dot < 0 ? 0 : s.length - dot - 1;
}

/** Format a number with exactly as many decimals as its step implies, so a
 *  slider never prints binary float noise: formatStep(0.15000000000000002, 0.05)
 *  -> "0.15", formatStep(48, 1) -> "48". */
export function formatStep(value: number, step: number): string {
  return value.toFixed(stepDecimals(step));
}
