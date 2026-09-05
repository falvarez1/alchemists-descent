import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, relative } from 'node:path';

export const SCREENSHOT_ROOT = 'screenshots/living-descent';
const escapeHtml = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const href = path => path.split(/[\\/]/).map(encodeURIComponent).join('/');

/** A local, offline gallery; screenshots stay outside the production build. */
export function refreshScreenshotGallery() {
  mkdirSync(SCREENSHOT_ROOT, { recursive: true });
  const groups = readdirSync(SCREENSHOT_ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => {
      const directory = join(SCREENSHOT_ROOT, entry.name);
      const files = readdirSync(directory, { recursive: true }).filter(file => /\.(png|jpe?g|webp)$/i.test(file));
      return { name: entry.name, directory, files };
    }).filter(group => group.files.length).sort((a, b) => b.name.localeCompare(a.name));
  const count = groups.reduce((total, group) => total + group.files.length, 0);
  const body = groups.map((group, index) => `<details${index === 0 ? ' open' : ''}><summary>${escapeHtml(group.name)} · ${group.files.length} screenshots</summary><div class="grid">${group.files.sort().map(file => {
    const url = href(relative(SCREENSHOT_ROOT, join(group.directory, file)));
    return `<a href="${url}"><figure><img loading="lazy" src="${url}" alt="${escapeHtml(file)}"><figcaption>${escapeHtml(file)}</figcaption></figure></a>`;
  }).join('')}</div></details>`).join('\n');
  writeFileSync(join(SCREENSHOT_ROOT, 'index.html'), `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Living Descent screenshots</title><style>body{margin:24px;background:#172127;color:#eee;font:16px/1.5 system-ui}h1{margin-bottom:0}p{color:#bec9cd}summary{cursor:pointer;padding:16px 0;font-weight:600}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}a{color:inherit;text-decoration:none}figure{margin:0;background:#0d151a}img{display:block;width:100%;height:auto}figcaption{padding:8px;overflow-wrap:anywhere}</style><h1>Living Descent screenshots</h1><p>${count} captures across ${groups.length} runs. Open a run, then click an image for its full size. Historical and failure captures keep their original filenames.</p>${body}</html>`);
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
