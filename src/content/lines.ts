// Line manifest. Text is copied verbatim from docs/session-script.md.
// `parts`: strings are spoken/captioned; numbers are extra pauses in ms.
// Swap speak() for recorded audio later by keying files on `id`.
export interface Line {
  id: string;
  parts: (string | number)[];
}

const L = (id: string, ...parts: (string | number)[]): Line => ({ id, parts });

export const LINES: Line[] = [
  // ---- Stage 1: box breathing ----
  L('s1.open', 'Rest one hand out in front of you, palm up.', 'We’re going to breathe together, and your hand is going to breathe with you.'),

  L('s1.c1.in', 'Breathe in — let your hand rise.'),
  L('s1.c1.hold', 400, 'hold it there.'),
  L('s1.c1.out', 'Now let it go — hand comes back down.'),
  L('s1.c1.rest', 400, 'and rest.'),

  L('s1.c2.in', 'Again. In, and up.'),
  L('s1.c2.hold', 'Hold.'),
  L('s1.c2.out', 'Out, and down.'),
  L('s1.c2.rest', 'Rest.'),

  L('s1.c3.in', 'In.'),
  L('s1.c3.hold', 'Hold.'),
  L('s1.c3.out', 'Out.'),
  L('s1.c3.rest', 'Rest.'),

  L('s1.c4.in', 'In...'),
  L('s1.c4.hold', 'Hold...'),
  L('s1.c4.out', 'Out...'),
  L('s1.c4.rest', 'Rest.'),

  L('s1.c5.in', 'In.'),
  L('s1.c5.hold', 'Hold.'),
  L('s1.c5.out', 'Out.'),

  L('s1.c6.one', 'One more. However it comes.'),
  L('s1.c6.good', 'Good.'),

  L('s1.close', 'Let your hand rest completely.', 'In a moment I’m going to ask you to close your eyes — you can do that now, whenever you’re ready.'),
];

// ---- Experiment: breathing with the head instead of the hand ("Breathe with: head") ----
// Only the lines that mention the hand have a head version (id + '.head'); the rest are shared.
LINES.push(
  L('s1.open.head', 'Sit comfortably, facing the screen, with your head level.', 'We’re going to breathe together. As you breathe in, let your chin lift a little. As you breathe out, let it come back down.'),
  L('s1.c1.in.head', 'Breathe in — let your chin lift.'),
  L('s1.c1.out.head', 'Now let it go — your head comes back down.'),
  L('s1.close.head', 'Let your head rest, level and easy.', 'In a moment I’m going to ask you to close your eyes — you can do that now, whenever you’re ready.'),
);

// ---- Pre-session, Stage 2 (Witnessing) and Stage 3 Parts A-C (the journey) ----
// Verbatim from docs/session-script.md (same text as the spatial audio project's harness/lines.ts).
LINES.push(
  // Pre-session
  L('pre.a', 'Welcome. Over the next half hour, nothing is being asked of you except this: breathe when I say breathe, listen when I say listen, and move when I say move. There’s no right way to feel about any of it.'),
  L('pre.b', 'Get comfortable. When you’re ready, we’ll begin.'),


  // Stage 2: Witnessing. Movement 1 Arriving, 2 Noticing a thought, 3 The thought passing, 4 Stillness, 5 Acceptance, 6 Transition
  L('s2.m1.a', 'Eyes closed now. You don’t have to relax on command — just notice what’s actually here. The weight of your body. The sound of your own breath.'),
  L('s2.m1.b', 'You don’t need to change anything yet. Just arrive.'),
  L('s2.m2.a', 'At some point in the next few minutes, a thought is going to show up. Maybe it already has.'),
  L('s2.m2.b', 'It might be about today. About someone you haven’t resolved something with. About yourself.'),
  L('s2.m2.c', 'When it comes — don’t chase it, and don’t push it out. Just see that it’s there. The way you’d notice a sound in another room. You don’t have to go check on it.'),
  L('s2.m3.a', 'Notice — it arrived from somewhere.'),
  L('s2.m3.b', 'And if you leave it alone, completely alone, it will go somewhere too.'),
  L('s2.m3.c', 'You don’t have to help it leave. You don’t have to hold the door for it either.'),
  L('s2.m3.d', 'There it goes.'),
  L('s2.m4.a', 'Notice what’s underneath, once you stop chasing the thought and stop fighting it.'),
  L('s2.m4.b', 'That underneath place — that’s not empty. That’s just you, without the argument.'),
  L('s2.m5.a', 'Whatever is actually true for you right now — the good, the unresolved, the tired, the fine — is allowed to be true. You don’t have to fix it before you’re allowed to rest in it.'),
  L('s2.m5.b', 'You are not behind. You are not late to your own life. You are exactly where you are.'),
  L('s2.m6.a', 'In a little while, there’s somewhere I’m going to ask you to go. For now — just breathe. Nothing to solve.'),
  L('s2.m6.b', 'When you hear the door, you’ll know we’re moving on. Stay exactly as you are until then.'),


  // Stage 3 Part A: Threshold, Part B: Arrival, Part C: The Trial (split where the wind cues land)
  L('s3.a.1', 'There’s a door in front of you.'),
  L('s3.a.2', 'It’s already open.'),
  L('s3.a.3', 'Step through.'),
  L('s3.b.1', 'You’re somewhere else now.'),
  L('s3.b.2', 'Under your feet — soft ground, damp, cool. Somewhere close, water is moving. Above you, more sky than you’re used to seeing at once.'),
  L('s3.b.3', 'This place doesn’t need you to understand it. It just needs you to walk.'),
  L('s3.b.4', 'So walk.'),
  L('s3.c.1a', 'Ahead of you, the path narrows.'),
  L('s3.c.1b', 'The wind picks up — not dangerous, just insistent, like it’s testing whether you’ll turn back.'),
  L('s3.c.2', 'There’s a weight to carry here. Maybe it’s literal — a stone, a bag, something heavy in your arms. Maybe it’s just tiredness. Either way, it’s yours to carry for this stretch.'),
  L('s3.c.3', 'Keep walking. One step doesn’t need to know about the next one.'),
  L('s3.c.4a', 'It’s harder now.'),
  L('s3.c.4b', 'The wind is louder. Your arms are tired.'),
  L('s3.c.5', 'And still — you’re still walking.'),

  // Stage 3 Part D lead-in (before the per-word line)
  L('s3.d.intro1', 'Here’s what’s true, even now, even tired, even carrying what you’re carrying:'),
  L('s3.d.intro2', 'You get to decide who you are in this exact moment. Not who you were an hour ago. Not who you’ll have to be tomorrow. Just now.'),
);

// ---- Stage 3: the effect (Part D lead-in, E, F, G) ----
// Part D: the script gives Kindness in full; the appendix variants start at "...you choose X", so they
// reuse the same opening clause "And right now — despite the wind, despite the weight —".
const D_OPEN = 'And right now — despite the wind, despite the weight — ';

LINES.push(
  L('s3.d.kindness', D_OPEN + 'you choose kindness. Not because it’s easy. Because you’re choosing it anyway.'),
  // Acceptance replaced Strength (written for this copy, from acceptance and commitment therapy's "making room":
  // willingness to let what is here be here, without approving of it or fighting it).
  L('s3.d.acceptance', D_OPEN + 'you choose acceptance. Not giving up, and not pretending it’s easy — just letting what’s here be here, and walking on with it.'),
  L('s3.d.courage', D_OPEN + 'you choose courage. Not the absence of the wind — just deciding to walk into it anyway.'),
  L('s3.d.calm', D_OPEN + 'you choose calm. Not because everything’s resolved — because you’re allowed to rest before it is.'),
  L('s3.d.open', 'The path opens.'),

  L('s3.e.open', 'Open your eyes when you’re ready.'),
  L('s3.e.raise', 'Raise your hands. Let’s see what happens.'),
  // Acceptance's own gesture: arms low and open, palms forward, on a breath out (making room, not reaching)
  L('s3.e.raise.acceptance', 'Let your arms hang low, and open them out to your sides, palms facing forward. Breathe out as they open. Let’s see what happens.'),

  L('s3.f.kindness',
    'Something’s happening at your hands.', 900,
    'Small points of light are gathering — soft, warm, the color of the last hour of daylight.', 900,
    'The wider you open your arms, the more they spread. Watch — where they land, something grows. Small flowers, opening. Around your hands. Around you.', 900,
    'This is what kindness looks like when it has somewhere to go. It doesn’t erase what you carried to get here. It just grows around it, and through it.', 2200,
    'Stay here a second. This is yours.'),
  L('s3.f.acceptance',
    'The wind is still blowing, but it no longer pushes against you. It passes through your open hands, and on. The wider you open your arms, the more room there is — for the wind, for the weight, for whatever else came with you. None of it has to leave before you can stand here. This is what acceptance looks like. Not liking it. Not fighting it. Just making room.'),
  L('s3.f.courage',
    'The air around your hands starts to hold steady, even as the wind keeps moving past you — a small pocket of calm you’re generating yourself. The wider you open your arms, the more ground around you goes quiet. This is what courage looks like: not a fearless place, just a held one, and you’re the one holding it.'),
  L('s3.f.calm',
    'The wind around you slows first, then the water sound, then even your own heartbeat feels less urgent. The wider you open your arms, the further out the stillness spreads — like you’re the center of it, not the target of it. This is what calm looks like when it isn’t forced. It just spreads, because you stopped fighting it.'),

  L('s3.g.1', 'Let your hands come down, slowly, whenever you’re ready.'),
  L('s3.g.1.acceptance', 'Let your arms come back to your sides, slowly, whenever you’re ready.'),
  // Kindness keeps the original flowers line. The other words, and every closing line, were written to fit
  // the word (no flowers outside Kindness, and no mention of the door).
  L('s3.g.2.kindness', 'The flowers don’t need you to hold your arms up to keep existing. They’re already planted.'),
  L('s3.g.2.acceptance', 'You don’t have to keep your arms open for the room to stay. It’s already made, and it’s already yours.'),
  L('s3.g.2.courage', 'You don’t have to keep your arms open to hold the calm you made. It’s already yours, and it moves with you.'),
  L('s3.g.2.calm', 'The stillness doesn’t need your arms held wide to stay. It has already settled, and it’s already yours.'),
  L('s3.g.3.kindness', 'When you walk out of here and back into your day, the kindness goes with you. It doesn’t need anything from you to stay.'),
  L('s3.g.3.acceptance', 'When you walk out of here and back into your day, this room goes with you. Whatever arrives, there will be space for it.'),
  L('s3.g.3.courage', 'When you walk out of here and back into your day, this held place goes with you. You can find it again whenever you need it.'),
  L('s3.g.3.calm', 'When you walk out of here and back into your day, the stillness goes with you. It will still be there when you need it.'),
);

// ---- Stage 3, Part F2: Taking It In (after Part F's last line) ----
LINES.push(
  // Beat 1: pinch
  L('s3.f2.a', 'Now, gently, bring the tip of your thumb to the tip of your first finger. On both hands.'),
  L('s3.f2.word.kindness', 'Notice the small lights drifting toward your fingertips.'),
  L('s3.f2.word.acceptance', 'Notice the open space around you drawing in, gathering at your fingertips.'),
  L('s3.f2.word.courage', 'Notice the stillness around you drawing in, gathering at your fingertips.'),
  L('s3.f2.word.calm', 'Notice the quiet around you drawing in, gathering at your fingertips.'),
  L('s3.f2.b', 'You don’t have to reach for it. It already knows where you are.', 1800, 'Hold it there, at your fingertips. Small. Yours.'),
  L('s3.f2.hint1', 'Thumb to first finger. There’s no wrong way to do it.'),
  L('s3.f2.timeout1', 'That’s alright. It’s gathering anyway.'),
  // Beat 2: chest
  L('s3.f2.chest', 'Now bring your fingertips to the center of your chest.'),
  L('s3.f2.hint2', 'Just the fingertips, resting at the center of your chest.'),
  L('s3.f2.timeout2', 'That’s alright. It finds its way in.'),
  // Beat 3: let it in
  L('s3.f2.letin', 'Let it in.', 2200, 'It was never only around you. It was always this: something you carry, not something you visit.'),
  // Part G addition (between the per-word line and the closing line)
  L('s3.g.look', 'And look: what went in, stayed.'),
);

// ---- Stage 4: conclusion ----
LINES.push(
  L('s4.a',
    'Whatever you noticed today — the thought you watched without chasing it, the thing you chose to carry it anyway and keep walking — you don’t have to hold onto the feeling to keep what you learned from it.', 900,
    'It’s already yours. It doesn’t expire when the session ends.'),
  L('s4.b', 'One more breath.', 'In...'),
  L('s4.c', '...and out.'),
  L('s4.e', 'You don’t need to see it to have it.'),
  L('s4.d', 'That’s it for today.'),
);

export const LINE_MAP = new Map(LINES.map((l) => [l.id, l]));

export function lineText(id: string): string {
  const l = LINE_MAP.get(id);
  if (!l) throw new Error(`Unknown line: ${id}`);
  return l.parts.filter((p): p is string => typeof p === 'string').join(' ');
}
