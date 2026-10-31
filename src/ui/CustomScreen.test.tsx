import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Muscle } from '../domain/types';
import { saveCustomExercise } from '../store';
import type { BodyMapProps } from './BodyMap';
import { CustomScreen } from './CustomScreen';

const TAPPABLE: Muscle[] = ['chest', 'biceps'];

vi.mock('./BodyMap', () => ({
  BodyMap: ({ fills, onMuscle }: BodyMapProps) => (
    <div>
      {TAPPABLE.map((muscle) => (
        <button key={muscle} type="button" data-fill={fills[muscle]} onClick={() => onMuscle?.(muscle)}>
          {muscle}
        </button>
      ))}
    </div>
  ),
}));

vi.mock('../store', () => ({ saveCustomExercise: vi.fn(async () => ({})) }));

const save = () => screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
const name = () => screen.getByLabelText('Exercise name') as HTMLInputElement;
const muscle = (label: Muscle) => screen.getByRole('button', { name: label });

beforeEach(() => {
  window.location.hash = '';
  vi.mocked(saveCustomExercise).mockClear();
});

afterEach(cleanup);

describe('AC3: custom exercise', () => {
  it('starts from the name typed in search', () => {
    render(<CustomScreen initialName="Cable thing" />);
    expect(name().value).toBe('Cable thing');
  });

  it('needs a name and a primary muscle', async () => {
    const user = userEvent.setup();
    render(<CustomScreen />);
    expect(save().disabled).toBe(true);
    await user.type(name(), 'Odd Lift');
    expect(save().disabled).toBe(true);
    await user.click(muscle('chest'));
    expect(save().disabled).toBe(false);
    await user.click(muscle('chest'));
    expect(save().disabled).toBe(true);
  });

  it('cycles a tapped muscle through primary, secondary and none', async () => {
    const user = userEvent.setup();
    render(<CustomScreen />);
    expect(muscle('chest').dataset.fill).toBeUndefined();
    await user.click(muscle('chest'));
    expect(muscle('chest').dataset.fill).toBe('#ffffff');
    await user.click(muscle('chest'));
    expect(muscle('chest').dataset.fill).toBe('#636366');
    await user.click(muscle('chest'));
    expect(muscle('chest').dataset.fill).toBeUndefined();
  });

  it('saves with the group of the first primary, then opens the log form', async () => {
    const user = userEvent.setup();
    render(<CustomScreen />);
    await user.type(name(), '  Odd Lift ');
    await user.click(screen.getByRole('button', { name: 'Dumbbell' }));
    await user.click(muscle('biceps'));
    await user.click(muscle('chest'));
    await user.click(save());

    expect(saveCustomExercise).toHaveBeenCalledTimes(1);
    const saved = vi.mocked(saveCustomExercise).mock.calls[0][0];
    expect(saved).toMatchObject({
      name: 'Odd Lift',
      group: 'Arms',
      primaryMuscles: ['biceps', 'chest'],
      secondaryMuscles: [],
      equipment: 'dumbbell',
    });
    expect(saved.id).toMatch(/^custom_[0-9a-f-]{36}$/);
    await waitFor(() => expect(window.location.hash).toBe(`#/log/${saved.id}`));
  });

  it('marks the chosen equipment, with exactly one selected', async () => {
    const user = userEvent.setup();
    render(<CustomScreen />);
    await user.click(screen.getByRole('button', { name: 'Bodyweight' }));
    const pressed = screen.getAllByRole('button', { pressed: true });
    expect(pressed.map((button) => button.textContent)).toEqual(['Bodyweight']);
  });
});
