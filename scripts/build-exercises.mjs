// Regenerates src/data/exercises.json from a pinned free-exercise-db commit
// (Unlicense) plus the hand-written src/data/gaps.json.
// Run with: node scripts/build-exercises.mjs [local copy of the source file]

import { readFile, writeFile } from 'node:fs/promises';

const COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
const SOURCE_URL = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${COMMIT}/dist/exercises.json`;
const GAPS_PATH = new URL('../src/data/gaps.json', import.meta.url);
const OUTPUT_PATH = new URL('../src/data/exercises.json', import.meta.url);

const MUSCLES = {
  abdominals: 'abs',
  abductors: 'abductors',
  adductors: 'adductor',
  biceps: 'biceps',
  calves: 'calves',
  chest: 'chest',
  forearms: 'forearm',
  glutes: 'gluteal',
  hamstrings: 'hamstring',
  lats: 'upper-back',
  'middle back': 'upper-back',
  'lower back': 'lower-back',
  neck: 'neck',
  quadriceps: 'quadriceps',
  traps: 'trapezius',
  triceps: 'triceps',
};

const GROUPS = {
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

const EQUIPMENT = {
  'body only': 'bodyweight',
  barbell: 'barbell',
  'e-z curl bar': 'barbell',
  dumbbell: 'dumbbell',
  machine: 'machine',
  cable: 'cable',
  kettlebells: 'kettlebell',
};

// Search tie-breaks follow array order, so the rows people log most come first.
const CATEGORY_ORDER = [
  'strength',
  'powerlifting',
  'olympic weightlifting',
  'strongman',
  'plyometrics',
  'stretching',
];

// Loaded by the lifter's own body whatever the source lists, so the model must add bodyweight.
const BODYWEIGHT_NAME =
  /pull[- ]?ups?\b|chin[- ]?ups?\b|\bchins?\b|\bdips?\b|push[- ]?ups?\b|muscle up|inverted row|suspended|\bbodyweight\b|rope climb|london bridges|back extensions|glute.?ham raise|parallel bars/i;
const NOT_BODYWEIGHT_NAME = /machine|dip squat|to chin/i;

const REAR_DELT_NAME = /rear|reverse\b.*\bfl[yi]|\bback fl[yi]|face pull/i;
const FRONT_DELT_NAME = /press|\bfront\b.*\braise/i;

function deltoids(name) {
  if (REAR_DELT_NAME.test(name)) return ['back-deltoids'];
  if (FRONT_DELT_NAME.test(name)) return ['front-deltoids'];
  return ['front-deltoids', 'back-deltoids'];
}

function mapMuscles(sourceMuscles, name) {
  const mapped = sourceMuscles.flatMap((muscle) => {
    if (muscle === 'shoulders') return deltoids(name);
    if (!MUSCLES[muscle]) throw new Error(`Unmapped muscle "${muscle}" on ${name}`);
    return [MUSCLES[muscle]];
  });
  return [...new Set(mapped)];
}

function mapEquipment(row) {
  const isBodyweight =
    row.category !== 'stretching' &&
    BODYWEIGHT_NAME.test(row.name) &&
    !NOT_BODYWEIGHT_NAME.test(row.name);
  return isBodyweight ? 'bodyweight' : (EQUIPMENT[row.equipment] ?? 'other');
}

function toRow(row) {
  const primaryMuscles = mapMuscles(row.primaryMuscles, row.name);
  const secondaryMuscles = mapMuscles(row.secondaryMuscles, row.name).filter(
    (muscle) => !primaryMuscles.includes(muscle),
  );
  return {
    id: row.id,
    name: row.name,
    group: GROUPS[primaryMuscles[0]],
    primaryMuscles,
    secondaryMuscles,
    equipment: mapEquipment(row),
    // The one field beyond ExerciseDef: a prefix match on a stretch would otherwise
    // outrank a strength row, and array order alone cannot prevent that.
    ...(row.category === 'stretching' && { stretching: true }),
  };
}

async function readSource(localPath) {
  if (localPath) return JSON.parse(await readFile(localPath, 'utf8'));
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`${SOURCE_URL}: HTTP ${response.status}`);
  return response.json();
}

const source = await readSource(process.argv[2]);
const gaps = JSON.parse(await readFile(GAPS_PATH, 'utf8'));

const kept = source
  .filter((row) => row.category !== 'cardio')
  .map((row, index) => {
    const rank = CATEGORY_ORDER.indexOf(row.category);
    if (rank < 0) throw new Error(`Unknown category "${row.category}" on ${row.name}`);
    return { row, rank, index };
  })
  .sort((a, b) => a.rank - b.rank || a.index - b.index)
  .map(({ row }) => toRow(row));

const rows = [...gaps, ...kept];

const ids = new Set(rows.map((row) => row.id));
if (ids.size !== rows.length) throw new Error('Duplicate exercise ids');

// One row per line keeps regeneration diffs readable.
const json = `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`;
await writeFile(OUTPUT_PATH, json);
console.log(`Wrote ${rows.length} rows (${gaps.length} gaps), ${json.length} bytes`);
