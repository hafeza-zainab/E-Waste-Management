import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, ...options });
  if (result.error?.code === 'ENOENT') throw new Error(`${command} is missing. Install it and add it to PATH.`);
  if (result.error) throw new Error(`${command} could not run.`);
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
export function checkTools() {
  run('ffmpeg', ['-version']);
  run('ffprobe', ['-version']);
}
export function probe(file) {
  if (!existsSync(file)) throw new Error(`Input file is absent: ${file}`);
  const data = JSON.parse(run('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]));
  const duration = Number(data.format.duration);
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`Invalid media duration: ${file}`);
  return { duration, audio: data.streams.some(s => s.codec_type === 'audio'), video: data.streams.some(s => s.codec_type === 'video') };
}
export function mediaPath(file) {
  if (typeof file !== 'string' || !file) throw new Error('Media file must be a nonempty path relative to demo/.');
  const target = path.resolve(root, 'demo', file);
  const relative = path.relative(root, target);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Media paths must stay inside the repository.');
  return target;
}
