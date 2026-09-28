import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { SCREENSHOT_ROOT, refreshScreenshotGallery } from './screenshot-archive.mjs';

export function archiveGameplayClip(id, name, video, poster, setup) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('Use a simple clip identifier');
  const directory = `${SCREENSHOT_ROOT}/clips`; mkdirSync(directory, { recursive: true });
  copyFileSync(video, `${directory}/${id}.webm`); copyFileSync(poster, `${directory}/${id}.png`);
  const file = `${directory}/manifest.json`, entries = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : [];
  const generatedAt = new Date().toISOString();
  const clip = { name, video: `clips/${id}.webm`, poster: `clips/${id}.png`, generatedAt,
    date: generatedAt.slice(0, 16).replace('T', ' ') + ' UTC', run: setup };
  writeFileSync(file, JSON.stringify([...entries.filter(item => item.video !== clip.video), clip], null, 2));
  refreshScreenshotGallery();
}

export async function startGameplayCapture(page) {
  await page.evaluate(() => {
    const audio = window.__game.ctx.audio; audio.ensure();
    const stream = document.querySelector('#canvas-holder > canvas').captureStream(30);
    const destination = audio.audioCtx.createMediaStreamDestination(); audio.masterGain.connect(destination);
    for (const track of destination.stream.getAudioTracks()) stream.addTrack(track);
    const chunks = [], recorder = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 3000000 });
    recorder.ondataavailable = event => chunks.push(event.data);
    window.__salvageCapture = { stream, destination, chunks, recorder }; recorder.start();
  });
}

export async function finishGameplayCapture(page, path) {
  const data = await page.evaluate(async () => {
    const c = window.__salvageCapture;
    const blob = await new Promise(resolve => {
      c.recorder.onstop = () => resolve(new Blob(c.chunks, { type: 'video/webm' })); c.recorder.stop();
    });
    window.__game.ctx.audio.masterGain.disconnect(c.destination);
    for (const track of c.stream.getTracks()) track.stop();
    return new Promise(resolve => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.readAsDataURL(blob); });
  });
  writeFileSync(path, Buffer.from(data.split(',')[1], 'base64'));
}
