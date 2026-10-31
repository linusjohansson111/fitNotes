import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { addDays } from '../domain/date';
import type { StrengthHistory } from '../model';
import { StrengthGraph } from './StrengthGraph';

afterEach(cleanup);

const ASOF = '2026-10-31';

const sessions = [addDays(ASOF, -500), addDays(ASOF, -200), addDays(ASOF, -30)];
const line = (kg: number) => sessions.map((date, index) => ({ date, kg: kg + index }));
const history: StrengthHistory = {
  lines: { red: line(100), yellow: line(90), green: line(80) },
  dots: sessions.map((date, index) => ({ entryId: `e${index}`, date, kg: 90 + index, colour: 'yellow' })),
};

const dots = (container: HTMLElement) => container.querySelectorAll('circle').length;

describe('StrengthGraph', () => {
  it('AC13: draws three lines with only the current colour bright', () => {
    const { container } = render(<StrengthGraph history={history} colour="green" asOf={ASOF} />);
    const paths = [...container.querySelectorAll('path')];
    expect(paths).toHaveLength(3);
    expect(paths.filter((path) => path.classList.contains('ins-lead'))).toHaveLength(1);
    expect(paths.at(-1)?.getAttribute('class')).toContain('ins-green ins-lead');
  });

  it('AC13: defaults to 3M and the buttons change what is shown', () => {
    const { container } = render(<StrengthGraph history={history} colour="yellow" asOf={ASOF} />);
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
    const first = render(<StrengthGraph history={history} colour="yellow" asOf={ASOF} />);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));
    first.unmount();
    render(<StrengthGraph history={history} colour="yellow" asOf={ASOF} />);
    expect(screen.getByRole('button', { name: '3M' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('still draws every line when the range holds no entries', () => {
    const old: StrengthHistory = {
      lines: { red: [history.lines.red[0]], yellow: [history.lines.yellow[0]], green: [history.lines.green[0]] },
      dots: [history.dots[0]],
    };
    const { container } = render(<StrengthGraph history={old} colour="yellow" asOf={ASOF} />);
    expect(container.querySelectorAll('path')).toHaveLength(3);
    expect(dots(container)).toBe(0);
    for (const path of container.querySelectorAll('path')) expect(path.getAttribute('d')).not.toBe('');
  });
});
