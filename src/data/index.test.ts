import { describe, expect, it } from 'vitest';
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
const isStretching = (exercise: ExerciseDef): boolean => 'stretching' in exercise;

describe('exercise bank', () => {
  it('holds 800+ rows (AC3)', () => {
    expect(EXERCISES.length).toBeGreaterThanOrEqual(800);
  });

  it('has unique ids', () => {
    expect(new Set(EXERCISES.map((exercise) => exercise.id)).size).toBe(EXERCISES.length);
  });

  it('keeps source ids, so backups survive a regeneration', () => {
    expect(row('Barbell Bench Press - Medium Grip').id).toBe('Barbell_Bench_Press_-_Medium_Grip');
    expect(row('3/4 Sit-Up').id).toBe('3_4_Sit-Up');
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

  it('carries only ExerciseDef fields, plus the stretching flag', () => {
    const allowed = new Set([
      'id',
      'name',
      'group',
      'primaryMuscles',
      'secondaryMuscles',
      'equipment',
      'stretching',
    ]);
    for (const exercise of EXERCISES) {
      for (const key of Object.keys(exercise)) expect(allowed.has(key), key).toBe(true);
    }
  });

  it('has no cardio', () => {
    const ids = new Set(EXERCISES.map((exercise) => exercise.id));
    for (const id of CARDIO_IDS) expect(ids.has(id), id).toBe(false);
  });

  it('keeps the stretches, after every strength row', () => {
    const stretches = EXERCISES.filter(isStretching);
    expect(stretches.length).toBe(123);
    expect(EXERCISES.slice(-stretches.length).every(isStretching)).toBe(true);
  });

  it('splits shoulders by name', () => {
    expect(row('Face Pull').primaryMuscles).toEqual(['back-deltoids']);
    expect(row('Reverse Machine Flyes').primaryMuscles).toEqual(['back-deltoids']);
    expect(row('Dumbbell Shoulder Press').primaryMuscles).toEqual(['front-deltoids']);
    expect(row('Front Dumbbell Raise').primaryMuscles).toEqual(['front-deltoids']);
    expect(row('Side Lateral Raise').primaryMuscles).toEqual(['front-deltoids', 'back-deltoids']);
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
    expect(row('Jerk Dip Squat').equipment).toBe('barbell');
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

  it('ranks strength above stretching even against a prefix match', () => {
    for (const query of ['hamstring', 'shoulder', 'chest', 'triceps', 'lat']) {
      const results = searchExercises(query, EXERCISES, EXERCISES.length);
      const firstStretch = results.findIndex(isStretching);
      expect(firstStretch, query).toBeGreaterThan(0);
      expect(results.slice(firstStretch).every(isStretching), query).toBe(true);
    }
  });

  it('returns the first rows for an empty query', () => {
    expect(searchExercises('', EXERCISES, 3)).toEqual(EXERCISES.slice(0, 3));
    expect(searchExercises('  - ', EXERCISES, 3)).toEqual(EXERCISES.slice(0, 3));
  });

  it('respects the limit', () => {
    expect(searchExercises('press', EXERCISES, 4)).toHaveLength(4);
  });

  it('searches whatever list it is given, so customs can be included', () => {
    const custom: ExerciseDef = {
      id: 'custom_1',
      name: 'Bench',
      group: 'Chest',
      primaryMuscles: ['chest'],
      secondaryMuscles: [],
      equipment: 'other',
    };
    expect(searchExercises('bench', [...EXERCISES, custom])[0]).toBe(custom);
    expect(searchExercises('zottman', [custom])).toEqual([]);
  });
});
