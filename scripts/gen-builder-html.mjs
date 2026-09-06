// Derives builder.html (the /builder.html editor route) from index.html.
//
// WHY GENERATED. The two routes boot the SAME Game, so every node the runtime
// resolves strictly (the HUD's #expedition-tools, the pause overlay, the
// gameover panel...) must exist in both shells. builder.html started life as a
// hand-edited copy and quietly fell behind: the LIVING DESCENT rebuild added
// HUD nodes to index.html only, and the editor route died with
// "Cannot read properties of null (reading 'append')" in Hud.ts for six weeks
// because nothing compared the two files. Deriving one from the other makes
// that drift impossible, and `tests/builder-html.test.ts` fails the moment the
// checked-in copy is stale.
//
// What differs, and only this:
//   - <title>, the boot overlay text
//   - the left rail: the Sandbox palette is replaced by a short note (the
//     editor window has no business painting with Sandbox tools)
//   - the module entry: src/app/builderEntry.ts instead of src/main.ts
//
//   node scripts/gen-builder-html.mjs          # rewrite builder.html
//   node scripts/gen-builder-html.mjs --check  # exit 1 when it is stale
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const BANNER =
  '<!-- GENERATED from index.html by scripts/gen-builder-html.mjs — do not edit by hand.\n' +
  '     Change index.html, then run: node scripts/gen-builder-html.mjs -->\n';

const LEFT_RAIL =
  '<div id="left-toolbar" class="builder-entry-toolbar">\n' +
  '            <div class="section-title">Builder</div>\n' +
  '            <p class="builder-entry-note">\n' +
  '                This window is the editor. The Sandbox palette lives on the\n' +
  '                <a href="/">game page</a>; open that in a second window and the\n' +
  '                two stay in sync over AuthorLink.\n' +
  '            </p>\n' +
  '        </div>';

/** Replace exactly one occurrence, or throw: a missing anchor means index.html changed shape. */
function replaceOnce(html, from, to, what) {
  const at = html.indexOf(from);
  if (at < 0) throw new Error(`gen-builder-html: could not find ${what} in index.html`);
  if (html.indexOf(from, at + from.length) >= 0) throw new Error(`gen-builder-html: ${what} is not unique in index.html`);
  return html.slice(0, at) + to + html.slice(at + from.length);
}

/** Pure transform; the test imports this so the check needs no filesystem writes. */
export function deriveBuilderHtml(indexHtml) {
  let html = indexHtml.replace(/\r\n/g, '\n');
  html = replaceOnce(html, '<!DOCTYPE html>\n', '<!DOCTYPE html>\n' + BANNER, 'the doctype');
  html = replaceOnce(html, "<title>Alchemist's Descent</title>", "<title>Builder — Alchemist's Descent</title>", 'the title');
  html = replaceOnce(html, '<div class="boot-title">ALCHEMIST\'S DESCENT</div>', '<div class="boot-title">PURPLE LLAMA STUDIO</div>', 'the boot title');
  html = replaceOnce(html, '<div class="boot-sub">THE BREATHING WORKS</div>', '<div class="boot-sub">BUILDER</div>', 'the boot subtitle');
  html = replaceOnce(html, '<script type="module" src="/src/main.ts"></script>', '<script type="module" src="/src/app/builderEntry.ts"></script>', 'the module entry');

  // The composition thesis describes the play route's first viewport; it is
  // not documentation for the editor shell.
  const thesisStart = html.indexOf('    <!--\n    THESIS:');
  if (thesisStart >= 0) {
    const thesisEnd = html.indexOf('-->\n', thesisStart);
    if (thesisEnd < 0) throw new Error('gen-builder-html: unterminated thesis comment');
    html = html.slice(0, thesisStart) + html.slice(thesisEnd + '-->\n'.length).replace(/^\n/, '');
  }

  const railStart = html.indexOf('<div id="left-toolbar">');
  const viewport = html.indexOf('<div id="viewport-container">');
  if (railStart < 0 || viewport < 0 || viewport < railStart) throw new Error('gen-builder-html: could not find the left rail');
  const railEnd = html.lastIndexOf('</div>', viewport) + '</div>'.length;
  html = html.slice(0, railStart) + LEFT_RAIL + html.slice(railEnd);
  return html;
}

export function readIndexHtml() {
  return readFileSync(resolve(ROOT, 'index.html'), 'utf8');
}

export function readBuilderHtml() {
  return readFileSync(resolve(ROOT, 'builder.html'), 'utf8').replace(/\r\n/g, '\n');
}

const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isDirectRun) {
  const expected = deriveBuilderHtml(readIndexHtml());
  if (process.argv.includes('--check')) {
    if (readBuilderHtml() !== expected) {
      console.error('builder.html is stale: run `node scripts/gen-builder-html.mjs`');
      process.exit(1);
    }
    console.log('builder.html is up to date');
  } else {
    writeFileSync(resolve(ROOT, 'builder.html'), expected);
    console.log('wrote builder.html');
  }
}
