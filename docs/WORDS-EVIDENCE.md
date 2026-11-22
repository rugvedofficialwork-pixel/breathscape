# The Door: why these four words

Decided on 21 Nov 2026: keep only words with clear research backing. Strength was removed and Acceptance added.

| Word | What it answers | Evidence | Status |
| --- | --- | --- | --- |
| Calm | Anxiety, a body stuck "on" | Relaxation training for anxiety: medium-to-large effect across 27 studies ([Manzoni et al. 2008](https://pubmed.ncbi.nlm.nih.gov/18518981/)). Contentment speeds heart-rate recovery after anxiety ([Fredrickson et al.](https://pubmed.ncbi.nlm.nih.gov/21731120/)). | Kept |
| Kindness | Self-criticism, shame | Self-compassion interventions, 27 RCTs: self-criticism g = 0.56, anxiety 0.57, depression 0.66, stress 0.67 ([Ferrari et al. 2019](https://link.springer.com/10.1007/s12671-019-01134-6)). | Kept. Needs work: the lines should make it kindness towards yourself. |
| Courage | Fear, avoidance | Courage as approaching despite fear ([Rachman](https://pmc.ncbi.nlm.nih.gov/articles/PMC2665714)), which is the basis of exposure therapy. | Kept. Needs work: the backing is for the act of approaching, not the word or image. |
| Acceptance | Loss, what cannot be changed, uncertainty | Acceptance and commitment therapy, 39 RCTs: g = 0.57, as effective as CBT ([A-Tjak et al. 2015](https://pubmed.ncbi.nlm.nih.gov/25547522/)). | Added. Written as ACT's "making room" (expansion). |
| ~~Strength~~ | Helplessness, exhaustion | Self-efficacy grows from actually doing the hard thing, not from declaring strength. Positive self-statements can make low-self-esteem listeners feel worse ([Wood et al. 2009](https://pubmed.ncbi.nlm.nih.gov/19493324/)). Overlapped with Courage. | Removed |

## Acceptance in the session

- **Words:** Part D "you choose acceptance", Part F, the F2 line and the two Part G lines in `src/content/lines.ts`. The clips were generated with the Door's voice settings (en-US-AndrewNeural, -24%, -14 Hz).
- **Picture** (`src/visuals/effects.ts`, `Acceptance`): wind keeps blowing and passes through an open space around you. Opening your arms widens the space. Inside it the wind slows a little and softens. The edge is a faint broken ring, never a wall.
- **Simple sound** (`src/audio/effects.ts`): the wind stays at the same level and only its edge softens as the arms open, while an open chord (the room) grows. Unlike Courage and Calm, the wind is never quieted.
- **3D sound** (`src/spatial-engine/src/cues/stage3ef.ts`, `acceptanceEffect`, settings in `cues.json`): passing winds keep moving left to right at the same level. Opening the arms brings their path closer and softens them, and the room chord widens to both sides.

## Acceptance's own gesture (22 Nov 2026)

The other words raise both hands, then open the arms. Acceptance does not reach up: you let your arms hang low and open them out to your sides, palms facing forward, on a breath out (making room, not effort). Open, unclenched postures avoid the closed postures that lower mood (Elkjær et al. 2022), and the slow breath out is the calming part with the best backing. The open palms carry the "making room" idea; there is no direct evidence for the hand shape itself.

- **Part E:** `s3.e.raise.acceptance`. It is triggered by `armsOpenLow` in `src/tracking/pose.ts`: both wrists below the shoulders and at least 1.6 shoulder widths apart, held for 0.7 s (`CONFIG.openLow`). The mouse and keyboard stand-in is Space, as for raised hands.
- **Part F (updated 22 Nov):** the room is held open between your two hands, with a light at each hand. It follows the hands directly, the wind inside turns to slow green-gold light, and a ring goes out each time you open further; the room chord swells from almost nothing and brightens as the arms open. The nudge hint reads "Breathe out, and let your arms open a little wider".
- **Part G:** `s3.g.1.acceptance` ("Let your arms come back to your sides…"). The effect fades as the arms come back in (spread), not as the hands come down, because the arms are already low.
