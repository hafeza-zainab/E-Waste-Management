import { existsSync } from 'node:fs';
import { readFile, writeFile, mkdir, mkdtemp, rm, rename } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { checkTools, probe, root, run } from './media-utils.mjs';

async function main() {
  const engine = process.env.TTS_ENGINE || (process.platform === 'win32' ? 'windows' : undefined);
  const voice = process.env.TTS_VOICE;
  const windowsSpeech = (extra = {}) => run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts/windows-speech.ps1')], { env: { ...process.env, ...extra } });
  if (process.argv.includes('--list-voices')) {
    if (process.platform !== 'win32') throw new Error('--list-voices requires Windows System.Speech.');
    console.log(windowsSpeech({ RELOOP_SPEECH_LIST: '1' }).trim());
    return;
  }
  checkTools();
  if (!['windows', 'piper', 'elevenlabs'].includes(engine) || (engine !== 'windows' && !voice)) throw new Error('Set TTS_ENGINE=windows|piper|elevenlabs and TTS_VOICE (installed Windows voice, Piper model path or ElevenLabs voice ID).');
  if (engine === 'windows' && process.platform !== 'win32') throw new Error('The windows TTS engine requires Windows.');
  const rate = Number(process.env.TTS_RATE ?? -1);
  if (engine === 'windows' && (!Number.isInteger(rate) || rate < -3 || rate > 3)) throw new Error('TTS_RATE must be an integer from -3 to 3 (default -1).');
  if (engine === 'elevenlabs' && !process.env.ELEVENLABS_API_KEY) throw new Error('Set ELEVENLABS_API_KEY in your environment.');
  const captions = JSON.parse(await readFile(path.join(root, 'docs/tour-captions.json'), 'utf8'));
  const { CHAPTERS } = await import('../lib/tour/script.ts');
  const tasks = CHAPTERS.flatMap(c => c.steps.filter(s => s.cap).map(s => {
    const [group, key] = s.cap.split('.');
    const value = captions[group]?.[key];
    const text = typeof value === 'string' ? value : value?.narration ?? value?.text ?? value?.caption;
    return { id: s.cap, text, onScreenSeconds: s.ms ? s.ms / 1000 : null, file: `public/tour/audio/${s.cap}.mp3` };
  }));
  tasks.push({ id: 'real', text: (await readFile(path.join(root, 'docs/voiceover-real-segment.txt'), 'utf8')).trim(), onScreenSeconds: null, file: 'demo/voiceover-real.mp3' });
  const force = process.argv.includes('--force');
  const temp = await mkdtemp(path.join(os.tmpdir(), 'reloop-tts-'));
  const manifest = { engine, steps: [], real: null };
  let total = 0;
  try {
    for (const task of tasks) {
      if (typeof task.text !== 'string' || !task.text.trim()) throw new Error(`Missing narration: ${task.id}`);
      const output = path.join(root, task.file);
      await mkdir(path.dirname(output), { recursive: true });
      const skipped = existsSync(output) && !force;
      if (!skipped) {
        const source = path.join(temp, 'source.wav');
        if (engine === 'windows') {
          const input = path.join(temp, 'input.txt');
          await writeFile(input, task.text, 'utf8');
          windowsSpeech({ RELOOP_SPEECH_LIST: '0', RELOOP_SPEECH_INPUT: input, RELOOP_SPEECH_OUTPUT: source, RELOOP_SPEECH_RATE: String(rate) });
        } else if (engine === 'piper') {
          // Suppress provider output: it is never needed in a log containing user text.
          const input = path.join(temp, 'input.txt');
          await writeFile(input, task.text);
          try { run(process.env.PIPER_BIN || 'piper', ['--model', voice, '--output_file', source], { input: task.text }); }
          catch { throw new Error('Piper failed. Check installation, model and matching .onnx.json; provider output suppressed.'); }
        } else {
          let response;
          try {
            response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=mp3_44100_128`, {
              method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
              body: JSON.stringify({ text: task.text, model_id: 'eleven_multilingual_v2' }), signal: AbortSignal.timeout(120000),
            });
          } catch { throw new Error('ElevenLabs request failed (network or timeout); details suppressed to protect credentials.'); }
          if (!response.ok) throw new Error(`ElevenLabs HTTP ${response.status}; response body suppressed to protect credentials.`);
          await writeFile(source, Buffer.from(await response.arrayBuffer()));
        }
        const staged = path.join(temp, 'normalized.mp3');
        run('ffmpeg', ['-v', 'error', '-y', '-i', source, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11', '-ac', '1', '-ar', '44100', '-c:a', 'libmp3lame', '-b:a', '96k', staged]);
        // Copy adjacent to output before rename, including when temp is on another drive.
        await writeFile(`${output}.tmp`, await readFile(staged));
        await rename(`${output}.tmp`, output);
      }
      const seconds = probe(output).duration;
      total += seconds;
      console.log(`${task.id}: ${seconds.toFixed(3)}s${skipped ? ' (existing, skipped)' : ''}`);
      if (task.onScreenSeconds !== null && seconds > task.onScreenSeconds) console.warn(`WARNING ${task.id}: speech exceeds on-screen time by ${(seconds - task.onScreenSeconds).toFixed(3)}s.`);
      if (task.onScreenSeconds === null) console.warn(`${task.id}: on-screen time is action-dependent; compare manually with your recording.`);
      const entry = { ...task, duration: seconds, textVerified: !skipped };
      if (task.id === 'real') manifest.real = entry;
      else manifest.steps.push(entry);
    }
    await writeFile(path.join(root, 'public/tour/audio/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    console.log(`Total spoken duration: ${total.toFixed(3)}s. Existing audio text is unverified; use --force after edits.`);
  } finally { await rm(temp, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
