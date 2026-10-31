# Tour voice generation

Requires Node (the repo's existing tsx runner), ffmpeg and ffprobe on PATH. No new npm dependencies. Run from the repo root. Caption IDs become filenames such as `public/tour/audio/agent.goal.mp3`. Each referenced tour step uses its `narration` field when present, otherwise `text`/`caption` or the existing string. UI-only messages are excluded. The real segment reads `docs/voiceover-real-segment.txt`; edit its seven template sentences to match the actual recording.

## Offline: Piper

## Offline default on Windows: System.Speech

When `TTS_ENGINE` is unset on Windows, the generator uses the built-in offline `System.Speech` synthesizer through Windows PowerShell. No key, download or Python installation is needed. List enabled installed voices with `npm run tour:audio:generate -- --list-voices`. Set `TTS_VOICE` to an exact listed name, or leave it unset to use the system default. Set `TTS_RATE` to an integer from -3 to 3 (default -1). Run `npm run tour:audio:generate` to synthesize each step to a temporary WAV and convert it to normalized mono 96 kbps MP3. Use `--force` to replace existing audio. This engine uses the installed Windows voice terms; retain the AI-generated voice disclosure. Listen to the result and check pronunciation and timing.

## Piper setup

Install Piper in a separate Python virtual environment with `python -m pip install piper-tts` using a supported Windows Python version. Prefer a binary wheel; if installation requires a troublesome native build, use the hosted option rather than modifying the app environment. Download one single-speaker `.onnx` voice and its matching `.onnx.json` outside the repo, checking its model card first. Add the venv Scripts directory to PATH or set `PIPER_BIN` to its `piper.exe`.

PowerShell:

```powershell
$env:TTS_ENGINE = 'piper'
$env:TTS_VOICE = 'C:\voices\en_US-lessac-medium.onnx'
npm run tour:audio:generate
```

The script uses that same model for all steps and the real segment. Installation was not attempted automatically: it changes your Python environment and requires model downloads. Windows compatibility and actual voice quality need local verification.

[Piper CLI setup](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/CLI.md), [GPL-3.0 licence](https://github.com/OHF-Voice/piper1-gpl/blob/main/COPYING). Individual voice models have separate model-card licences; retain required attribution and verify redistribution rights before shipping audio. The engine licence alone does not establish rights to a voice. No universal Piper voice disclosure requirement is assumed; follow the model's conditions and disclose “Voiceover is AI-generated.” in the submission.

## Hosted: ElevenLabs

Set `TTS_ENGINE=elevenlabs`, `TTS_VOICE` to one permitted voice ID and `ELEVENLABS_API_KEY` in the process environment using your secret manager. Then run `npm run tour:audio:generate`. This sends narration text to ElevenLabs and may consume paid credits. No API calls occur unless you run this command with that engine. The script never prints the key or provider response bodies. Do not paste keys into source, command examples, logs or commits. No `.env` file is automatically loaded.

Uses the [text-to-speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert) with `eleven_multilingual_v2`. Review [terms](https://elevenlabs.io/terms-of-use), your plan's commercial/attribution rights and the [voice library terms](https://elevenlabs.io/voice-library-addendum). This guide does not assume a free plan grants commercial rights. Include the AI-generated voice disclosure and any additional attribution required by your plan or voice.

## Outputs and review

MP3s are mono, 44.1 kHz, 96 kbps, normalized with ffmpeg loudnorm targeting approximately -16 LUFS. Short utterances can vary; listen to the whole sequence. `public/tour/audio/manifest.json` includes exact source text, measured durations and known on-screen durations. Speech longer than a fixed on-screen time warns; action-dependent steps require comparison against the recording. Timing assumes the tour's normal speed. The manifest also describes `demo/voiceover-real.mp3`.

Existing MP3s are skipped. Use `npm run tour:audio:generate -- --force` after editing narration or switching engine/voice; otherwise old files may contain different voices/text. Skipped files are marked text-unverified in the manifest. Review sidecar or explicit caption text when reusing them. The generator does not join a main narration automatically; select per-step audio in the cutlist or supply a separately recorded main narration.

Default: public tour audio remains eligible for shipping and is not ignored. Generation alone does not add playback support to the app; app code is unchanged. `demo/` media and local cutlists are ignored. This change commits no media. If you later decide not to ship tour audio, add `/public/tour/audio/*.mp3` to `.gitignore` yourself; that is an explicit opt-out.
