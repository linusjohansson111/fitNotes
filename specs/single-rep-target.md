# Single 8-rep target

## Goal
Every set aims at 8 reps, so I chase one number instead of three. Home shows what I lifted last time. Opening a lift fills in that weight and shows the suggested weight for today beneath it. Red, yellow and green show only whether a set landed below, on or above 8 reps.

## Out of scope
A configurable target; any per-rep correction to the model; a tappable suggestion; reps on Home; changes to the muscle map's levels, the next workout, the catalogue or the backup format.

## Touches
- `src/domain/colour.ts`: `TARGET_REPS` becomes the number 8, and `colourForReps` stays. `src/domain/types.ts`: `Prediction` becomes a number.
- `src/model/fit.ts` and `src/model/index.ts`: `predict`, `predictRaw` and `oneRepMax` work from one trend. `StrengthHistory` holds one line plus dots. `src/model/simulator.ts` and `ac17.test.ts` follow.
- `src/app/queries.ts`: `LoggedExercise` carries the last live weight in place of `next`.
- `src/ui/HomeScreen.tsx`, `LogScreen.tsx`, `logForm.ts`, `ExerciseScreen.tsx`, `StrengthGraph.tsx`, `StrengthGraphMath.ts`.
- `SPEC.md` (Goal, Decisions and acceptance criteria 5–9, 13, 17 and 32), `docs/ARCHITECTURE.md` and `e2e/smoke.mjs` describe one target.

## Decisions
- **One target, 8 reps, always.** One number to chase is simpler to train and to read. Colour is cosmetic and keeps the bands 1–6 red, 7–9 yellow, 10+ green.
- **The starting curve turns every set, at any rep count, into 8-rep strength.** The per-colour offsets and the red ≥ yellow ≥ green cap are removed, and K is learned from all sessions. Colour no longer means anything, so there is nothing to learn per colour. A set far from 8 reps carries the curve's error, and the owner accepts this. Suggestions shift for the exercises logged outside 7–9 reps (13 of 31 live entries), and the owner accepts that without review.
- **Everything else in the model stays:** the 6-session half-life, the K prior, sessions rather than calendar time, snapping to real weights, the strongest set per date, bodyweight and per-hand handling.
- **Home shows the last weight lifted, weight only, in that entry's colour.** The owner wants to see what they lifted last time, and the suggestion is on the log form.
- **The log form starts on the last weight, 8 reps and today. "Suggested 82.5 kg" sits under the weight and cannot be tapped.** It shows no "× 8", because 8 is implied. Changing reps only recolours the form, and the weight never follows reps or date.
- **The exercise screen shows one suggested weight with no rep count.** The Log button keeps the last entry's colour. The graph shows one yellow line, and each dot is converted to 8 reps and coloured by its own reps.
- **Stored data is unchanged.** Entries already hold weight and reps, so `Snapshot` stays version 1 and no exercise id changes.
- **AC17's simulator targets 8 reps, and the reps reached vary around it.** Rotating colours no longer exists.
- **Released as v1.4.0 once the checks pass.**

## Acceptance criteria
1. When 80 kg × 8 is an exercise's first entry, the system shall suggest 80 kg.
2. When 100 kg × 5 is an exercise's first entry, the system shall suggest the 8-rep weight of that set's e1RM on the starting curve before rounding, with no per-colour correction.
3. When an exercise is logged, `oneRepMax` shall equal the e1RM of its unrounded 8-rep suggestion, in logged terms.
4. When home opens, each row shall show the last live entry's weight, with no reps, in that entry's colour, and shall label a negative weight "assistance".
5. When the log form opens for a logged exercise, the system shall start on the last live entry's weight, 8 reps and today, and show "Suggested <kg> kg" for the selected date under the weight, with no rep count and no tap action.
6. When the log form opens for a new exercise, the system shall start yellow, on 8 reps, with a blank weight and no suggestion line. When it opens on an existing entry, it shall show that entry and no suggestion line.
7. When the reps cross 6/7 or 9/10 in either direction, the system shall switch the form's colour immediately and leave the weight unchanged.
8. When an exercise is open, the system shall show one suggested weight with no rep count, a Log button in the last entry's colour, and one yellow line ending today at the suggestion. Entries shall show as dots at their 8-rep equivalent, coloured by their own reps, along with 3M/1Y/All ranges, a last-session line, one note and an editable history.
9. When a simulated 12-month log that targets 8 reps, with the reps reached varying around it, is replayed, the system shall have lower mean prediction error over the last 20 sessions than over the first 5.
10. When Pushups and Pullups are each first logged at 0 × 20, the system shall suggest less added weight on Pushups.
11. When a version 1 backup from v1.3.0 is restored, the system shall read it and restore every entry.
12. When `.claude/check` and `npm run e2e` run, every other criterion in `SPEC.md` shall still pass.

## Done when
`npm run e2e` passes a flow that logs 80 kg × 8 and then checks four things. Home shows 80. The log form starts on 80 with "Suggested 80 kg". Typing 6 reps turns the form red and leaves 80. The exercise screen shows one suggested weight and one line. After that, v1.4.0 is released as described in `CLAUDE.md`.
