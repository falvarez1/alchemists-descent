import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

const pngSignature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function paethPredictor(left, up, upLeft) {
  const estimate = left + up - upLeft;
  const leftDistance = Math.abs(estimate - left);
  const upDistance = Math.abs(estimate - up);
  const upLeftDistance = Math.abs(estimate - upLeft);
  if (leftDistance <= upDistance && leftDistance <= upLeftDistance) return left;
  if (upDistance <= upLeftDistance) return up;
  return upLeft;
}

function expectedPixel(x, y, width, height) {
  const r = width <= 1 ? 0 : Math.round((x / (width - 1)) * 255);
  const g = height <= 1 ? 0 : Math.round((y / (height - 1)) * 255);
  const b = Math.round((((x + y) % 32) / 31) * 255);
  return [r, g, b, 255];
}

function readPngRgba(filePath) {
  const buffer = readFileSync(filePath);
  if (!buffer.subarray(0, pngSignature.length).equals(pngSignature)) {
    throw new Error(`Not a PNG file: ${filePath}`);
  }

  let offset = pngSignature.length;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks = [];

  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    const data = buffer.subarray(dataStart, dataEnd);
    offset = dataEnd + 4;

    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }

  if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6)) {
    throw new Error(`Unsupported PNG format: bitDepth=${bitDepth}, colorType=${colorType}`);
  }

  const channels = colorType === 6 ? 4 : 3;
  const bytesPerPixel = channels;
  const rowBytes = width * channels;
  const inflated = inflateSync(Buffer.concat(idatChunks));
  const decoded = new Uint8Array(width * height * channels);
  let inputOffset = 0;

  for (let y = 0; y < height; y++) {
    const filter = inflated[inputOffset++];
    const rowOffset = y * rowBytes;
    const previousRowOffset = rowOffset - rowBytes;
    for (let x = 0; x < rowBytes; x++) {
      const raw = inflated[inputOffset++];
      const left = x >= bytesPerPixel ? decoded[rowOffset + x - bytesPerPixel] : 0;
      const up = y > 0 ? decoded[previousRowOffset + x] : 0;
      const upLeft = y > 0 && x >= bytesPerPixel ? decoded[previousRowOffset + x - bytesPerPixel] : 0;
      let value = raw;
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += Math.floor((left + up) / 2);
      else if (filter === 4) value += paethPredictor(left, up, upLeft);
      else if (filter !== 0) throw new Error(`Unsupported PNG filter ${filter}`);
      decoded[rowOffset + x] = value & 0xff;
    }
  }

  if (channels === 4) return { width, height, data: decoded };

  const rgba = new Uint8Array(width * height * 4);
  for (let pixel = 0; pixel < width * height; pixel++) {
    rgba[pixel * 4] = decoded[pixel * 3];
    rgba[pixel * 4 + 1] = decoded[pixel * 3 + 1];
    rgba[pixel * 4 + 2] = decoded[pixel * 3 + 2];
    rgba[pixel * 4 + 3] = 255;
  }
  return { width, height, data: rgba };
}

function sampleLogicalPixels(image, logicalWidth, logicalHeight) {
  const logical = new Uint8Array(logicalWidth * logicalHeight * 4);
  const scaleX = image.width / logicalWidth;
  const scaleY = image.height / logicalHeight;
  for (let y = 0; y < logicalHeight; y++) {
    const sourceY = Math.min(image.height - 1, Math.floor((y + 0.5) * scaleY));
    for (let x = 0; x < logicalWidth; x++) {
      const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * scaleX));
      const sourceIndex = (sourceY * image.width + sourceX) * 4;
      const targetIndex = (y * logicalWidth + x) * 4;
      logical[targetIndex] = image.data[sourceIndex];
      logical[targetIndex + 1] = image.data[sourceIndex + 1];
      logical[targetIndex + 2] = image.data[sourceIndex + 2];
      logical[targetIndex + 3] = image.data[sourceIndex + 3];
    }
  }
  return logical;
}

function comparePixels(readback, width, height) {
  let maxDelta = 0;
  let mismatches = 0;
  let exact = 0;
  let sumDelta = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = (y * width + x) * 4;
      const expected = expectedPixel(x, y, width, height);
      let pixelMax = 0;
      for (let channel = 0; channel < 4; channel++) {
        const delta = Math.abs(expected[channel] - readback[index + channel]);
        pixelMax = Math.max(pixelMax, delta);
        sumDelta += delta;
      }
      if (pixelMax === 0) exact++;
      if (pixelMax > 1) mismatches++;
      maxDelta = Math.max(maxDelta, pixelMax);
    }
  }
  const pixels = width * height;
  return {
    maxDelta,
    mismatches,
    mismatchPct: (mismatches / pixels) * 100,
    exactPct: (exact / pixels) * 100,
    meanDelta: sumDelta / (pixels * 4),
  };
}

function summarizeImage(readback) {
  let nonBlackPixels = 0;
  let maxChannel = 0;
  let sumRgb = 0;
  for (let i = 0; i < readback.length; i += 4) {
    const r = readback[i];
    const g = readback[i + 1];
    const b = readback[i + 2];
    if (r !== 0 || g !== 0 || b !== 0) nonBlackPixels++;
    maxChannel = Math.max(maxChannel, r, g, b);
    sumRgb += r + g + b;
  }
  const pixels = readback.length / 4;
  return {
    nonBlackPixels,
    nonBlackPct: nonBlackPixels / pixels,
    averageRgb: sumRgb / (pixels * 3),
    maxChannel,
  };
}

export function validateStorageBridgeScreenshot(filePath, logicalWidth, logicalHeight) {
  const image = readPngRgba(filePath);
  const logical = sampleLogicalPixels(image, logicalWidth, logicalHeight);
  return {
    dimensions: [image.width, image.height],
    logicalDimensions: [logicalWidth, logicalHeight],
    scale: [image.width / logicalWidth, image.height / logicalHeight],
    comparison: comparePixels(logical, logicalWidth, logicalHeight),
    image: summarizeImage(logical),
  };
}
