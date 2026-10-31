# Architecture

fitNotes is a single-user offline-first PWA: Vite, React 19, TypeScript, IndexedDB.
All derived values (predictions, graphs, muscle map) are pure functions of the
stored records, so an edit or delete recalculates everything by replaying them.

| Path | Owns | Depends on |
| --- | --- | --- |
| `src/domain/` | Shared types, colour rules, date helpers | nothing |
| `src/model/` | Strength model: `predict`, `strengthHistory`, `oneRepMax`, loadable rounding | domain |
| `src/data/` | Exercise bank and search | domain |
| `src/balance/` | Strength standards table, `muscleBalance` | domain, data |
| `src/store/` | IndexedDB persistence and React bindings | domain |
| `src/backup/` | Private GitHub repo backup, merge, restore | domain, store |
| `src/app/` | Facades binding the pure modules to stored data | everything above |
| `src/ui/` | Screens and components | everything above |

## Module exports

```ts
// src/model/index.ts
interface ModelInput { equipment: Equipment; entries: Entry[]; bodyweights: Bodyweight[] }
interface StrengthPoint { date: ISODate; kg: number }
interface StrengthDot { entryId: string; date: ISODate; kg: number; colour: Colour }
interface StrengthHistory { lines: Record<Colour, StrengthPoint[]>; dots: StrengthDot[] }
predict(input: ModelInput, date: ISODate): Prediction | null      // loadable weights, as logged
predictRaw(input: ModelInput, date: ISODate): Prediction | null   // same, before rounding
strengthHistory(input: ModelInput, asOf: ISODate): StrengthHistory
oneRepMax(input: ModelInput, date: ISODate): number | null
lastColour(entries: Entry[]): Colour                              // 'yellow' with no entries

// src/data/index.ts
EXERCISES: ExerciseDef[]
searchExercises(query: string, exercises: ExerciseDef[], limit?: number): ExerciseDef[]

// src/balance/index.ts
interface LiftStrength { exerciseId: string; oneRepMaxKg: number }
muscleBalance(lifts: LiftStrength[], bodyweightKg: number): Record<Muscle, number | null>
muscleDetail(muscle: Muscle, lifts: LiftStrength[], bodyweightKg: number): MuscleDetail | null
isCounted(exerciseId: string): boolean
balanceColour(score: number | null): string                       // CSS colour

// src/store/index.ts
interface AppData { entries: Entry[]; bodyweights: Bodyweight[]; customExercises: CustomExercise[]; notes: ExerciseNote[] }
useAppData(): AppData | null                                      // null until loaded
addEntry, updateEntry, deleteEntry, setBodyweight, deleteBodyweight, saveCustomExercise, setNote

// src/backup/index.ts
startBackup(): void
connectBackup(token: string): Promise<void>
useBackupStatus(): BackupStatus
```

`oneRepMax` and `LiftStrength.oneRepMaxKg` use logged terms: per hand for dumbbells,
and total load (bodyweight plus added) for bodyweight exercises.
