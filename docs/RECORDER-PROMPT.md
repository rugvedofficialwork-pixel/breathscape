# Prompt for the narration recorder (paste into a new, empty project folder)

Copy everything inside the box below into Claude Code in a new empty folder (for example `C:\Users\Rugved\Downloads\door-recorder`).

```text
Build me a small local app for recording my own narration for a guided meditation called "The Door", one sentence at a time. It runs on my Windows laptop in Microsoft Edge, with a USB microphone. Keep it simple, calm-looking and quick to use. Nothing is sent to the internet.

THE LINES
- Read the script from C:\Users\Rugved\Downloads\the-door-full\scripts\lines.json. It is a list of {"id": "s2.m1.a", "sentences": ["...", "..."]}. Each sentence is one recording.
- Never modify that file or anything else in the-door-full. Copy it into this project at start-up, and add a "Reload script" button that copies it again.
- Group the lines by section using the id prefix: pre = Welcome, s1 = Breathing, s2 = Witnessing, s3.a/b/c = The journey, s3.d/e/f = The door, s3.f2 = Taking it in, s3.g = The return, s4 = Conclusion. Ids ending in .kindness / .strength / .courage / .calm are word variants: label them.

THE SCREEN
- Large, readable text of the current sentence in the middle. Above it, the whole line it belongs to, in small grey text with the current sentence highlighted, so I know the context and the intonation.
- A list or sidebar of all sentences with a status mark: not recorded, recorded, marked as good. Clicking one jumps to it. Show the overall progress (for example "62 of 175 recorded, 14 min of speech").
- A live input level meter while recording, with a clear warning if it clips (too loud) or is very quiet.
- A short reading direction always visible: "Slow, low and warm. Relaxed, unhurried, as if speaking to someone drifting off. Let sentences fall gently at the end. Leave the pauses to the app."

RECORDING
- One big Record button. Press to start, press again to stop. Keyboard: R = record/stop, Space = play the last take, Enter = mark as good and go to the next sentence, Left/Right arrows = previous/next sentence, Delete = discard the current take.
- A 0.5 s count-in (a soft visual cue, no sound) before recording starts, so the first word is not clipped.
- Every take is kept (take 1, take 2, ...) and can be played and chosen. The chosen take is the one exported. Re-recording never overwrites an earlier take.
- Use getUserMedia with echoCancellation, noiseSuppression and autoGainControl all OFF (they make voices sound processed), mono, the highest sample rate the mic supports. Let me pick the microphone from a dropdown and remember it.

SAVING (automatic)
- Every take is saved the moment I stop, as a WAV file (mono, 48 kHz, 16-bit or 24-bit). Use a tiny local Node server (no database) that writes the files to disk, so nothing is lost if the browser closes.
- Folder layout inside this project:
    recordings/takes/<line id>/<sentence number>_take<k>.wav      (every take)
    recordings/export/<line id>/<sentence number>.wav              (the chosen take, cleaned, see below)
    recordings/export/manifest.json
- manifest.json must use exactly this format, which my app already plays:
    { "s2.m1.a": ["s2.m1.a/0.wav", "s2.m1.a/1.wav"], "s2.m1.b": ["s2.m1.b/0.wav"], ..., "_voice": { "voice": "Rugved (recorded)", "rate": "", "pitch": "" } }
  Only include lines whose every sentence has a chosen take.
- On start-up, load existing takes from disk so I can carry on where I stopped.

CLEANING THE CHOSEN TAKE (when exporting)
- Trim silence at the start and end, leaving about 0.15 s, with 20 ms fades so there are no clicks.
- Remove low rumble (high-pass filter around 80 Hz).
- Make all clips the same loudness (about -20 LUFS, peaks no higher than -1 dBFS).
- Optional "room tone" step: record 5 s of silence once; use it for gentle noise reduction. Keep it subtle: a natural voice matters more than total silence.
- Use ffmpeg if it is installed (check, and tell me how to install it if not); otherwise do the trimming and loudness in JavaScript.
- An "Export all" button, plus a "Copy into The Door" button that copies recordings/export/* into C:\Users\Rugved\Downloads\the-door-full\public\audio-recorded\ (create the folder, never touch public\audio). Ask me before overwriting anything there.

PLAYBACK AND CHECKING
- Play any take instantly. A "Play in context" button plays the previous sentence, a 1.1 s pause, then this one, to check that consecutive sentences sound like the same voice and level.
- Show each take's length and peak level. Flag takes that are clipped or much quieter or louder than the rest.

AFTER BUILDING
- Give me one start-recorder.bat to double-click, which starts the server and opens Edge at the right address.
- Test it yourself (record a few seconds from a fake audio input in a headless browser, check the WAV files, the manifest and the export). Then tell me plainly what works and what you could not test.
```

## Afterwards

When some or all of the lines are recorded and copied in, tell Claude in The Door project: "use my recordings in public/audio-recorded". The app then plays your voice wherever a recording exists, and the computer voice for anything not recorded yet.
