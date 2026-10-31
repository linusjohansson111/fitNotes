// Fetches men's strength standards from strengthlevel.com and writes the editable
// table src/balance/standards.ts. Muscles come from src/data/exercises.json, so
// build the bank first.
// Run with: node scripts/fetch-standards.mjs [cache directory]
// Raw pages stay in the cache directory, so a re-run fetches nothing twice.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const PAUSE_MS = 1500;
const CACHE_DIR = process.argv[2] ?? join(tmpdir(), 'fitnotes-standards');
const BANK_PATH = new URL('../src/data/exercises.json', import.meta.url);
const OUTPUT_PATH = new URL('../src/balance/standards.ts', import.meta.url);

// Judgement, not data: no published bodybuilder table was found. Keyed by bank group.
const RAISES = { Shoulders: 1.15, Back: 1.1, Arms: 1.1 };

// The first exercise id gives the row its muscles and raise. Ids count only when the
// load matches the site's lift; close grips and the like have standards of their own.
const LIFTS = [
  {
    slug: 'bench-press',
    name: 'Bench Press',
    ids: [
      'Barbell_Bench_Press_-_Medium_Grip',
      'Bench_Press_-_Powerlifting',
      'Wide-Grip_Barbell_Bench_Press',
    ],
  },
  {
    slug: 'incline-bench-press',
    name: 'Incline Bench Press',
    ids: ['Barbell_Incline_Bench_Press_-_Medium_Grip'],
  },
  {
    slug: 'dumbbell-bench-press',
    name: 'Dumbbell Bench Press',
    ids: ['Dumbbell_Bench_Press', 'Dumbbell_Bench_Press_with_Neutral_Grip'],
  },
  { slug: 'squat', name: 'Squat', ids: ['Barbell_Squat', 'Barbell_Full_Squat'] },
  { slug: 'front-squat', name: 'Front Squat', ids: ['Front_Barbell_Squat', 'Front_Squat_Clean_Grip'] },
  { slug: 'deadlift', name: 'Deadlift', ids: ['Barbell_Deadlift'] },
  {
    slug: 'romanian-deadlift',
    name: 'Romanian Deadlift',
    ids: ['Romanian_Deadlift', 'Stiff-Legged_Barbell_Deadlift'],
  },
  {
    slug: 'shoulder-press',
    name: 'Shoulder Press',
    ids: [
      'gap_overhead_press',
      'Standing_Military_Press',
      'Barbell_Shoulder_Press',
      'Seated_Barbell_Military_Press',
    ],
  },
  {
    slug: 'dumbbell-shoulder-press',
    name: 'Dumbbell Shoulder Press',
    ids: ['Dumbbell_Shoulder_Press', 'Seated_Dumbbell_Press', 'Standing_Dumbbell_Press'],
  },
  { slug: 'bent-over-row', name: 'Barbell Row', ids: ['Bent_Over_Barbell_Row', 'gap_pendlay_row'] },
  {
    slug: 'dumbbell-row',
    name: 'Dumbbell Row',
    ids: ['One-Arm_Dumbbell_Row', 'Bent_Over_Two-Dumbbell_Row'],
  },
  { slug: 'seated-cable-row', name: 'Seated Cable Row', ids: ['Seated_Cable_Rows'] },
  {
    slug: 'lat-pulldown',
    name: 'Lat Pulldown',
    ids: [
      'Wide-Grip_Lat_Pulldown',
      'Close-Grip_Front_Lat_Pulldown',
      'Full_Range-Of-Motion_Lat_Pulldown',
      'V-Bar_Pulldown',
      'Underhand_Cable_Pulldowns',
    ],
  },
  {
    slug: 'pull-ups',
    name: 'Pull-Up',
    ids: ['Pullups', 'Weighted_Pull_Ups', 'gap_assisted_pull_up_machine', 'V-Bar_Pullup'],
  },
  { slug: 'chin-ups', name: 'Chin-Up', ids: ['Chin-Up'] },
  {
    slug: 'dips',
    name: 'Dip',
    ids: [
      'Dips_-_Triceps_Version',
      'Dips_-_Chest_Version',
      'Parallel_Bar_Dip',
      'gap_assisted_dip_machine',
    ],
  },
  { slug: 'barbell-curl', name: 'Barbell Curl', ids: ['Barbell_Curl', 'EZ-Bar_Curl'] },
  {
    slug: 'dumbbell-curl',
    name: 'Dumbbell Curl',
    ids: ['Dumbbell_Bicep_Curl', 'Dumbbell_Alternate_Bicep_Curl', 'Seated_Dumbbell_Curl'],
  },
  {
    slug: 'tricep-pushdown',
    name: 'Tricep Pushdown',
    ids: [
      'Triceps_Pushdown',
      'Triceps_Pushdown_-_Rope_Attachment',
      'Triceps_Pushdown_-_V-Bar_Attachment',
    ],
  },
  // The site's plain "Tricep Extension" is overhead with a barbell, going by its translated names.
  {
    slug: 'tricep-extension',
    name: 'Overhead Tricep Extension',
    ids: ['Standing_Overhead_Barbell_Triceps_Extension'],
  },
  {
    slug: 'lying-tricep-extension',
    name: 'Lying Tricep Extension',
    ids: ['EZ-Bar_Skullcrusher', 'Lying_Triceps_Press'],
  },
  {
    slug: 'dumbbell-tricep-extension',
    name: 'Dumbbell Tricep Extension',
    ids: ['Standing_Dumbbell_Triceps_Extension', 'Lying_Dumbbell_Tricep_Extension'],
  },
  { slug: 'sled-leg-press', name: 'Leg Press', ids: ['Leg_Press', 'Narrow_Stance_Leg_Press'] },
  { slug: 'leg-extension', name: 'Leg Extension', ids: ['Leg_Extensions'] },
  { slug: 'lying-leg-curl', name: 'Lying Leg Curl', ids: ['Lying_Leg_Curls'] },
  { slug: 'seated-leg-curl', name: 'Seated Leg Curl', ids: ['Seated_Leg_Curl'] },
  { slug: 'hip-thrust', name: 'Hip Thrust', ids: ['Barbell_Hip_Thrust'] },
  { slug: 'machine-calf-raise', name: 'Calf Raise', ids: ['Standing_Calf_Raises'] },
  { slug: 'barbell-shrug', name: 'Barbell Shrug', ids: ['Barbell_Shrug'] },
  { slug: 'dumbbell-shrug', name: 'Dumbbell Shrug', ids: ['Dumbbell_Shrug'] },
  {
    slug: 'dumbbell-lateral-raise',
    name: 'Lateral Raise',
    ids: ['Side_Lateral_Raise', 'Seated_Side_Lateral_Raise'],
  },
  { slug: 'cable-crunch', name: 'Cable Crunch', ids: ['Cable_Crunch'] },
  // Beyond the core list: without these, the muscles they train have no primary lift.
  { slug: 'hip-abduction', name: 'Hip Abduction', ids: ['Thigh_Abductor'] },
  { slug: 'hip-adduction', name: 'Hip Adduction', ids: ['Thigh_Adductor'] },
  { slug: 'face-pull', name: 'Face Pull', ids: ['Face_Pull'] },
  { slug: 'dumbbell-reverse-fly', name: 'Reverse Fly', ids: ['Reverse_Flyes'] },
  {
    slug: 'wrist-curl',
    name: 'Wrist Curl',
    ids: ['Palms-Up_Barbell_Wrist_Curl_Over_A_Bench', 'Seated_Palm-Up_Barbell_Wrist_Curl'],
  },
];

/** The page's HTML, or null when the site redirects away because it has no such page. */
async function loadPage(slug) {
  const page = join(CACHE_DIR, `${slug}.html`);
  const missing = join(CACHE_DIR, `${slug}.missing`);
  if (existsSync(page)) return readFileSync(page, 'utf8');
  if (existsSync(missing)) return null;

  const url = `https://strengthlevel.com/strength-standards/${slug}/kg`;
  const response = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    redirect: 'manual',
  });
  await sleep(PAUSE_MS);
  if (response.status !== 200) {
    writeFileSync(missing, String(response.status));
    return null;
  }
  const html = await response.text();
  writeFileSync(page, html);
  return html;
}

const cellText = (html) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

function bodyweightTables(html) {
  return [...html.matchAll(/<table[\s\S]*?<\/table>/g)]
    .map(([table]) =>
      [...table.matchAll(/<tr[\s\S]*?<\/tr>/g)].map(([row]) =>
        [...row.matchAll(/<t[hd][\s\S]*?<\/t[hd]>/g)].map(([cell]) => cellText(cell)),
      ),
    )
    .filter((rows) => rows[0]?.[0] === 'BW');
}

const isAddedWeight = (rows) => rows[1].slice(1).every((cell) => /^[+-]\d+ kg$/.test(cell));

/**
 * Bodyweight lifts lead with a table of reps, then give "+7 kg" or "-5 kg" on a belt or
 * as assistance. Those become total load: LiftStrength.oneRepMaxKg uses that term too.
 */
function parseStandards(html) {
  const tables = bodyweightTables(html);
  const added = tables.find(isAddedWeight);
  if (!added && /average rep count/.test(html)) return null;

  // The male table comes first and starts at 50 kg; the female one starts at 40 kg.
  const rows = (added ?? tables[0]).slice(1);
  if (rows[0][0] !== '50') throw new Error(`Expected the male table, got BW ${rows[0][0]}`);

  return rows.map(([bodyweight, ...cells]) => {
    const bodyweightKg = Number(bodyweight);
    const kg = cells.map((cell) => (added ? bodyweightKg + parseInt(cell, 10) : Number(cell)));
    return [bodyweightKg, kg];
  });
}

function toTableRow(lift, standards, exercisesById) {
  const exercise = exercisesById.get(lift.ids[0]);
  for (const id of lift.ids) {
    if (!exercisesById.has(id)) throw new Error(`${lift.name}: no bank exercise ${id}`);
  }
  const muscles = [
    ...exercise.primaryMuscles.map((muscle) => `'${muscle}': 1`),
    ...exercise.secondaryMuscles.map((muscle) => `'${muscle}': 0.5`),
  ];
  const ids = lift.ids.map((id) => `'${id}'`).join(', ');
  const rows = standards.map(([bodyweight, kg]) => `      ${bodyweight}: [${kg.join(', ')}],`);
  return [
    '  {',
    `    name: '${lift.name}',`,
    `    exerciseIds: [${ids}],`,
    `    muscles: { ${muscles.join(', ')} },`,
    `    raise: ${RAISES[exercise.group] ?? 1},`,
    '    standards: {',
    ...rows,
    '    },',
    '  },',
  ].join('\n');
}

function toSource(tableRows, fetchedOn) {
  return `import type { Muscle } from '../domain/types';

// Men's 1RM standards from strengthlevel.com/strength-standards, fetched ${fetchedOn} by
// scripts/fetch-standards.mjs. Running that script again overwrites edits made here.
// Weights are in logged terms: one dumbbell for dumbbell lifts, and total load
// (bodyweight plus added) for bodyweight lifts, converted from the site's added weight.
// \`raise\` is judgement, not data: no published bodybuilder table was found. The raised
// values are the real standards, so edit \`raise\` to change what counts as in proportion.

export const LEVEL_NAMES = ['Beginner', 'Novice', 'Intermediate', 'Advanced', 'Elite'] as const;

/** One value per entry in LEVEL_NAMES, in kg. */
export type LevelKg = [number, number, number, number, number];

export interface LiftStandard {
  name: string;
  /** Bank exercises that count as this lift. */
  exerciseIds: string[];
  /** Weight in a muscle's level: primary 1, secondary 0.5. */
  muscles: Partial<Record<Muscle, number>>;
  /** Multiplier on the published standards. */
  raise: number;
  /** Bodyweight in kg to published standards. */
  standards: Record<number, LevelKg>;
}

export const STANDARDS: LiftStandard[] = [
${tableRows.join('\n')}
];
`;
}

mkdirSync(CACHE_DIR, { recursive: true });
const bank = JSON.parse(readFileSync(BANK_PATH, 'utf8'));
const exercisesById = new Map(bank.map((exercise) => [exercise.id, exercise]));

const tableRows = [];
for (const lift of LIFTS) {
  const html = await loadPage(lift.slug);
  const standards = html && parseStandards(html);
  if (!standards) {
    console.warn(`Skipped ${lift.name}: ${html ? 'reps only' : 'page unavailable'}`);
    continue;
  }
  tableRows.push(toTableRow(lift, standards, exercisesById));
}

const fetchedOn = new Date().toISOString().slice(0, 10);
writeFileSync(OUTPUT_PATH, toSource(tableRows, fetchedOn));
console.log(`Wrote ${tableRows.length} of ${LIFTS.length} lifts`);
