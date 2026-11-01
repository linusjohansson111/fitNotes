// Regenerates src/data/exercises.json from a pinned free-exercise-db commit (Unlicense),
// the hand-written gap lifts in src/data/gaps.json, and src/data/catalogue.json, which
// holds each exercise's base lift, ratio, confidence, reason and source corrections.
// Run with: node scripts/build-exercises.mjs [local copy of the source file]

import { readFile, writeFile } from 'node:fs/promises';
import { GROUP_OF_MUSCLE, validateRows } from './validate-exercises.mjs';

const COMMIT = 'f00c92c7dcf1216a928a52c3706c7ce8e2f71ed5';
const SOURCE_URL = `https://raw.githubusercontent.com/yuhonas/free-exercise-db/${COMMIT}/dist/exercises.json`;
const GAPS_PATH = new URL('../src/data/gaps.json', import.meta.url);
const CATALOGUE_PATH = new URL('../src/data/catalogue.json', import.meta.url);
const BASE_LIFTS_PATH = new URL('../src/balance/baseLifts.json', import.meta.url);
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
const CATEGORY_ORDER = ['strength', 'powerlifting'];

// The bank holds only lifts logged as kg × reps. Every other category goes whole.
const DROPPED_EQUIPMENT = new Set(['bands', 'medicine ball', 'exercise ball', 'foam roll']);
const BAND_OR_BALL_NAME = /\bbands?\b|\bball\b/i;

// Rows the source files under strength that fall under an excluded kind.
const DROPPED_IDS = new Set([
  // Olympic lifts.
  'Clean_and_Press',
  'Power_Clean',
  'Smith_Machine_Hang_Power_Clean',
  'Snatch_Pull',
  'Squat_Jerk',
  // Strongman: a sled's load is dragged, not lifted.
  'Sled_Overhead_Backward_Walk',
  'Sled_Overhead_Triceps_Extension',
  'Sled_Reverse_Flye',
  'Sled_Row',
  // Plyometric.
  'Clock_Push-Up',
  'Freehand_Jump_Squat',
  'Lunge_Sprint',
  'Plyo_Kettlebell_Pushups',
  'Weighted_Jump_Squat',
  // Timed holds, and work with no kg figure at all.
  'Balance_Board',
  'Battling_Ropes',
  'Isometric_Neck_Exercise_-_Front_And_Back',
  'Isometric_Neck_Exercise_-_Sides',
  'Isometric_Wipers',
  'Plank',
  'Plate_Pinch',
  'Prone_Manual_Hamstring',
  'Side_Bridge',
]);

function isKept(row) {
  return (
    CATEGORY_ORDER.includes(row.category) &&
    !DROPPED_EQUIPMENT.has(row.equipment) &&
    !BAND_OR_BALL_NAME.test(row.name) &&
    !DROPPED_IDS.has(row.id)
  );
}

// Loaded by the lifter's own body whatever the source lists, so the model must add bodyweight.
const BODYWEIGHT_NAME =
  /pull[- ]?ups?\b|chin[- ]?ups?\b|\bchins?\b|\bdips?\b|push[- ]?ups?\b|muscle up|inverted row|suspended|\bbodyweight\b|rope climb|london bridges|back extensions|glute.?ham raise|parallel bars/i;
const NOT_BODYWEIGHT_NAME = /machine|to chin/i;

// Rows and pulldowns pull the arm back; presses, dips, push-ups and flyes push it forward.
const REAR_DELT_NAME =
  /rear|reverse\b.*\bfl[yi]|\bback fl[yi]|face pull|(?<!upright\s.*)\brows?\b|pull-?(ups?|downs?)|\bchins?\b/i;
const FRONT_DELT_NAME = /press|\bfront\b.*\braise|\bfl[yi]|crossover|pullover|\bdips?\b|push-?ups?/i;

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
  const isBodyweight = BODYWEIGHT_NAME.test(row.name) && !NOT_BODYWEIGHT_NAME.test(row.name);
  return isBodyweight ? 'bodyweight' : (EQUIPMENT[row.equipment] ?? 'other');
}

function toRow(row) {
  const primaryMuscles = mapMuscles(row.primaryMuscles, row.name);
  const secondaryMuscles = mapMuscles(row.secondaryMuscles, row.name).filter(
    (muscle) => !primaryMuscles.includes(muscle),
  );
  return { id: row.id, name: row.name, primaryMuscles, secondaryMuscles, equipment: mapEquipment(row) };
}

/** Adds the written assumptions, and lets corrections replace wrong source data. */
function complete(row, catalogue) {
  const { baseLift, ratio, confidence, reason, corrections = {} } = catalogue.get(row.id) ?? {};
  const { primaryMuscles, secondaryMuscles, equipment } = { ...row, ...corrections };
  return {
    id: row.id,
    name: row.name,
    group: GROUP_OF_MUSCLE[primaryMuscles[0]],
    primaryMuscles,
    secondaryMuscles: secondaryMuscles.filter((muscle) => !primaryMuscles.includes(muscle)),
    equipment,
    baseLift,
    ratio,
    confidence,
    reason,
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

async function readSource(localPath) {
  if (localPath) return JSON.parse(await readFile(localPath, 'utf8'));
  const response = await fetch(SOURCE_URL);
  if (!response.ok) throw new Error(`${SOURCE_URL}: HTTP ${response.status}`);
  return response.json();
}

const source = await readSource(process.argv[2]);
const gaps = await readJson(GAPS_PATH);
const catalogue = new Map((await readJson(CATALOGUE_PATH)).map((row) => [row.id, row]));
const { lifts } = await readJson(BASE_LIFTS_PATH);

const kept = source
  .filter(isKept)
  .map((row, index) => ({ row, rank: CATEGORY_ORDER.indexOf(row.category), index }))
  .sort((a, b) => a.rank - b.rank || a.index - b.index)
  .map(({ row }) => toRow(row));

const rows = [...gaps, ...kept].map((row) => complete(row, catalogue));

const ids = new Set(rows.map((row) => row.id));
if (ids.size !== rows.length) throw new Error('Duplicate exercise ids');
const orphans = [...catalogue.keys()].filter((id) => !ids.has(id));
if (orphans.length > 0) throw new Error(`Catalogue rows with no exercise: ${orphans.join(', ')}`);
validateRows(rows, Object.keys(lifts));

// One row per line keeps regeneration diffs readable.
const json = `[\n${rows.map((row) => JSON.stringify(row)).join(',\n')}\n]\n`;
await writeFile(OUTPUT_PATH, json);
console.log(`Wrote ${rows.length} rows (${gaps.length} gaps), ${json.length} bytes`);
