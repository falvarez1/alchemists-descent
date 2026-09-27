// Check a production build for the audio workstream's promises:
//  - no ElevenLabs anywhere in what ships: no API host, no key header, no `sk_…` key;
//  - the score and the narrator's clips are there as plain files, fetched on demand
//    (none of them is inlined into a script chunk or preloaded by index.html).
//
// Usage: node scripts/verify-audio-bundle.mjs [distDir=dist]
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const dist = process.argv[2] ?? 'dist';
let fail = 0;
const check = (name, ok, detail = '') => {
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(join(dir, d.name)) : [join(dir, d.name)]));
const files = walk(dist);
const texts = files.filter((f) => /\.(js|mjs|css|html|json|map|txt|webmanifest)$/.test(f));

const leaks = [];
for (const f of texts) {
  const t = readFileSync(f, 'utf8');
  for (const [label, re] of [['api host', /api\.elevenlabs\.io/], ['key header', /xi-api-key/], ['key', /sk_[A-Za-z0-9]{20,}/]]) {
    if (re.test(t)) leaks.push(`${relative(dist, f)}: ${label}`);
  }
}
check('no ElevenLabs host, key header or key in the build', leaks.length === 0, leaks.slice(0, 5).join('; '));

const music = files.filter((f) => /[\\/]audio[\\/]music[\\/].+\.mp3$/.test(f));
const voice = files.filter((f) => /[\\/]audio[\\/]voice[\\/][0-9a-f]{8}(-\d)?\.mp3$/.test(f));
const mb = (list) => list.reduce((s, f) => s + statSync(f).size, 0) / 1048576;
check('the score ships as files', music.length >= 16, `${music.length} tracks, ${mb(music).toFixed(2)} MB`);
check('the narrator ships as files', voice.length >= 120, `${voice.length} clips, ${mb(voice).toFixed(2)} MB`);

const html = readFileSync(join(dist, 'index.html'), 'utf8');
check('index.html preloads no audio', !/audio\/(music|voice)\//.test(html));
const js = texts.filter((f) => f.endsWith('.js'));
const inlined = js.filter((f) => /data:audio\//.test(readFileSync(f, 'utf8')));
check('no audio inlined into a script', inlined.length === 0, inlined.map((f) => relative(dist, f)).join(', '));
const audition = js.filter((f) => /AUDITION_ENTRIES|Designed preview/.test(readFileSync(f, 'utf8')));
check('the audition manifest stays out of the player bundle', audition.length === 0, audition.map((f) => relative(dist, f)).join(', '));

console.log(fail ? `\n${fail} failed` : '\nall good');
process.exit(fail ? 1 : 0);
