import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';
import { screenshotGalleryHtml } from './screenshot-gallery.mjs';

export const SCREENSHOT_ROOT = 'screenshots/living-descent';
const href = path => path.split(/[\\/]/).map(encodeURIComponent).join('/');
const category = name => /failure|failed/.test(name) ? 'failure' : /creature|expression|studies/.test(name) ? 'creature'
  : /traversal/.test(name) ? 'traversal' : /fidelity|perf|parity|compose/.test(name) ? 'performance'
    : /entry|settings|pause|bench|boon|controls|compact/.test(name) ? 'interface' : 'scene';

/** A local, offline gallery; screenshots stay outside the production build. */
export function refreshScreenshotGallery() {
  mkdirSync(SCREENSHOT_ROOT, { recursive: true });
  const groups = readdirSync(SCREENSHOT_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name !== 'creatures' && entry.name !== 'clips').map(entry => {
      const directory = join(SCREENSHOT_ROOT, entry.name);
      const files = readdirSync(directory, { recursive: true }).filter(file => /\.(png|jpe?g|webp)$/i.test(file));
      const match = entry.name.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-[\d.Z-]+(.+)-\d+$/);
      const label = (match?.[4] ?? entry.name).replace(/^verify-/, '').replaceAll('-', ' ');
      const date = match ? `${match[1]} ${match[2]}:${match[3]} UTC` : '';
      return { name: entry.name, label, date, files: files.map(file => ({ name: basename(file),
        url: href(relative(SCREENSHOT_ROOT, join(directory, file))), category: category(file) })) };
    }).filter(group => group.files.length).sort((a, b) => b.name.localeCompare(a.name));
  const manifest = join(SCREENSHOT_ROOT, 'creatures', 'manifest.json');
  const creatures = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')) : [];
  const clipManifest = join(SCREENSHOT_ROOT, 'clips', 'manifest.json');
  const clips = existsSync(clipManifest) ? JSON.parse(readFileSync(clipManifest, 'utf8')) : [];
  writeFileSync(join(SCREENSHOT_ROOT, 'index.html'), screenshotGalleryHtml({ groups, creatures, clips }));
  writeFileSync('screenshots/index.html', '<!doctype html><html lang="en"><meta charset="utf-8"><title>Living Descent captures</title><meta http-equiv="refresh" content="0;url=living-descent/index.html"><p><a href="living-descent/index.html">Open the capture library</a></p></html>');
}

/** Preserve existing evidence paths while archiving every captured frame by run. */
export function archiveBrowserScreenshots(browser, label = basename(process.argv[1] ?? 'dogfood', '.mjs')) {
  const run = `${new Date().toISOString().replaceAll(':', '-')}-${label.replace(/[^a-z0-9_-]/gi, '-')}-${process.pid}`;
  const directory = join(SCREENSHOT_ROOT, run), attached = new WeakSet();
  let sequence = 0;
  const attach = page => {
    if (attached.has(page)) return;
    attached.add(page);
    const original = page.screenshot.bind(page);
    page.screenshot = async (options = {}) => {
      const buffer = await original(options);
      mkdirSync(directory, { recursive: true });
      const name = options.path ? basename(String(options.path)) : `capture.${options.type === 'jpeg' ? 'jpg' : 'png'}`;
      writeFileSync(join(directory, `${String(++sequence).padStart(3, '0')}-${name}`), buffer);
      refreshScreenshotGallery();
      return buffer;
    };
  };
  const originalContext = browser.newContext.bind(browser);
  browser.newContext = async options => {
    const context = await originalContext(options);
    context.on('page', attach);
    for (const page of context.pages()) attach(page);
    return context;
  };
  const originalPage = browser.newPage.bind(browser);
  browser.newPage = async options => {
    const page = await originalPage(options); attach(page); return page;
  };
}
