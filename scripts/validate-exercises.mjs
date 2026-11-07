// The checks every generated exercise row must pass. Shared by build-exercises.mjs,
// which refuses to write a bad bank, and the tests.

export const GROUP_OF_MUSCLE = {
  chest: 'Chest',
  'upper-back': 'Back',
  'lower-back': 'Back',
  trapezius: 'Back',
  'front-deltoids': 'Shoulders',
  'back-deltoids': 'Shoulders',
  neck: 'Shoulders',
  biceps: 'Arms',
  triceps: 'Arms',
  forearm: 'Arms',
  quadriceps: 'Legs',
  hamstring: 'Legs',
  gluteal: 'Legs',
  calves: 'Legs',
  adductor: 'Legs',
  abductors: 'Legs',
  abs: 'Core',
  obliques: 'Core',
};

const FIELDS = [
  'id',
  'name',
  'group',
  'primaryMuscles',
  'secondaryMuscles',
  'equipment',
  'mechanic',
  'perHand',
  'baseLift',
  'ratio',
  'confidence',
  'reason',
];

const CONFIDENCE = ['high', 'medium', 'low'];
const MECHANIC = ['compound', 'isolation'];
const PER_HAND_EQUIPMENT = ['dumbbell', 'cable'];

function problemsWith(row, baseLifts) {
  const problems = FIELDS.filter((field) => row[field] === undefined || row[field] === '').map(
    (field) => `lacks ${field}`,
  );
  if (problems.length > 0) return problems;

  if (!baseLifts.includes(row.baseLift)) problems.push(`names unknown base lift "${row.baseLift}"`);
  if (!(row.ratio > 0)) problems.push(`has ratio ${row.ratio}, which is not positive`);
  if (!CONFIDENCE.includes(row.confidence)) problems.push(`has unknown confidence "${row.confidence}"`);
  if (row.group !== GROUP_OF_MUSCLE[row.primaryMuscles[0]]) {
    problems.push(`has group ${row.group}, but its first primary muscle is ${row.primaryMuscles[0]}`);
  }
  if (!MECHANIC.includes(row.mechanic)) problems.push(`has unknown mechanic "${row.mechanic}"`);
  if (typeof row.perHand !== 'boolean') problems.push(`has perHand ${row.perHand}, which is not true or false`);
  else if (row.perHand && !PER_HAND_EQUIPMENT.includes(row.equipment)) {
    problems.push(`is per hand, but ${row.equipment} is not a dumbbell or cable`);
  }
  if (row.equipment === 'bodyweight') {
    const share = row.bodyweightShare;
    if (!(typeof share === 'number' && share > 0 && share <= 1)) {
      problems.push(`is a bodyweight row with share ${share}, which is not in (0, 1]`);
    }
  } else if (row.bodyweightShare !== undefined) {
    problems.push(`has a bodyweight share, but is ${row.equipment}`);
  }
  return problems;
}

/** Throws, naming every problem at once, so one run shows the whole fix list. */
export function validateRows(rows, baseLifts) {
  const problems = rows.flatMap((row) =>
    problemsWith(row, baseLifts).map((problem) => `${row.id ?? row.name ?? 'A row'} ${problem}`),
  );
  if (problems.length > 0) throw new Error(`Bad exercise rows:\n${problems.join('\n')}`);
}
