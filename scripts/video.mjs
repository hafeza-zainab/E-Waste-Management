import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import path from 'node:path';
import { checkTools, mediaPath, probe, root, run } from './media-utils.mjs';

const demo = path.join(root, 'demo');
const stamp = seconds => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`;
};
function time(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^\d{1,2}:\d{2}:\d{2}(\.\d+)?$/.test(value)) {
    const [h, m, s] = value.split(':').map(Number);
    if (m < 60 && s < 60) return h * 3600 + m * 60 + s;
  }
  throw new Error('Times must be finite seconds or HH:MM:SS.mmm.');
}
async function voiceText(file, segment, manifest) {
  if (segment.text !== undefined) {
    if (typeof segment.text !== 'string' || !segment.text.trim()) throw new Error(`Empty voice text: ${segment.id}`);
    return segment.text.trim();
  }
  const entry = [...(manifest?.steps ?? []), manifest?.real].find(e => e && path.resolve(root, e.file) === file);
  if (entry?.textVerified) return entry.text;
  const sidecar = file.replace(/\.[^.]+$/, '.txt');
  if (existsSync(sidecar)) return (await readFile(sidecar, 'utf8')).trim();
  if (path.basename(file) === 'voiceover-real.mp3') return (await readFile(path.join(root, 'docs/voiceover-real-segment.txt'), 'utf8')).trim();
  throw new Error(`Missing verified voiceover text for ${segment.id}. Add segment.text or a matching .txt sidecar.`);
}
async function main() {
  checkTools();
  await mkdir(demo, { recursive: true });
  if (process.argv.includes('--placeholders')) {
    for (const [name, color] of [['guided', 'teal'], ['real', 'navy']]) {
      const output = path.join(demo, `${name}.mp4`);
      if (!existsSync(output)) run('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=c=${color}:s=1920x1080:r=30:d=5`, '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '5', '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', output]);
    }
    if (!existsSync(path.join(demo, 'cutlist.json'))) await writeFile(path.join(demo, 'cutlist.json'), await readFile(path.join(demo, 'cutlist.example.json')));
  }
  const cutlist = path.join(demo, 'cutlist.json');
  if (!existsSync(cutlist)) throw new Error('Missing demo/cutlist.json. Copy demo/cutlist.example.json and edit it.');
  const segments = JSON.parse(await readFile(cutlist, 'utf8'));
  if (!Array.isArray(segments) || !segments.length) throw new Error('cutlist.json must be a nonempty array of segments.');
  const manifestFile = path.join(root, 'public/tour/audio/manifest.json');
  const manifest = existsSync(manifestFile) ? JSON.parse(await readFile(manifestFile, 'utf8')) : null;
  const ids = new Set();
  let total = 0;
  const captions = [];
  const voices = [];
  for (const segment of segments) {
    if (typeof segment.id !== 'string' || !segment.id || ids.has(segment.id)) throw new Error('Each segment needs a unique nonempty id.');
    ids.add(segment.id);
    segment.input = mediaPath(segment.file);
    const info = probe(segment.input);
    if (!info.video) throw new Error(`No video stream: ${segment.file}`);
    segment.start = time(segment.start);
    segment.end = time(segment.end);
    segment.speed ??= 1;
    if (typeof segment.speed !== 'number' || !Number.isFinite(segment.speed) || segment.speed <= 0) throw new Error(`Invalid speed: ${segment.id}`);
    if (segment.start < 0 || segment.end <= segment.start || segment.end > info.duration + 0.001) throw new Error(`Time range outside clip: ${segment.id}; clip duration ${info.duration.toFixed(3)}s.`);
    if (segment.keepAudio !== undefined && typeof segment.keepAudio !== 'boolean') throw new Error(`keepAudio must be boolean: ${segment.id}`);
    if (segment.keepAudio && segment.speed !== 1) throw new Error(`keepAudio requires speed 1 to avoid speeding original speech: ${segment.id}`);
    segment.originalAudio = segment.keepAudio === true && info.audio;
    segment.seconds = Math.ceil(((segment.end - segment.start) / segment.speed) * 30 - 1e-7) / 30;
    segment.offset = total;
    const entries = Array.isArray(segment.voice) ? segment.voice : segment.voice ? [typeof segment.voice === 'string' ? { file: segment.voice, voiceStart: segment.voiceStart, text: segment.text } : segment.voice] : [];
    for (const entry of entries) {
      const input = mediaPath(entry.file);
      const audio = probe(input);
      if (!audio.audio) throw new Error(`No audio stream: ${entry.file}`);
      const start = entry.voiceStart ?? segment.offset;
      if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) throw new Error(`voiceStart must be nonnegative finite seconds: ${segment.id}`);
      if (audio.duration > segment.seconds) console.warn(`WARNING ${segment.id}: voice is ${(audio.duration - segment.seconds).toFixed(3)}s longer than its associated segment; voice is never accelerated.`);
      const text = await voiceText(input, { id: segment.id, text: entry.text }, manifest);
      if (!text.trim()) throw new Error(`Empty narration text: ${segment.id}`);
      voices.push({ input, start, duration: audio.duration, id: segment.id });
      const phrases = text.match(/[^.!?]+[.!?]*/g) || [text];
      const weight = phrases.reduce((n, p) => n + p.trim().length, 0);
      let cursor = 0;
      for (const phrase of phrases) {
        const end = cursor + audio.duration * phrase.trim().length / weight;
        captions.push({ start: start + cursor, end: start + end, text: phrase.trim() });
        cursor = end;
      }
    }
    total += segment.seconds;
    console.log(`${segment.id}${segment.label ? ` (${segment.label})` : ''}: ${segment.seconds.toFixed(3)}s`);
  }
  console.log(`Total: ${total.toFixed(3)}s`);
  if (total > 180) throw new Error(`Total exceeds 180 seconds. Trim exactly ${(total - 180).toFixed(6)} seconds from the output timeline.`);
  if (total > 175) console.warn('WARNING: above 175 seconds; leave room below 3:00.');
  voices.sort((a, b) => a.start - b.start);
  for (const [i, voice] of voices.entries()) {
    if (voice.start >= total) throw new Error(`Voice starts outside output timeline: ${voice.id}`);
    if (voice.start + voice.duration > total) console.warn(`WARNING ${voice.id}: voice extends beyond the output and will be clipped.`);
    const next = voices[i + 1];
    if (next && voice.start + voice.duration > next.start) console.warn(`WARNING: voice line ${voice.id} overlaps next line ${next.id} by ${(voice.start + voice.duration - next.start).toFixed(3)}s.`);
  }
  const temp = await mkdtemp(path.join(demo, '.video-'));
  try {
    for (const [index, segment] of segments.entries()) {
      const args = ['-v', 'error', '-y', '-ss', String(segment.start), '-t', String(segment.end - segment.start), '-i', segment.input];
      const filters = [`[0:v]setpts=(PTS-STARTPTS)/${segment.speed},scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,tpad=stop_mode=clone:stop_duration=${segment.seconds},trim=duration=${segment.seconds}[v]`];
      const audio = [];
      if (segment.originalAudio) { filters.push('[0:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo[original]'); audio.push('[original]'); }
      if (!audio.length) filters.push('anullsrc=r=48000:cl=stereo[silent]');
      const mix = audio.length > 1 ? `${audio.join('')}amix=inputs=${audio.length}:normalize=0,alimiter=limit=0.95:latency=1` : (audio[0] || '[silent]') + 'anull';
      filters.push(`${mix},apad,atrim=duration=${segment.seconds},asetpts=PTS-STARTPTS[a]`);
      args.push('-filter_complex', filters.join(';'), '-map', '[v]', '-map', '[a]', '-t', String(segment.seconds), '-c:v', 'libx264', '-preset', 'fast', '-crf', '20', '-pix_fmt', 'yuv420p', '-c:a', 'pcm_s16le', path.join(temp, `${index}.mkv`));
      run('ffmpeg', args);
    }
    await writeFile(path.join(temp, 'concat.txt'), segments.map((_, i) => `file '${i}.mkv'`).join('\n'));
    const finalArgs = ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', path.join(temp, 'concat.txt')];
    for (const voice of voices) finalArgs.push('-i', voice.input);
    if (voices.length) {
      const filters = ['[0:a]asetpts=PTS-STARTPTS[base]'];
      voices.forEach((voice, i) => filters.push(`[${i + 1}:a]asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,adelay=${Math.round(voice.start * 1000)}:all=1[v${i}]`));
      filters.push(`[base]${voices.map((_, i) => `[v${i}]`).join('')}amix=inputs=${voices.length + 1}:duration=first:normalize=0,alimiter=limit=0.95:latency=1,atrim=duration=${total}[mixed]`);
      finalArgs.push('-filter_complex', filters.join(';'), '-map', '0:v', '-map', '[mixed]');
    } else finalArgs.push('-map', '0:v', '-map', '0:a');
    run('ffmpeg', [...finalArgs, '-t', String(total), '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', path.join(temp, 'final.mp4')]);
    const measured = probe(path.join(temp, 'final.mp4')).duration;
    if (measured > 180) throw new Error(`Encoded output exceeds 180 seconds. Trim exactly ${(measured - 180).toFixed(6)} seconds.`);
    await rename(path.join(temp, 'final.mp4'), path.join(demo, 'final.mp4'));
    const visibleCaptions = captions.filter(c => c.start < total).sort((a, b) => a.start - b.start);
    await writeFile(path.join(demo, 'final.srt'), visibleCaptions.map((c, i) => `${i + 1}\n${stamp(c.start)} --> ${stamp(Math.min(c.end, total))}\n${c.text}\n`).join('\n'));
    if (!captions.length) console.warn('No voiceovers selected: final.srt is empty.');
    console.log(`Success: demo/final.mp4 measured duration ${measured.toFixed(3)}s; demo/final.srt written.`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
