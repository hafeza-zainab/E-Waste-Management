# Submission recording and assembly

Voiceover is AI-generated.

## Record

- Record the guided demo with narration off using `?narration=off`; save as `demo/guided.mp4`.
- Record the real PayPal sandbox run at 1080p in Chrome Incognito; save as `demo/real.mp4`. Use sandbox accounts, show sign-in, authorization, owner confirmation, capture, technician payout and transaction IDs. Keep passwords, keys and personal data out of recordings.
- Use 1920×1080, 30 fps. Disable notifications. Confirm the narration matches the actual visible sandbox outcomes.
- Generate narration using [the audio guide](../docs/TOUR_AUDIO_RECORDING.md). Listen before assembly. Optional main narration: `demo/voiceover-main.mp3` plus matching `demo/voiceover-main.txt`.

## Cut and assemble

Copy `cutlist.example.json` to `cutlist.json`. Paths are relative to `demo/`; `../public/tour/audio/agent.goal.mp3` also works. Each segment has unique `id`, `file`, `start`, `end`, `speed`, `label`, optional `voice`, optional `text` (the exact spoken words) and optional `keepAudio` boolean. Times are seconds or `HH:MM:SS.mmm`. End must be inside the clip. Skip slates by choosing start/end; there is no slate detection.

For a real voiceover add `"voice": "voiceover-real.mp3"` to the real segment and extend its range to fit the measured speech. Its text comes from `docs/voiceover-real-segment.txt`. Other voiceovers need matching `.txt` files, explicit segment `text`, or a verified generated manifest entry. The optional main MP3 is used only when explicitly selected with `voice`. Split narration into separate files when cutting a recording into multiple segments; each voice begins at its segment's start.

Run `npm run video`. Output: `demo/final.mp4` and `demo/final.srt`. Original recording audio is removed unless `keepAudio` is true. Original audio requires speed 1; voiceovers are never accelerated. Overlong voiceovers warn and are clipped at the segment boundary. No music or third-party audio is added.

Keep the timeline at or below 175 seconds to allow margin. Remove pauses, redundant screens and slates; increase video-only segment speed or shorten narration. The tool exits nonzero above 180 seconds and reports seconds to trim. SRT sentence timing is estimated proportionally from text length within measured audio duration, not forced alignment; review and adjust while listening, especially if a voiceover was clipped. Kept original speech needs manual captions.

`npm run video -- --placeholders` creates missing guided/real inputs as five-second silent 1080p30 clips and copies the example cutlist only if no cutlist exists. It then assembles normally. This is a smoke check, not a submission. Replace placeholders with real recordings before use. All demo content except this README and the example is ignored.

## Upload

1. Watch the entire result, check payment claims against visible sandbox results, sync, disclosure, and duration under 3:00.
2. Upload `final.mp4` in YouTube Studio and set visibility to Public.
3. Under Subtitles, upload `final.srt` with timing; review captions and publish them.
4. Include “Voiceover is AI-generated.” in the video description and provide any attribution required by your selected voice plan/model. Copy the public YouTube URL to Devpost.
