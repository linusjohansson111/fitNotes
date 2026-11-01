import { spawnSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync, mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain JavaScript, shared with the build script.
import { validateRows } from '../../scripts/validate-exercises.mjs';
import { BASE_LIFTS } from '../balance';
import type { ExerciseDef, Group, Muscle } from '../domain/types';
import gaps from './gaps.json';
import { EXERCISES, searchExercises } from './index';

const MUSCLES: Muscle[] = [
  'trapezius',
  'upper-back',
  'lower-back',
  'chest',
  'biceps',
  'triceps',
  'forearm',
  'back-deltoids',
  'front-deltoids',
  'abs',
  'obliques',
  'adductor',
  'hamstring',
  'quadriceps',
  'abductors',
  'calves',
  'gluteal',
  'neck',
];
const GROUPS: Group[] = ['Chest', 'Back', 'Shoulders', 'Arms', 'Legs', 'Core'];
const EQUIPMENT = ['barbell', 'dumbbell', 'machine', 'cable', 'kettlebell', 'bodyweight', 'other'];
const CARDIO_IDS = [
  'Bicycling',
  'Bicycling_Stationary',
  'Elliptical_Trainer',
  'Jogging_Treadmill',
  'Prowler_Sprint',
  'Recumbent_Bike',
  'Rope_Jumping',
  'Rowing_Stationary',
  'Running_Treadmill',
  'Skating',
  'Stairmaster',
  'Step_Mill',
  'Trail_Running_Walking',
  'Walking_Treadmill',
];

const row = (name: string): ExerciseDef => {
  const found = EXERCISES.find((exercise) => exercise.name === name);
  if (!found) throw new Error(`No bank row called ${name}`);
  return found;
};
const firstName = (query: string): string | undefined =>
  searchExercises(query, EXERCISES, 1)[0]?.name;
const byId = (id: string): ExerciseDef | undefined => EXERCISES.find((exercise) => exercise.id === id);
const REPO = join(import.meta.dirname, '../..');
const BASE_LIFT_NAMES = Object.keys(BASE_LIFTS);
const GOOD_ROW = byId('Barbell_Squat') as ExerciseDef;
const validate = (row: object): void => validateRows([row], BASE_LIFT_NAMES);

/** Every file under a repo folder. */
function filesIn(folder: string): string[] {
  return readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    return statSync(path).isDirectory() ? filesIn(path) : [path];
  });
}

describe('exercise bank', () => {
  it('holds about 585 rows (AC3)', () => {
    expect(EXERCISES.length).toBeGreaterThan(550);
    expect(EXERCISES.length).toBeLessThan(620);
  });

  it('has unique ids', () => {
    expect(new Set(EXERCISES.map((exercise) => exercise.id)).size).toBe(EXERCISES.length);
  });

  it('keeps source ids, so backups survive a regeneration', () => {
    expect(row('Barbell Bench Press - Medium Grip').id).toBe('Barbell_Bench_Press_-_Medium_Grip');
    expect(row('3/4 Sit-Up').id).toBe('3_4_Sit-Up');
    expect(row('Overhead Press').id).toBe('gap_overhead_press');
  });

  it('has only valid rows', () => {
    for (const exercise of EXERCISES) {
      expect(exercise.name, exercise.id).toBeTruthy();
      expect(GROUPS, exercise.id).toContain(exercise.group);
      expect(EQUIPMENT, exercise.id).toContain(exercise.equipment);
      expect(exercise.primaryMuscles.length, exercise.id).toBeGreaterThan(0);
      for (const muscle of [...exercise.primaryMuscles, ...exercise.secondaryMuscles]) {
        expect(MUSCLES, exercise.id).toContain(muscle);
      }
    }
  });

  it('has no repeated muscles and nothing secondary that is also primary', () => {
    for (const { id, primaryMuscles, secondaryMuscles } of EXERCISES) {
      expect(new Set(primaryMuscles).size, id).toBe(primaryMuscles.length);
      expect(new Set(secondaryMuscles).size, id).toBe(secondaryMuscles.length);
      for (const muscle of secondaryMuscles) expect(primaryMuscles, id).not.toContain(muscle);
    }
  });

  it('carries exactly the ExerciseDef fields', () => {
    const fields = [
      'baseLift',
      'confidence',
      'equipment',
      'group',
      'id',
      'name',
      'primaryMuscles',
      'ratio',
      'reason',
      'secondaryMuscles',
    ];
    for (const exercise of EXERCISES) expect(Object.keys(exercise).sort(), exercise.id).toEqual(fields);
  });

  it('has no cardio', () => {
    const ids = new Set(EXERCISES.map((exercise) => exercise.id));
    for (const id of CARDIO_IDS) expect(ids.has(id), id).toBe(false);
  });

  it('AC19: holds no stretching, plyometric, strongman, Olympic, band, ball or timed-hold row', () => {
    const ids = new Set(EXERCISES.map(({ id }) => id));
    for (const id of [
      'Hamstring_Stretch',
      'Box_Jump_Multiple_Response',
      'Atlas_Stones',
      'Farmers_Walk',
      'Snatch',
      'Clean_and_Jerk',
      'Power_Clean',
      'Clean_and_Press',
      'Band_Pull_Apart',
      'Reverse_Band_Deadlift',
      'Exercise_Ball_Crunch',
      'One-Arm_Medicine_Ball_Slam',
      'Plank',
      'Side_Bridge',
      'Sled_Row',
    ]) {
      expect(ids.has(id), id).toBe(false);
    }
    for (const { name } of EXERCISES) expect(name, name).not.toMatch(/\bbands?\b|\bball\b|stretch\b|\bjump\b|^plank/i);
  });

  it('AC19: holds the lifts people actually log', () => {
    const names = new Set(EXERCISES.map(({ name }) => name));
    for (const id of [
      'Wide-Grip_Lat_Pulldown',
      'Barbell_Deadlift',
      'Dumbbell_Bicep_Curl',
      'Incline_Dumbbell_Press',
      'Seated_Cable_Rows',
    ]) {
      expect(byId(id), id).toBeDefined();
    }
    for (const name of ['Trap Bar Deadlift', 'Front Plate Raise', 'Donkey Calf Raises']) {
      expect(names.has(name), name).toBe(true);
    }
  });

  it('AC20: lists chest as a primary muscle of the chest lifts the source had wrong', () => {
    for (const id of ['Dips_-_Chest_Version', 'Bench_Press_-_Powerlifting']) {
      expect(byId(id)?.primaryMuscles, id).toContain('chest');
    }
  });

  it('gives every base lift a row at ratio 1 and high confidence', () => {
    for (const baseLift of BASE_LIFT_NAMES) {
      const rows = EXERCISES.filter((exercise) => exercise.baseLift === baseLift && exercise.reason.startsWith('Base lift'));
      expect(rows.length, baseLift).toBe(1);
      expect(rows[0].ratio, baseLift).toBe(1);
      expect(rows[0].confidence, baseLift).toBe('high');
    }
  });

  it('gives every row a written reason and a sane ratio', () => {
    for (const { id, reason, ratio } of EXERCISES) {
      expect(reason.length, id).toBeGreaterThan(10);
      expect(ratio, id).toBeGreaterThan(0.05);
      expect(ratio, id).toBeLessThan(2);
    }
  });

  it('splits shoulders by name', () => {
    expect(row('Face Pull').primaryMuscles).toEqual(['back-deltoids']);
    expect(row('Reverse Machine Flyes').primaryMuscles).toEqual(['back-deltoids']);
    expect(row('Dumbbell Shoulder Press').primaryMuscles).toEqual(['front-deltoids']);
    expect(row('Front Dumbbell Raise').primaryMuscles).toEqual(['front-deltoids']);
    expect(row('Side Lateral Raise').primaryMuscles).toEqual(['front-deltoids', 'back-deltoids']);
  });

  it('gives pulls the rear delts and pushes the front ones', () => {
    expect(row('Bent Over Barbell Row').secondaryMuscles).toContain('back-deltoids');
    expect(row('Bent Over Barbell Row').secondaryMuscles).not.toContain('front-deltoids');
    expect(row('Wide-Grip Lat Pulldown').secondaryMuscles).not.toContain('front-deltoids');
    expect(row('Dips - Chest Version').secondaryMuscles).not.toContain('back-deltoids');
    expect(row('Cable Crossover').secondaryMuscles).not.toContain('back-deltoids');
  });

  it('corrects source data in the record', () => {
    expect(row('Cable Hip Adduction').primaryMuscles).toEqual(['adductor']);
    expect(row('Trap Bar Deadlift').equipment).toBe('barbell');
    expect(row('Russian Twist').primaryMuscles).toEqual(['obliques']);
  });

  it('merges lats and middle back without repeating upper-back', () => {
    const rows = row('Pullups');
    expect(rows.primaryMuscles).toEqual(['upper-back']);
    expect(rows.group).toBe('Back');
  });

  it('marks loaded-by-body lifts as bodyweight whatever the source says', () => {
    for (const name of [
      'Pullups',
      'Chin-Up',
      'Parallel Bar Dip',
      'Ring Dips',
      'Dips - Chest Version',
      'Decline Push-Up',
      'Muscle Up',
      'Inverted Row',
      'Weighted Pull Ups',
      'Assisted Pull-Up Machine',
    ]) {
      expect(row(name).equipment, name).toBe('bodyweight');
    }
  });

  it('leaves look-alike names alone', () => {
    expect(row('Dip Machine').equipment).toBe('machine');
    expect(row('Lying Close-Grip Barbell Triceps Press To Chin').equipment).toBe('barbell');
  });
});

describe('gap lifts', () => {
  it('prefix their ids', () => {
    for (const gap of gaps) expect(gap.id.startsWith('gap_'), gap.id).toBe(true);
  });

  it.each(gaps.map((gap) => gap.name))('finds %s first', (name) => {
    expect(firstName(name)).toBe(name);
  });
});

describe('searchExercises', () => {
  it.each([
    ['bench', 'Barbell Bench Press - Medium Grip'],
    ['ohp', 'Overhead Press'],
    ['OHP', 'Overhead Press'],
    ['pull up', 'Pullups'],
    ['pullup', 'Pullups'],
    ['pull-ups', 'Pullups'],
    ['chin', 'Chin-Up'],
    ['rdl', 'Romanian Deadlift'],
    ['squat', 'Barbell Squat'],
    ['deadlift', 'Barbell Deadlift'],
    ['pulldown', 'Wide-Grip Lat Pulldown'],
    ['lat pull down', 'Wide-Grip Lat Pulldown'],
    ['skullcrusher', 'EZ-Bar Skullcrusher'],
    ['skull crusher', 'EZ-Bar Skullcrusher'],
    ['tricep pushdown', 'Triceps Pushdown'],
    ['triceps pushdown', 'Triceps Pushdown'],
    ['dip', 'Dips - Triceps Version'],
    ['hip thrust', 'Barbell Hip Thrust'],
  ])('%s starts with %s', (query, name) => {
    expect(firstName(query)).toBe(name);
  });

  // Every lift the brief asked to check: a row or an alias must reach it.
  it.each([
    ['Dumbbell Lateral Raise', 'Side Lateral Raise'],
    ['Incline Dumbbell Press', 'Incline Dumbbell Press'],
    ['Cable Fly', 'Cable Crossover'],
    ['Seated Cable Row', 'Seated Cable Rows'],
    ['Machine Chest Press', 'Machine Bench Press'],
    ['Hack Squat Machine', 'Hack Squat'],
    ['Assisted Pull-Up Machine', 'Assisted Pull-Up Machine'],
    ['Smith Machine Squat', 'Smith Machine Squat'],
    ['Leg Extension', 'Leg Extensions'],
    ['Lying Leg Curl', 'Lying Leg Curls'],
    ['Seated Leg Curl', 'Seated Leg Curl'],
    ['Standing Calf Raise', 'Standing Calf Raises'],
    ['Cable Crunch', 'Cable Crunch'],
    ['Hip Abduction Machine', 'Thigh Abductor'],
    ['Hip Adduction Machine', 'Thigh Adductor'],
    ['Reverse Pec Deck', 'Reverse Machine Flyes'],
    ['Preacher Curl', 'Preacher Curl'],
    ['Tricep Pushdown', 'Triceps Pushdown'],
    ['Overhead Tricep Extension', 'Cable Rope Overhead Triceps Extension'],
  ])('%s reaches %s', (query, name) => {
    expect(firstName(query)).toBe(name);
  });

  it('ignores case and punctuation', () => {
    expect(firstName('EZ BAR SKULLCRUSHER')).toBe('EZ-Bar Skullcrusher');
    expect(firstName('dips, triceps version')).toBe('Dips - Triceps Version');
  });

  it('matches simple plurals both ways', () => {
    expect(firstName('leg extension')).toBe('Leg Extensions');
    expect(firstName('leg extensions')).toBe('Leg Extensions');
    expect(searchExercises('flyes', EXERCISES)).toEqual(searchExercises('fly', EXERCISES));
  });

  it('needs every word to match', () => {
    expect(searchExercises('squat bench press curl', EXERCISES)).toEqual([]);
    const results = searchExercises('incline dumbbell', EXERCISES);
    expect(results.length).toBeGreaterThan(0);
    for (const { name } of results) expect(name.toLowerCase()).toMatch(/incline.*dumbbell|dumbbell.*incline/);
  });

  it('matches a word still being typed', () => {
    expect(firstName('bulgar')).toBe('Bulgarian Split Squat');
  });

  it('ranks exact, then prefix, then the rest', () => {
    const list = [
      { ...row('Leg Press'), name: 'Seated Curl Rack' },
      { ...row('Leg Press'), name: 'Curl Rack' },
      { ...row('Leg Press'), name: 'Curl' },
    ];
    expect(searchExercises('curl', list).map(({ name }) => name)).toEqual([
      'Curl',
      'Curl Rack',
      'Seated Curl Rack',
    ]);
  });

  it('AC3: tolerates typos', () => {
    expect(firstName('Incline Dumbell Press')).toBe('Incline Dumbbell Press');
    expect(firstName('Inclne Dumbbell Pres')).toBe('Incline Dumbbell Press');
    expect(firstName('babrell curl')).toBe('Barbell Curl');
    expect(firstName('deadlfit')).toBe('Barbell Deadlift');
    expect(firstName('Lateral Rasie')).toBe('Side Lateral Raise');
  });

  it('leaves short words and aliases as typed, and still finds nothing for nonsense', () => {
    expect(firstName('ohp')).toBe('Overhead Press');
    expect(searchExercises('xqzv', EXERCISES)).toEqual([]);
    expect(searchExercises('wobble', EXERCISES)).toEqual([]);
  });

  it('returns the first rows for an empty query', () => {
    expect(searchExercises('', EXERCISES, 3)).toEqual(EXERCISES.slice(0, 3));
    expect(searchExercises('  - ', EXERCISES, 3)).toEqual(EXERCISES.slice(0, 3));
  });

  it('respects the limit', () => {
    expect(searchExercises('press', EXERCISES, 4)).toHaveLength(4);
  });
});

describe('AC18: the build refuses bad rows', () => {
  it('passes the bank as it stands', () => {
    expect(() => validateRows(EXERCISES, BASE_LIFT_NAMES)).not.toThrow();
  });

  it.each(['id', 'name', 'group', 'primaryMuscles', 'secondaryMuscles', 'equipment', 'baseLift', 'ratio', 'confidence', 'reason'])(
    'fails a row that lacks %s',
    (field) => {
      const { [field as keyof ExerciseDef]: _, ...row } = GOOD_ROW;
      expect(() => validate(row)).toThrow(`lacks ${field}`);
    },
  );

  it('fails an unknown base lift', () => {
    expect(() => validate({ ...GOOD_ROW, baseLift: 'Power Clean' })).toThrow('unknown base lift "Power Clean"');
  });

  it.each([0, -0.5])('fails a ratio of %s', (ratio) => {
    expect(() => validate({ ...GOOD_ROW, ratio })).toThrow('not positive');
  });

  it('fails a group that does not match the first primary muscle', () => {
    expect(() => validate({ ...GOOD_ROW, group: 'Chest' })).toThrow('first primary muscle is quadriceps');
  });

  it('stops the script before it writes anything, naming the row', () => {
    const source = join(mkdtempSync(join(tmpdir(), 'fitnotes-')), 'source.json');
    writeFileSync(
      source,
      JSON.stringify([
        {
          id: 'Unknown_Lift',
          name: 'Unknown Lift',
          category: 'strength',
          equipment: 'barbell',
          primaryMuscles: ['chest'],
          secondaryMuscles: [],
        },
      ]),
    );
    const output = join(REPO, 'src/data/exercises.json');
    const before = readFileSync(output, 'utf8');
    const run = spawnSync('node', [join(REPO, 'scripts/build-exercises.mjs'), source], { encoding: 'utf8' });
    expect(run.status).not.toBe(0);
    expect(run.stderr).toMatch(/Unknown_Lift lacks baseLift|Catalogue rows with no exercise/);
    expect(readFileSync(output, 'utf8')).toBe(before);
  });
});

describe('AC24: the old table is gone', () => {
  it('leaves no trace of its source', () => {
    const banned = new RegExp(['strength', '[ -]?', 'level'].join(''), 'i');
    for (const file of [...filesIn(join(REPO, 'src')), ...filesIn(join(REPO, 'scripts'))]) {
      expect(banned.test(readFileSync(file, 'utf8')), file).toBe(false);
    }
  });

  it('deleted the table and its fetch script', () => {
    expect(existsSync(join(REPO, 'src/balance/standards.ts'))).toBe(false);
    expect(existsSync(join(REPO, 'scripts/fetch-standards.mjs'))).toBe(false);
  });
});
