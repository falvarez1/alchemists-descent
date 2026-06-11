/**
 * Tiny browser file-exchange helpers shared by every Builder import/export
 * surface (documents, prefabs, PNGs, sprites). DOM-only by nature — keep
 * logic out of here so everything interesting stays node-testable.
 */

export function download(blob: Blob, filename: string): void {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function downloadText(text: string, filename: string, mime = 'text/plain'): void {
  download(new Blob([text], { type: mime }), filename);
}

export function downloadJson(value: unknown, filename: string): void {
  download(new Blob([JSON.stringify(value)], { type: 'application/json' }), filename);
}

/** Open the file picker; resolves with the chosen files (empty on cancel). */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.addEventListener('change', () => resolve([...(input.files ?? [])]));
    // cancel fires on modern Chromium/Firefox; without it we simply never
    // resolve, which is harmless for these fire-and-forget pickers
    input.addEventListener('cancel', () => resolve([]));
    input.click();
  });
}
