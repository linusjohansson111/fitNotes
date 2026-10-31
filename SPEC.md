# SPEC: fitNotes

## Goal
On my iPhone, I log the strongest set of an exercise in seconds and immediately see what weight should hit my target reps next time. Colour-led graphs show my progress per exercise and which muscles lag behind the rest of my body. The app is a guide and a second memory: I make every training decision myself.

## Out of scope
Cardio; sets or volume; workout plans or exercise suggestions; native or App Store builds; Watch, widgets or Apple Health; other users; history import; pounds; showing accuracy, ranges or uncertainty in the app.

## Touches
Nothing existing: the repo is empty. New interfaces:
- `Entry {exerciseId, date, weightKg, reps}`: one strongest set. Dumbbells are per hand. Bodyweight exercises log added weight, negative for assistance.
- `Exercise {id, name, group, primaryMuscles, secondaryMuscles, equipment, colour, note}`
- `Bodyweight {date, kg}`: the only setting.
- `predict(exerciseId, date) -> {red, yellow, green}`: loadable weights for 5, 8 and 11 reps.
- `strengthHistory(exerciseId) -> series per colour`
- `muscleBalance(date) -> {muscle: score | null}`: -1 lagging, 0 in proportion, +1 ahead.
- `backup`: automatic sync to a private free-tier store, and restore on a fresh install.

## Decisions
- **Home Screen web app, offline first, automatic cloud backup.** It can be built on this Linux machine with no Apple fee, and [Apple's storage policy](https://webkit.org/?p=14403) gives no clear guarantee that local data lasts.
- **Bank from [free-exercise-db](https://github.com/yuhonas/free-exercise-db) plus filled gaps; body map from [react-body-highlighter](https://github.com/giavinh79/react-body-highlighter).** Both are open, and posed figures aren't openly available at good quality.
- **Black UI with red, yellow or green accents; groups are Chest, Back, Shoulders, Arms, Legs, Core.** Essentials only: colour and graphs lead, numbers support.
- **Every entry is the workout's strongest set at maximum effort.** This is the owner's rule and needs no effort input. If two entries share a date, the stronger feeds the model.
- **Red = 5, yellow = 8, green = 11; reps 1-6 red, 7-9 yellow, 10+ green.** Static targets leave weight as the only unknown. An exercise keeps its last entry's colour.
- **One strength value per colour, personalised per exercise, starting from [`1RM = w(1 + (r-1)^0.85 / (-2.55 + 4.58 ln w))`](https://arxiv.org/pdf/2603.17495v1.pdf).** It shows consistency rather than absolute accuracy, so logs should take over quickly.
- **A new entry moves its own colour most and the others partly; carry-over is learned from logs.** Gains mostly follow the reps trained ([Campos 2002](https://pubmed.ncbi.nlm.nih.gov/12436270/), [review](https://pmc.ncbi.nlm.nih.gov/articles/PMC7927075/)), and no study compares 5, 8 and 11 directly.
- **Progress follows a log-time curve in percentage terms.** Supported by [Steele and Fisher](https://pure.solent.ac.uk/en/publications/long-term-time-course-of-strength-adaptation-to-minimal-dose-resi/) and [Latella 2023](https://ro.ecu.edu.au/ecuworks2022-2026/3457).
- **Time away uses days since the exercise.** [Maximal strength holds for about 28 days and endurance drops sooner](https://www.strongerbyscience.com/detraining/), so green falls first. [Lost strength returns faster](https://research-collection.ethz.ch/handle/20.500.11850/399361) than it was first gained.
- **Records count fully; one low day barely moves the number, and a second in a row starts to.** Shortfalls are treated as outside factors.
- **Bodyweight exercises use bodyweight plus added weight.** The logged number alone isn't the real load.
- **Weights round to the nearest loadable step, learned from logged weights, with equipment defaults.** A number you can't load is no use.
- **The muscle map compares levels, not kg, against your own average.** Uses men's [Strength Level standards](https://strengthlevel.com/strength-standards/bench-press/kg) at current bodyweight, because ratios shift with level. One editable table raises shoulders, back and arms; this is judgement, as no published bodybuilder table was found. Only exercises in that table count.
- **No accuracy target.** Prediction error is checked outside the app and should fall as logs grow.

## Acceptance criteria
1. When the app is opened offline from the Home Screen, the system shall show home and save new entries.
2. When the phone reconnects, the system shall back up entries without user action; when freshly installed, it shall restore all records.
3. When the user searches, the system shall list matching exercises from 800+ with front and back maps, primary muscles brighter than secondary, and allow a custom exercise from a name and tapped muscles.
4. When home opens, the system shall list only logged exercises by group, most recent first, each with its colour and next weight.
5. When the logging form opens, the system shall start on predicted weight, target reps and today, with no sets field. A new exercise starts yellow, 8 reps, blank weight.
6. When reps cross 6/7 or 9/10 in either direction, the system shall switch colour immediately, and change the weight only if the user hasn't edited it.
7. When 80 kg x 8 is an exercise's first entry, the system shall show all three colours with red > yellow > green and no uncertainty state. The starting curve alone gives 88 +/- 1 kg x 5 and 73.5 +/- 1 kg x 11.
8. When an entry is saved, the system shall update all three predictions, with its own colour moving by the largest percentage.
9. When the latest entry has 4 reps, the system shall still show red as the weight for 5 reps.
10. When an entry misses the prediction by a given percentage, the system shall lower the next prediction less than an equal beat would raise it, and a second miss in a row shall lower it more than the first.
11. When 14 days have passed since an entry, the system shall lower red by at most 1%; at 60 days, both colours shall be lower than at 14 days, with green down by the larger percentage.
12. When a bodyweight exercise's target is out of reach, the system shall show a negative weight as assistance.
13. While an exercise is open, the system shall show three strength lines with the current colour bright, entries as dots, 3M/1Y/All ranges, a last-session line, one note and an editable history.
14. When an entry is edited or deleted, the system shall recalculate predictions, graph and muscle map.
15. When all counted lifts sit at one level, the system shall show every muscle with data as yellow at any level; a lagging muscle shall shift smoothly towards red, a stronger one towards green, muscles without data shall be grey, and tapping a muscle shall show its numbers.
16. When a custom exercise is logged, the system shall predict for it and leave the muscle map unchanged.
17. When a simulated 12-month log is replayed, the system shall have lower mean prediction error over the last 20 sessions than the first 5.

## Done when
On an iPhone with the app installed and in airplane mode, log a new exercise and see all three colours; log it again with reps in another colour and see the graph and muscle map update. Reconnect, delete and reinstall the app, and confirm every record is restored.
