# Recording the demo clips

`npm run record:demo` records four clean screen clips of the scripted (demo-mode) flows, with on-screen captions, so the only thing you record by hand is the real PayPal sandbox checkout.

## Run it

Two terminals, from the repo root:

```
npm run record:server     # terminal 1: fresh seeded database, PayPal credentials blanked, scripted AI, port 3300
npm run record:demo       # terminal 2: records all four clips
npm run record:demo -- --only 03     # just one clip (01, 02, 03, 04)
```

Clips land in `docs/clips/` (git-ignored):

| File | Shows | Suggested length |
|---|---|---|
| `01-agent-cracked-screen.webm` | goal + budget, live trace, over-budget block, quote card. Stops before Approve | about 20 s |
| `02-safety-swollen-battery.webm` | diagnosis, red safety stop, "DIY is not offered", technician booking up to the quote | about 22 s |
| `03-technician-completes.webm` | approve + **simulated** pay, technician accepts/starts/completes with a proof photo, owner confirms, timeline | about 60 s |
| `04-cv-certificate-impact.webm` | technician profile, CV download, donation, certificate, impact page | about 45 s |

The Next.js dev "N" badge may appear bottom-left in the video (it is the dev server, not the app); crop it in your editor, or ignore it.

Re-run safe: `record:server` creates a brand-new database in your temp folder on every start, so every take begins from the same seed. Restart it before re-recording clip 03, which changes data.

Options (environment variables): `BASE_URL` (default `http://localhost:3300`), `SLOWMO` in ms (default 250; raise it for slower, more readable clicks), `HEADED=1` to watch the browser, `EDGE_PATH` / `CHROME_PATH` for a specific browser. If nothing answers on `BASE_URL` the recorder stops with a message telling you to start `npm run record:server`.

PowerShell example: `$env:SLOWMO=400; npm run record:demo`

## Edit the captions

Captions live in `docs/demo-captions.json`, keyed by clip then by moment. Change the text and re-record; an empty string removes that caption. They are injected by the recorder only; the app never contains them.

## What is SIMULATED

The recording server has no PayPal credentials, so clip 03 uses the app's labelled local simulation ("Approve and pay (simulated PayPal)", SIMULATED tags on the job and payout). That is honest, not hidden. Replace clip 03 with your own recording of the real sandbox flow if your real test works.

## PayPal's checkout popup needs a manual recording

PayPal's own login/approval window is a separate browser window with bot protection. Record it yourself (OBS Studio, Xbox Game Bar `Win+G`, or QuickTime) at 1280x720 against the hosted or a credentialed local app. Show the amber sandbox banner, the Approve click, the PayPal popup with the sandbox buyer, and the "Payment authorized" toast.

## Convert .webm to .mp4 (ffmpeg)

```
ffmpeg -i docs/clips/01-agent-cracked-screen.webm -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart docs/clips/01-agent-cracked-screen.mp4
```

All four in PowerShell:

```
Get-ChildItem docs/clips/*.webm | ForEach-Object { ffmpeg -i $_.FullName -c:v libx264 -pix_fmt yuv420p -crf 20 -movflags +faststart ($_.FullName -replace '\.webm$','.mp4') }
```

Install ffmpeg with `winget install Gyan.FFmpeg` if you do not have it.

## Assemble the final video

Free editors: DaVinci Resolve, Shotcut, or Clipchamp (built into Windows 11). Order from `docs/demo-script.md`: landing intro, clip 01 (cut where you want the real PayPal part), your manual PayPal recording, clip 02, clip 03, clip 04, closing card. Keep the total near 2:45; trim holds with the editor rather than re-recording. Add your voice-over on top (the captions already carry the key facts). Export 1080p or 720p MP4, H.264.
