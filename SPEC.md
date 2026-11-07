# SPEC: fitNotes

## Goal
On my iPhone, I log the strongest set of an exercise in seconds and see what to lift next session, from a trend fitted to my own sessions rather than fixed rules. The muscle map measures each muscle's strength as fairly as it can: no lift makes a muscle easier to score strong than another, and compound lifts count most. The log screen leaves no doubt about which weight to enter.

## Out of scope
Cardio; stretching, plyometrics, strongman, dynamic lifts driven by momentum, timed holds and anything without a real kg figure; custom exercises; sets or volume; workout plans or exercise suggestions; native or App Store builds; Watch, widgets or Apple Health; other users; history import; pounds; showing accuracy, ranges or uncertainty in the app; decay for time away; per-muscle load shares; a list of gym weights to maintain.

## Touches
The app exists at v1.1.0, with the body map's abductors on the outer hip. This change is AC8, AC10, AC11, AC17, AC18 and AC26-AC35; every other criterion already passes and must keep passing.
- `ExerciseDef` gains `mechanic: 'compound' | 'isolation'`, `perHand: boolean`, and `bodyweightShare: number` on bodyweight rows. `src/data/catalogue.json`, `src/data/gaps.json`, `scripts/build-exercises.mjs` and `scripts/validate-exercises.mjs` supply and check them.
- `src/model/`: `predict`, `predictRaw`, `strengthHistory` and `oneRepMax` keep their signatures but read the fitted trend; the rules in `replay.ts` go. `ModelInput` gains `perHand`, `bodyweightShare` and `rackWeights` (weights logged on other exercises that share the rack). `roundToLoadable` snaps to real weights.
- `src/balance/`: `muscleBalance` and `muscleDetail` use the new levels and weights. `src/app/queries.ts` passes the new inputs.
- `src/ui/LogScreen.tsx`, `src/ui/logForm.ts`: the weight label comes from `perHand`; bodyweight rows show bodyweight read-only, and the sign button (`flipSign`) goes.
- `docs/ARCHITECTURE.md`, `README.md` and `e2e/smoke.mjs` follow. The table at https://claude.ai/artifact/6Gf52dHv4QnwWDMvJaMgg7 is republished with every changed row.

## Decisions
- **Home Screen web app, offline first, automatic cloud backup.** It builds on this Linux machine with no Apple fee, and [Apple's storage policy](https://webkit.org/?p=14403) gives no clear guarantee that local data lasts.
- **Bank from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) plus filled gaps; body map adapted from [react-body-highlighter](https://github.com/giavinh79/react-body-highlighter), with the abductors on the outer hip.** Both are open.
- **The bank holds only controlled lifts logged as kg × reps, about 535 rows, one record each, and no custom exercises.** A row can't disagree with itself, and search tolerates typos. Existing ids don't change, and `Snapshot` stays version 1 with `customExercises`, because live backups depend on both.
- **Black UI with red, yellow or green accents; groups are Chest, Back, Shoulders, Arms, Legs, Core.** Colour and graphs lead, numbers support.
- **Every entry is the workout's strongest set at maximum effort.** On a shared date the stronger set feeds the model. Deleted entries never do, because many were tests.
- **Red = 5, yellow = 8, green = 11; reps 1-6 red, 7-9 yellow, 10+ green.** An exercise keeps its last entry's colour.
- **Predictions come from a trend fitted to the data, not from rules.** Each session's e1RM is one datapoint. Log e1RM is fitted against session number, with recent sessions weighted by a half-life of about 6 sessions. Points above and below the trend count alike, so a run of weak sessions flattens and then lowers it, and an outlier only adjusts the fit. A user who trains one colour and always loads the suggestion stalls about one plate behind, because whole reps and 2.5 kg steps hide gains smaller than one rep; growth must show in the logs first, so the owner accepts this. Miss streaks, the records rule, rebound and carry limits go. A low day pulls the next suggestion down more than before, which the owner accepts.
- **K, the % change per session, starts at 0% and data replaces it within about 3 sessions.** Growth must show in the logs first.
- **Sessions, not calendar time.** The next suggestion is the fitted value at the next session, the same after a day or two months away. A break says nothing until a session is logged.
- **One trend per exercise, plus a learned offset per colour that starts on [`1RM = w(1 + (r-1)^0.85 / (-2.55 + 4.58 ln w))`](https://arxiv.org/pdf/2603.17495v1.pdf).** Each colour has too little data for its own trend, and a set still moves its own colour most. K is learned within each colour, so a change of colour never reads as progress. Every colour takes the same per-session step, and a colour last trained long ago is carried forward on the current K, so in block training a set can move it more than its own colour.
- **The graph's lines are the current fitted curve per colour, ending today at the next suggestion.** The slope you see is K.
- **Suggestions snap to the nearest real weight.** A suggestion snaps to a grid from zero (kettlebells 4 kg, all else 2.5 kg) or to any weight already logged. Dumbbells, barbells and kettlebells share logged weights across exercises; machines, cables, other and bodyweight use that exercise's. The stepper moves by the grid step. A 33.5 kg dumbbell does not exist.
- **Two-dumbbell and two-handle cable rows log per hand and say "Per hand".** The same flag decides when the curve doubles the load and the map halves it. One-dumbbell rows log the one dumbbell.
- **Bodyweight rows show bodyweight read-only from Settings and one signed input: added weight, negative for assistance.** The steppers cross zero and the keyboard has a minus. With no bodyweight set, the form asks once and saves it to Settings.
- **Each bodyweight row has a share of bodyweight moved; load is share × bodyweight + added, in predictions and on the map.** Today 20 push-ups suggest +35 kg for 5 reps. Dip, Chin-Up, Pull-Up and other full-body rows are 1.
- **The muscle map compares levels, not kg, against your own average.** Five levels at current bodyweight come from men's [FitnessVolt gym percentiles](https://fitnessvolt.com/strength-standards/strength-data/) at p10, p25, p50, p75 and p95, CC BY 4.0. The 11 base lifts are Back Squat, Bench Press, Deadlift, Front Squat, Sumo Deadlift, Incline Bench Press, Overhead Press, Dip, Chin-Up, Pull-Up and Pendlay Row.
- **No lift makes a muscle easier to score strong.** Base lifts keep their measured levels. A derived row's median is its base lift's p50 × ratio × raise. Its other levels are that median times one shared set of multiples: the mean level/p50 multiples of the barbell base lifts for weighted rows, and of Dip, Chin-Up and Pull-Up for bodyweight rows. A ratio to a total-load bodyweight lift squeezed curls into a ×1.5 range against ×2 for barbell lifts.
- **Every other exercise has one ratio to its base lift, with a reason and a confidence.** No open per-exercise table exists. One editable table raises Shoulders by 1.15, Back by 1.1 and Arms by 1.1.
- **A secondary muscle is one the lift loads substantially.** Squats don't rate calves, and the adductor machine doesn't rate glutes.
- **A lift's weight on a muscle is role × confidence × type: primary 1, secondary 0.5; high 1, medium 0.75, low 0.5; compound 1, isolation 0.5.** Compounds predict strength better. `mechanic` comes from the source, and the rows the source leaves untagged are tagged by hand.
- **No Strength Level data.** [Its policy](https://strengthlevel.com/data-licensing) forbids deriving ratios from its standards, so its values may not be used or consulted. The old tables stay in git history by the owner's choice.
- **One release, from a branch, after the owner alone approves the republished table.** The release stops if a live backup entry has no row, and nothing is force-pushed.
- **No accuracy target.** Prediction error is checked outside the app and should fall as logs grow.

## Acceptance criteria
1. When the app is opened offline from the Home Screen, the system shall show home and save new entries.
2. When the phone reconnects, the system shall back up entries without user action; when freshly installed, it shall restore all records.
3. When the user searches, the system shall list matching exercises from about 535 with front and back maps, primary muscles brighter than secondary, shall rank Incline Dumbbell Press first for "Incline Dumbell Press", and shall offer no way to add an exercise.
4. When home opens, the system shall list only logged exercises by group, most recent first, each with its colour and next weight.
5. When the logging form opens, the system shall start on predicted weight, target reps and today, with no sets field. A new exercise starts yellow, 8 reps, blank weight.
6. When reps cross 6/7 or 9/10 in either direction, the system shall switch colour immediately, and change the weight only if the user hasn't edited it.
7. When 80 kg x 8 is an exercise's first entry, the system shall show all three colours with red > yellow > green and no uncertainty state: 88 +/- 1 kg x 5 and 73.5 +/- 1 kg x 11 before rounding.
8. When an entry is saved, the system shall update all three predictions and, in e1RM terms before the shared per-session step, move its own colour at least as much as the others when it is a new colour or every colour has data; while only one colour has data, all three move alike.
9. When the latest entry has 4 reps, the system shall still show red as the weight for 5 reps.
10. When an entry lands a given percentage above or below the trend, the system shall move the next prediction by equal and opposite percentages.
11. When 60 days pass after an entry with nothing logged, the system shall predict the same weights as the day after it.
12. When a bodyweight exercise's target is out of reach, the system shall show a negative weight as assistance.
13. While an exercise is open, the system shall show three strength lines with the current colour bright, entries as dots, 3M/1Y/All ranges, a last-session line, one note and an editable history.
14. When an entry is edited or deleted, the system shall recalculate predictions, graph and muscle map.
15. When all logged lifts sit at one level, the system shall show every muscle with data as yellow at any level; a lagging muscle shall shift smoothly towards red, a stronger one towards green, muscles without data shall be grey, and tapping a muscle shall show its numbers.
16. When any exercise in search is logged, the system shall predict for it and count it on the muscle map for each of its muscles.
17. When a simulated 12-month log that trains more than one colour is replayed, the system shall have lower mean prediction error over the last 20 sessions than the first 5.
18. When `scripts/build-exercises.mjs` runs, the system shall fail if any row lacks an `ExerciseDef` field, names an unknown base lift, has a ratio that isn't positive, has a group that doesn't match its first primary muscle, or is a bodyweight row without a share in (0, 1].
19. When the catalogue is read, the system shall hold no stretching, plyometric, strongman, dynamic, band, ball or timed-hold row, none of the rows dropped in `docs/catalogue-fixes.md`, and shall hold `Wide-Grip_Lat_Pulldown`, `Barbell_Deadlift`, `Dumbbell_Bicep_Curl`, `Incline_Dumbbell_Press`, `Seated_Cable_Rows`, Trap Bar Deadlift, Front Plate Raise, Donkey Calf Raises, `Clean_Deadlift`, `Overhead_Squat` and `Weighted_Crunches`.
20. When `Dips_-_Chest_Version` or `Bench_Press_-_Powerlifting` is read, the system shall list chest as a primary muscle.
21. When `Incline_Dumbbell_Press` is the only logged exercise, the system shall show chest, front delts and triceps as yellow and every other muscle as grey.
22. When two logged lifts on one muscle differ only in confidence, the system shall let the higher-confidence lift move that muscle's level more.
23. When the map screen opens, the system shall show a "Powered by FitnessVolt" link to https://fitnessvolt.com/strength-standards/strength-data/.
24. When `src/` and `scripts/` are searched for Strength Level, the system shall have no match, and `src/balance/standards.ts` and `scripts/fetch-standards.mjs` shall not exist.
25. When an existing version 1 backup is restored, the system shall read it and restore every entry.
26. When six sessions in a row land 2% under the prediction on a log rising no faster than about 0.75% a session, the system shall predict lower than before them; when six land 2% over, higher. On a faster-rising log they flatten the trend first.
27. When an exercise's first two sessions have equal e1RM, the system shall predict that same e1RM next.
28. When one session lands far above the trend, the system shall raise the next prediction only part of the way to it.
29. When Incline Dumbbell Press holds 40 x 4 and 37.5 x 8, the system shall show only weights on the 2.5 kg grid or already logged with dumbbells, and never 39.5 or 33.5.
30. When the log form opens for `Incline_Dumbbell_Press` or `Cable_Rear_Delt_Fly`, the system shall label the weight "Per hand"; for `Bent-Arm_Dumbbell_Pullover` it shall not.
31. When a bodyweight exercise's form opens, the system shall show the Settings bodyweight read-only and one input that takes positive and negative added weight with no sign button; with no bodyweight set, it shall ask once and save it to Settings.
32. When Pushups and Pullups are each first logged at 0 x 20, the system shall suggest less added weight for 5 reps on Pushups.
33. When two derived weighted rows on different base lifts are logged at the same multiple of their own median 1RM, the system shall give both the same level.
34. When a compound and an isolation lift with the same role and confidence give one muscle different levels, the system shall place that muscle's level twice as close to the compound's.
35. When the catalogue is read, `Thigh_Adductor` shall list neither gluteal nor hamstring, and `Barbell_Squat` shall not list calves.

## Done when
The owner has approved the republished table. Then, on an iPhone with the app installed and in airplane mode: log Pullups and see bodyweight read-only above one signed input; log Cable Rear Delt Fly at 7.5 kg "Per hand"; open Incline Dumbbell Press and see only real dumbbell weights; tap biceps on the muscle map and see its numbers. Reconnect and confirm the backup holds every entry.
