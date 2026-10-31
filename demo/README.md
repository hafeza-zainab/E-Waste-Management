# Submission recording and assembly

Voiceover is AI-generated.

## Record

- On Windows, generate audio yourself with `npm run tour:audio:generate` (use `-- --force` if replacing edited narration). Do this before building, including the new slate files.
- Run the production build locally: `npm run build`, then `npm start`. Open Chrome at 1920×1080 with `?record=1` (for example `http://localhost:3000/?record=1`). Ensure narration is on and volume is audible. Use `?narration=off` only when deliberately recording silently.
- Start recording **with desktop audio enabled**: OBS with a “Desktop Audio” source, or Xbox Game Bar (`Win+G`) with app audio enabled. Then click “Run guided demo” and don't touch the page. If “Tap to enable sound” appears, enable it and restart the recording to capture the whole narration. Save as `demo/guided.mp4`.
- Record the real PayPal sandbox run at 1080p in Chrome Incognito; save as `demo/real.mp4`. Use sandbox accounts, show sign-in, authorization, owner confirmation, capture, technician payout and transaction IDs. Keep passwords, keys and personal data out of recordings.
- Use 1920×1080, 30 fps. Disable notifications. Confirm the narration matches the actual visible sandbox outcomes.
- Generate narration using [the audio guide](../docs/TOUR_AUDIO_RECORDING.md). Listen before assembly. Optional main narration: `demo/voiceover-main.mp3` plus matching `demo/voiceover-main.txt`.

The `paypal-slate` banner (“Now showing how PayPal works here”) marks where the real insert starts; `paypal-slate-end` (“Back in the guided demo”) marks where to return to the narrated recording. Cut out both banners. They do not perform any PayPal action. Record the real sandbox flow separately in Incognito.

## Cut and assemble

Copy `cutlist.example.json` to `cutlist.json`. Paths are relative to `demo/`; `../public/tour/audio/agent.goal.mp3` also works. Each segment has unique `id`, `file`, `start`, `end`, `speed`, `label`, optional `voice`, optional `text` (the exact spoken words) and optional `keepAudio` boolean. Times are seconds or `HH:MM:SS.mmm`. End must be inside the clip. Skip slates by choosing start/end; there is no slate detection.

For a narrated recording, use three entries: guided before the first slate, the real PayPal insert, and guided after the return slate. Set `keepAudio: true` and `speed: 1` for both guided entries so their recorded narration survives. For the insert, use `file: "real.mp4"`, `voice: "voiceover-real.mp3"` and `keepAudio: false` to avoid doubling its voiceover. Set its optional `voiceStart` to the insert's start on the assembled output timeline, or omit it for the same default. Choose real start/end values from your recordings; the tiny example cutlist is only a smoke check. Do not layer step MP3s over guided segments that already contain recorded narration.

For a real voiceover add `"voice": "voiceover-real.mp3"` to the real segment and extend its range to fit the measured speech. Its text comes from `docs/voiceover-real-segment.txt`. Other voiceovers need matching `.txt` files, explicit segment `text`, or a verified generated manifest entry. The optional main MP3 is used only when explicitly selected with `voice`.

To schedule multiple narration lines, use `"voice": [{ "file": "line1.mp3", "voiceStart": 0.5, "text": "First line." }, { "file": "line2.mp3", "voiceStart": 3, "text": "Second line." }]`. `voice` also accepts one such object. A string `voice` supports `voiceStart` on the segment. `voiceStart` is seconds from the start of the complete output timeline, independent of clip start and speed; when omitted it defaults to the associated segment's output start. Voices are delayed with `adelay` and mixed with `amix` after video concatenation, so they can span segment boundaries. Overlap with the next chronological voice line warns. SRT timing uses the same global offsets.

Run `npm run video`. Output: `demo/final.mp4` and `demo/final.srt`. Original recording audio is removed unless `keepAudio` is true. Original audio requires speed 1; voiceovers are never accelerated. Overlong voiceovers warn and are clipped only at the final output boundary. No music or third-party audio is added.

Keep the timeline at or below 175 seconds to allow margin. Remove pauses, redundant screens and slates; increase video-only segment speed or shorten narration. The tool exits nonzero above 180 seconds and reports seconds to trim. SRT sentence timing is estimated proportionally from text length within measured audio duration, not forced alignment; review and adjust while listening, especially if a voiceover was clipped. Kept original speech needs manual captions.

The narrated 1x tour can exceed three minutes. Keep narrated segments at speed 1 and trim whole sections or shorten the narration and regenerate it yourself. Run `npm run video` and check its measured `demo/final.mp4` duration; the submission must be under 3:00. Leave a few seconds of margin. Listen to the exported guided segments and the inserted real voiceover. Since kept recording audio has no separate text metadata, add or correct its captions manually in YouTube or the SRT.

`npm run video -- --placeholders` creates missing guided/real inputs as five-second silent 1080p30 clips and copies the example cutlist only if no cutlist exists. It then assembles normally. This is a smoke check, not a submission. Replace placeholders with real recordings before use. All demo content except this README and the example is ignored.

## Upload

1. Watch the entire result, check payment claims against visible sandbox results, sync, disclosure, and duration under 3:00.
2. Upload `final.mp4` in YouTube Studio and set visibility to Public.
3. Under Subtitles, upload `final.srt` with timing; review captions and publish them.
4. Include “Voiceover is AI-generated.” in the video description and provide any attribution required by your selected voice plan/model. Copy the public YouTube URL to Devpost.
