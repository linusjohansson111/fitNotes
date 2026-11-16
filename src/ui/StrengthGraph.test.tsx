import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays } from '../domain/date';
import type { StrengthHistory } from '../model';
import { StrengthGraph } from './StrengthGraph';

afterEach(cleanup);

const ASOF = '2026-10-31';

const sessions = [addDays(ASOF, -500), addDays(ASOF, -200), addDays(ASOF, -30)];
const history: StrengthHistory = {
  line: sessions.map((date, index) => ({ date, kg: 90 + index })),
  dots: sessions.map((date, index) => ({
    entryId: `e${index}`,
    date,
    kg: 90 + index,
    colour: (['red', 'yellow', 'green'] as const)[index],
  })),
};

const dots = (container: HTMLElement) => container.querySelectorAll('circle').length;

describe('StrengthGraph', () => {
  it('AC13: draws one yellow line and colours each dot by its own reps', () => {
    const { container } = render(<StrengthGraph history={history} asOf={ASOF} />);
    const paths = [...container.querySelectorAll('path')];
    expect(paths).toHaveLength(1);
    expect(paths[0].getAttribute('class')).toBe('ins-line ins-yellow');
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect([...container.querySelectorAll('circle')].map((circle) => circle.getAttribute('class'))).toEqual([
      'ins-dot ins-red',
      'ins-dot ins-yellow',
      'ins-dot ins-green',
    ]);
  });

  it('AC13: defaults to 3M and the buttons change what is shown', () => {
    const { container } = render(<StrengthGraph history={history} asOf={ASOF} />);
    expect(screen.getByRole('button', { name: '3M' }).getAttribute('aria-pressed')).toBe('true');
    expect(dots(container)).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: '1Y' }));
    expect(screen.getByRole('button', { name: '1Y' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: '3M' }).getAttribute('aria-pressed')).toBe('false');
    expect(dots(container)).toBe(2);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    expect(dots(container)).toBe(3);
  });

  it('AC13: remembers nothing between visits', () => {
    const first = render(<StrengthGraph history={history} asOf={ASOF} />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    first.unmount();
    render(<StrengthGraph history={history} asOf={ASOF} />);
    expect(screen.getByRole('button', { name: '3M' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('still draws the line when the range holds no entries', () => {
    const old: StrengthHistory = { line: [history.line[0]], dots: [history.dots[0]] };
    const { container } = render(<StrengthGraph history={old} asOf={ASOF} />);
    expect(container.querySelectorAll('path')).toHaveLength(1);
    expect(dots(container)).toBe(0);
    for (const path of container.querySelectorAll('path')) expect(path.getAttribute('d')).not.toBe('');
  });
});
