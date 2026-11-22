# Breathscape

A short guided box-breathing exercise (6 cycles of 4 s in, 4 s hold, 4 s out, 4 s rest) in the browser.
Luminous particles surround you and rise and brighten as you breathe in (tilt your head up), and sink and dim as you breathe out.
Your head tilt is read from the webcam (MediaPipe face and pose models, running locally); without a camera it follows a timer.
The guide voice is the author's own recording. Part of a larger gesture-driven meditation prototype, "The Door".

## Run it

```bash
npm install
npm run dev      # http://localhost:5180
```

Open it in Chrome or Edge, click **Begin**, allow the camera (optional) and use headphones.
`?debug=1` shows a tracking overlay, `H` shows the head-tilt tracking.

## Built with

Claude Code: the interaction design, TypeScript code, tuning and the 3D sound engine. Narration is recorded by the author.
