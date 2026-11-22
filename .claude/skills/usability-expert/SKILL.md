---
name: usability-expert
description: Usability and UX evaluation expertise grounded in Herbert Simon's "The Sciences of the Artificial" (3rd ed.) and Jakob Nielsen's 10 usability heuristics. Use for heuristic evaluations, usability critiques of websites/apps, personas, environments and scenarios, severity ratings, redesign recommendations, or any HCI/UX coursework in this project.
---

# Usability expert: Simon + Nielsen

Use this lens for every usability task in this project. Simon explains *why* interfaces fail: people have bounded rationality, small short-term memory and scarce attention. Nielsen's heuristics turn that into a checklist you can test against. Cite the principle behind each finding.

## Part 1: Simon's model of the user and the artifact

**1. An interface is the meeting point between an inner and an outer environment (ch. 1).**
An artifact succeeds when its inner environment (the system's structure) fits its outer environment (the users, their tasks and their context) for a goal.
- Always state the goal, the user and the context before judging a design.
- A good design behaves like a ship's chronometer: it keeps working the same way however the context varies (phone or laptop, on or off campus, interrupted or not).
- Where the design falls short, its internal limits "show through". Users then see the system's structure (database names, vendor tools, URL jumps to other sites) instead of their task.

**2. The ant on the beach (ch. 3).**
Behaviour looks complex because the environment is complex, not because the person is.
- When users wander, backtrack or give up, look for the cause in the interface's landscape, not in the user.
- Walk the actual path step by step and record every detour.

**3. Bounded rationality and satisficing (ch. 2, 5).**
- Users don't optimise. They take the first option that looks good enough, then stop.
- Aspiration levels fall when the search drags on.
- So the first plausible-looking control gets clicked. If two controls look alike (for example two search boxes), many users pick the wrong one and never compare the two.
- Design so that the first good-enough option is the right one.

**4. Memory parameters (ch. 3–4). Use these numbers.**
- Short-term memory holds about **7 chunks**, but only **about 2** survive an interruption (a pop-up, a page load, a new tab, a chatbot). Never make users carry information across steps.
- Storing one new chunk in long-term memory takes about **8 seconds**. Novices can't learn an interface while using it under time pressure.
- A **chunk** is a familiar unit. Familiar words, standard icons and conventional layouts count as one chunk each; novel labels and jargon cost several.
- Grouping items into **3–4 element chunks** roughly halves learning time. Group menu items and form fields to match.
- Information is easier to use when it's laid out the way the question will be asked. Locating something in a layout is easy when the layout supports that kind of question.

**5. Expertise is recognition (ch. 4).**
- What looks like an expert's intuition is recognition of stored patterns (masters hold about 50,000 chunks, built over about 10 years).
- **Novices search; experts recognise.** Design for recognition: visible options, consistent placement, standard patterns.
- Shortcuts (Ctrl+K, keyboard navigation) are the expert's channel. Keep them, and make them discoverable without making novices pay for them.
- People learn best from worked examples. Help and onboarding should show example queries and tasks, not just describe them.

**6. Attention is the scarce resource (ch. 6).** A rich supply of information uses up attention.
- The design problem isn't giving people more information; it's filtering, so that what matters reaches them.
- More content, more carousels and more links make an interface worse when attention is the limiting resource.
- Find the **limiting resource** before redesigning (in Simon's State Department example, the bottleneck was the officers reading the messages, not the printers).

**7. Means-ends analysis (ch. 5).**
- Users compare where they are with where they want to be, then pick the control that seems to close that gap.
- Labels and links must clearly advertise which gap they close (call this "information scent").
- Side effects break this model: if an action opens a new tab, sends users to another site, or needs a login first, the user's plan fails.

**8. Representation makes the solution obvious (ch. 5).**
- Number Scrabble becomes trivial once you see it is tic-tac-toe on a magic square.
- A good interface re-presents the user's problem so the answer is visible.
- Ask: is this a representation of the user's task, or of the organisation's internals?

**9. Hierarchy and near-decomposability (ch. 8).**
- **Hora and Tempus:** work built from stable sub-assemblies survives interruptions; flat 1,000-part work doesn't.
  - Break long flows into steps that save themselves.
  - Keep state across tab switches and logins.
  - Let users resume where they left off.
- Good information architecture is nearly decomposable: strong links inside each group, weak links between groups, a moderate span at each level.
- Menus of 4–8 groups of 3–8 items beat both flat lists and deep trees.
- People understand complex things as outlines: show the outline first, then the detail (progressive disclosure).
- The **empty world hypothesis:** most things barely interact with most other things. Leave out what's absent instead of listing everything.

**10. Feedback over prediction (ch. 2, 6).**
- Adaptive systems survive through feedback and buffers, not forecasts.
- An interface should report the actual state promptly and correct course, rather than guess what users want (auto-advancing content, predictive pop-ups).

**11. Designing without final goals; who is the client? (ch. 6)**
- Prefer reversible, flexible choices, and keep options open: undo, back, drafts, "remind me later".
- Name the client: the user, the institution, the vendor. Note conflicts (for example, a library promoting events vs a student who needs a PDF).
- Users aren't passive. They adapt and work around a design, so plan for that.

## Part 2: Nielsen's 10 usability heuristics

For each heuristic: what to check, then the Simon rationale.

1. **Visibility of system status.** Timely feedback on what happened, where you are, what's loading, and what's selected or active.
   *Simon:* feedback control; users can't plan means-ends steps without knowing the current state.
2. **Match between system and the real world.** The user's words, concepts and order, not internal jargon or vendor names.
   *Simon:* familiar items are single chunks; representation should mirror the task.
3. **User control and freedom.** Clear exits, undo and redo, the ability to pause or stop moving content, and the ability to dismiss overlays.
   *Simon:* reversibility; designing without final goals.
4. **Consistency and standards.** Internal consistency (same thing, same look, same place) and external consistency (platform conventions, Jakob's Law).
   *Simon:* conventions are pre-stored chunks; inconsistency forces costly re-learning (about 8 s per chunk).
5. **Error prevention.** Constraints, good defaults, confirmations for risky actions, prevention of slips (look-alike controls) and of mistakes (wrong mental model).
   *Simon:* satisficers act on the first plausible option.
6. **Recognition rather than recall.** Options, recent items, suggestions and context kept visible; nothing users must remember between screens.
   *Simon:* only about 2 chunks survive an interruption.
7. **Flexibility and efficiency of use.** Accelerators for experts (shortcuts, filters, saved searches) that are invisible to novices; personalisation.
   *Simon:* experts recognise, novices search.
8. **Aesthetic and minimalist design.** Every extra unit of information competes with the relevant ones.
   *Simon:* attention is the scarce resource; filter, don't distribute.
9. **Help users recognise, diagnose and recover from errors.** Plain-language messages that state the problem precisely and suggest a fix.
   *Simon:* feedback plus a path back to the goal.
10. **Help and documentation.** Searchable, task-focused, concrete steps, worked examples, available in context.
    *Simon:* learning from examples is most effective.

**Mapping to the 13-principle list used in this course** (Norman, Preece et al. and Shneiderman):

| Course principle | Nielsen heuristic(s) |
|---|---|
| Visibility | 1 |
| Feedback | 1, 9 |
| Constraints | 5 |
| Mapping | 2 |
| Consistency | 4 |
| Affordance | 2, 4, 6 (signifiers) |
| Flexibility | 7 |
| Locus of control | 3 |
| Error handling | 5, 9 |
| Decrease STM load | 6 |
| Aesthetic and minimalist design | 8 |
| Shortcuts | 7 |
| Help and documentation | 10 |

## Part 3: Method

**Heuristic evaluation (Nielsen and Molich).**
- 3–5 evaluators working independently find about 75% of problems; one evaluator finds about 35%. Say how many evaluators took part (often just one).
- Do two passes: first to get the flow, then element by element against each heuristic.
- Cover the key tasks, not just the homepage: search, the main conversion, login/access, error states, mobile, and one or two inner pages.
- Record each finding with: location, heuristic(s), description, evidence (an annotated screenshot), severity, and recommendation.
- Record strengths as well as problems.

**Severity (0–4)** combines frequency, impact and persistence:
- 0: not a problem
- 1: cosmetic
- 2: minor
- 3: major
- 4: catastrophic, must fix before release

**Evidence rules.**
- Annotate screenshots with coloured boxes: red = major, orange = minor, green = good practice, blue = note.
- Check findings that depend on timing. Animated values look different mid-animation, so capture both states and say which is which.
- Separate what was observed on screen from what was found in the page source.
- Never claim a measured statistic you didn't measure. Label persona ratings and mood curves as illustrative.

**Personas, environments, scenarios.**
- Derive personas from findings: which user is hurt most by the top issues?
- Mark personas as fictional.
- Describe the environment in four dimensions: physical, technical, social, and time.
- Scenarios should be realistic, time-pressed and goal-directed. Walk each step against the live site and tag each step with its heuristic. End with design opportunities.

**Recommendations.** Tie each one to a heuristic and a Simon mechanism, make it concrete, and prioritise by severity × frequency.

## Part 4: Quick checklist of common failures

- The primary task is below the fold or behind a carousel (1, 8).
- Auto-advancing content can't be paused (3, 8; WCAG 2.2.2).
- Look-alike controls do different things (two search boxes) (4, 5).
- Users are sent to another site or a new tab with no warning (1, 3).
- Access walls appear with no advance notice (off campus, login) (5, 9).
- Truncated text has no way to see the full version (6).
- Dates have no year, or lists aren't sorted (2, 4).
- Floating widgets cover controls, especially on mobile (3).
- Counters and animations show false values mid-animation (1).
- There are no breadcrumbs or active-menu state (1).
- Shortcuts exist but can't be discovered (7).
- Text has low contrast or sits over busy images (8; WCAG 1.4.3).
