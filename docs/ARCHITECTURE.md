# Architecture

fitNotes is a single-user offline-first PWA: Vite, React 19, TypeScript, IndexedDB.
All derived values (predictions, graphs, muscle map) are pure functions of the
stored records, so an edit or delete recalculates everything by replaying them.

| Path | Owns | Depends on |
| --- | --- | --- |
| `src/domain/` | Shared types, colour rules, date helpers | nothing |
| `src/model/` | Strength model: the fitted trend, `predict`, `strengthHistory`, `oneRepMax`, real weights | domain |
| `src/data/` | Exercise bank, its written assumptions and search | domain |
| `src/balance/` | `BASE_LIFTS`, `RAISES`, row levels, `muscleBalance` | domain, data |
| `src/store/` | IndexedDB persistence and React bindings | domain |
| `src/backup/` | Private GitHub repo backup, merge, restore | domain, store |
| `src/app/` | Facades binding the pure modules to stored data | everything above |
| `src/ui/` | Screens and components | everything above |

## Module exports

```ts
// src/model/index.ts
interface ModelInput {
  equipment: Equipment; perHand: boolean; bodyweightShare: number
  entries: Entry[]; bodyweights: Bodyweight[]
  rackWeights: number[]                                           // logged on other exercises sharing the rack
}
interface StrengthPoint { date: ISODate; kg: number }
interface StrengthDot { entryId: string; date: ISODate; kg: number; colour: Colour }
interface StrengthHistory { lines: Record<Colour, StrengthPoint[]>; dots: StrengthDot[] }
predict(input: ModelInput, date: ISODate): Prediction | null      // real weights at the next session, as logged
predictRaw(input: ModelInput, date: ISODate): Prediction | null   // same, before snapping
strengthHistory(input: ModelInput, asOf: ISODate): StrengthHistory // the current fit, ending at asOf
oneRepMax(input: ModelInput, date: ISODate): number | null
lastColour(entries: Entry[]): Colour                              // 'yellow' with no entries
gridStep(equipment: Equipment): number                            // 4 kg for kettlebells, else 2.5

// src/data/index.ts
EXERCISES: ExerciseDef[]
searchExercises(query: string, exercises: ExerciseDef[], limit?: number): ExerciseDef[]

// src/balance/index.ts
interface LiftStrength { exerciseId: string; oneRepMaxKg: number }
muscleBalance(lifts: LiftStrength[], bodyweightKg: number): Record<Muscle, number | null>
muscleDetail(muscle: Muscle, lifts: LiftStrength[], bodyweightKg: number): MuscleDetail | null
rowLevels(row: ExerciseDef, bodyweightKg: number): number[]       // kg at each level, raise included
BASE_LIFTS: Record<BaseLift, Record<string, number[]>>            // bodyweight class to level kg
BASE_ROWS: Record<BaseLift, string>                               // the rows with measured levels
RAISES: Record<Group, number>                                     // the one editable table
balanceColour(score: number | null): string                       // CSS colour

// src/store/index.ts
interface AppData { entries: Entry[]; bodyweights: Bodyweight[]; customExercises: CustomExercise[]; notes: ExerciseNote[] }
useAppData(): AppData | null                                      // null until loaded
addEntry, updateEntry, deleteEntry, setBodyweight, deleteBodyweight, setNote

// src/backup/index.ts
startBackup(): void
stopBackup(): void
connectBackup(token: string): Promise<void>
useBackupStatus(): BackupStatus
```

`oneRepMax` and `LiftStrength.oneRepMaxKg` use logged terms: one hand for per-hand rows,
and share × bodyweight + added for bodyweight rows.

## Strength model

`src/model/fit.ts` turns each date's strongest set into one session: the log e1RM of its
load on the starting curve. The load is twice the weight for per-hand rows and share ×
bodyweight + added for bodyweight rows. Deleted entries never count.

The fit is `ln e1RM = level + K × session + offset[colour]`, weighted least squares with a
half-life of 6 sessions. K is learned from changes within each colour, so a change of
colour never reads as progress, and a ridge prior holds it at 0% until about 3 sessions
outweigh it. Given K, each colour's level is its own sessions' level shrunk towards the
shared one, so a colour starts on the curve and every untrained colour follows the trend.
A prediction is the fit at the next session, whatever the date; the lighter colours are
capped at the heavier ones so red ≥ yellow ≥ green.

`predict` snaps each weight to the nearest real one: the grid from zero or any weight
already logged, on this exercise or, for dumbbells, barbells and kettlebells, on another
(`rackWeights`, built in `src/app/queries.ts`). It never shows a weight that leaves no load.

## Exercise catalogue

`scripts/build-exercises.mjs` joins three inputs into `src/data/exercises.json`, the only
file the app reads:

- free-exercise-db at a pinned commit, filtered to lifts logged as kg × reps. Its
  `mechanic` tags each row compound or isolation.
- `src/data/gaps.json`: lifts the source lacks, mechanic included.
- `src/data/catalogue.json`: each exercise's base lift, ratio, confidence and reason; `perHand`
  for two-dumbbell and two-handle cable rows; `bodyweightShare` on every bodyweight row; a
  `mechanic` for the two rows the source leaves untagged; and corrections to wrong source data.

`scripts/validate-exercises.mjs` holds the checks, and the build writes nothing if one fails.

A base row's kg at each level is its base lift's measured value at the lifter's bodyweight,
times `RAISES[group]`. A derived row's median is its base lift's p50 times its `ratio` and the
raise; its other levels are that median times one shared set of multiples, the mean
level/p50 of the barbell base lifts for weighted rows and of Dip, Chin-Up and Pull-Up for
bodyweight rows. A muscle's level is the mean level of its lifts, each weighted by role
(primary 1, secondary 0.5) × confidence (high 1, medium 0.75, low 0.5) × type (compound 1,
isolation 0.5).

`customExercises` stays in the store and in `Snapshot` so version 1 backups still read, but
nothing writes to it. An entry with no exercise row is kept and backed up, and Home and the
map leave it out.
