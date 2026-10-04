// Find whole, isolated body silhouettes before assigning them to sheet rows.
// A global grid cut can bisect a long limb even when the figures never overlap.
export function findFigures(data, width, height, columns, count) {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const components = [];
  let label = 0;
  for (let seed = 0; seed < labels.length; seed++) {
    if (labels[seed] || data[seed * 4 + 3] < 8) continue;
    label++;
    let first = 0, last = 1, left = width, right = 0, top = height, bottom = 0;
    queue[0] = seed; labels[seed] = label;
    while (first < last) {
      const p = queue[first++], x = p % width, y = Math.floor(p / width);
      left = Math.min(left, x); right = Math.max(right, x);
      top = Math.min(top, y); bottom = Math.max(bottom, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy, np = ny * width + nx;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || labels[np]) continue;
        if (data[np * 4 + 3] < 8) continue;
        labels[np] = label; queue[last++] = np;
      }
    }
    components.push({ label, count: last, left, right, top, bottom });
  }
  components.sort((a, b) => b.count - a.count);
  const selected = components.slice(0, count);
  if (selected.length !== count || selected.at(-1).count < 500)
    throw new Error(`Expected ${count} isolated body figures; found ${selected.filter(c => c.count >= 500).length}`);
  selected.sort((a, b) => (a.top + a.bottom) - (b.top + b.bottom));
  const figures = [];
  for (let i = 0; i < count; i += columns) {
    figures.push(...selected.slice(i, i + columns).sort((a, b) => (a.left + a.right) - (b.left + b.right)));
  }
  return { labels, figures, detachedComponents: components.slice(count).filter(c => c.count >= 500) };
}
