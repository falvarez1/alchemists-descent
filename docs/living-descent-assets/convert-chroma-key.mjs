#!/usr/bin/env node
/**
 * Asset-only chroma-to-alpha conversion. Requires Sharp in an explicit external
 * package directory so the game does not gain a production/dev dependency.
 * Usage: node convert-chroma-key.mjs <sharp-package-dir> <input.png> <output.png>
 * This preserves all RGB samples; only near-key pixels become fully transparent.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const [sharpPackage, input, output] = process.argv.slice(2);
if (!sharpPackage || !input || !output) {
  throw new Error('Expected Sharp package directory, input PNG, and output PNG.');
}
const require = createRequire(import.meta.url);
const loaded = require(path.resolve(sharpPackage));
const sharp = loaded.default ?? loaded;
const key = [244, 3, 237];
// Match the key's hue within 25 degrees, including dimmer edge samples. A
// strict RGB-box key leaves the generator's anti-aliased magenta fringe.
// The approved slate/copper/mint/amber machinery contains no magenta pigment.
const hue = 302;
const hueTolerance = 25;
const minimumSaturation = 0.25;
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
if (info.channels !== 4) throw new Error('Expected RGBA decode.');
let removed = 0;
for (let offset = 0; offset < data.length; offset += 4) {
  const [red, green, blue] = data.subarray(offset, offset + 3);
  const maximum = Math.max(red, green, blue);
  const minimum = Math.min(red, green, blue);
  const delta = maximum - minimum;
  const saturation = maximum === 0 ? 0 : delta / maximum;
  let pixelHue = delta === 0 ? 0 : maximum === red
    ? 60 * (((green - blue) / delta) % 6)
    : maximum === green
      ? 60 * ((blue - red) / delta + 2)
      : 60 * ((red - green) / delta + 4);
  if (pixelHue < 0) pixelHue += 360;
  const distance = Math.min(Math.abs(pixelHue - hue), 360 - Math.abs(pixelHue - hue));
  if (saturation >= minimumSaturation && distance <= hueTolerance) {
    data[offset + 3] = 0;
    removed += 1;
  }
}
fs.mkdirSync(path.dirname(path.resolve(output)), { recursive: true });
await sharp(data, { raw: info }).png({ compressionLevel: 9 }).toFile(output);
console.log(JSON.stringify({
  input, output, width: info.width, height: info.height,
  key, hue, hueTolerance, minimumSaturation, transparentPixels: removed,
  transparentPercent: 100 * removed / (info.width * info.height),
  preserved: 'All RGB samples unchanged; only alpha set to zero for one low-tolerance key.',
}, null, 2));
