import { type SubmitEvent, useMemo, useState } from 'react';
import type { Equipment } from '../domain/types';
import { saveCustomExercise } from '../store';
import { BodyMap } from './BodyMap';
import { type MuscleSelection, cycleMuscle, groupOfMuscle, muscleFills } from './muscles';
import { go } from './nav';

const EQUIPMENT: [Equipment, string][] = [
  ['barbell', 'Barbell'],
  ['dumbbell', 'Dumbbell'],
  ['machine', 'Machine'],
  ['cable', 'Cable'],
  ['kettlebell', 'Kettlebell'],
  ['bodyweight', 'Bodyweight'],
  ['other', 'Other'],
];
const MAP_HEIGHT = 340;

export function CustomScreen({ initialName = '' }: { initialName?: string }) {
  const [name, setName] = useState(initialName);
  const [equipment, setEquipment] = useState<Equipment>('barbell');
  const [{ primary, secondary }, setMuscles] = useState<MuscleSelection>({ primary: [], secondary: [] });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const fills = useMemo(() => muscleFills(primary, secondary), [primary, secondary]);
  const trimmedName = name.trim();
  const valid = trimmedName !== '' && primary.length > 0;

  async function save(event: SubmitEvent) {
    event.preventDefault();
    if (!valid || saving) return;
    setSaving(true);
    setFailed(false);
    const id = `custom_${crypto.randomUUID()}`;
    try {
      await saveCustomExercise({
        id,
        name: trimmedName,
        group: groupOfMuscle(primary[0]),
        primaryMuscles: primary,
        secondaryMuscles: secondary,
        equipment,
      });
      go({ name: 'log', exerciseId: id });
    } catch (error) {
      console.error('fitNotes: could not save', error);
      setFailed(true);
      setSaving(false);
    }
  }

  return (
    <form className="screen custom" onSubmit={(event) => void save(event)}>
      <input
        className="search"
        placeholder="Exercise name"
        aria-label="Exercise name"
        autoComplete="off"
        value={name}
        onChange={(event) => setName(event.target.value)}
      />

      <div className="chips" role="group" aria-label="Equipment">
        {EQUIPMENT.map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="chip"
            aria-pressed={value === equipment}
            onClick={() => setEquipment(value)}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="hint">Tap once for primary, twice for secondary.</p>
      <div className="custom-map">
        <BodyMap
          fills={fills}
          height={MAP_HEIGHT}
          onMuscle={(muscle) => setMuscles((selection) => cycleMuscle(selection, muscle))}
        />
      </div>

      {failed && <p className="error">Could not save. Try again.</p>}
      <button type="submit" className="save" disabled={!valid || saving}>
        Save
      </button>
    </form>
  );
}
