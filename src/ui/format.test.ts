import { describe, expect, it } from 'vitest';
import { formatKg, parseKg } from './format';

describe('formatKg', () => {
  it.each([
    [87.5, '87.5'],
    [80, '80'],
    [-12.5, '−12.5'],
    [0, '0'],
  ])('%f shows as %s', (kg, text) => {
    expect(formatKg(kg)).toBe(text);
  });
});

describe('parseKg', () => {
  it.each([
    ['82.5', 82.5],
    ['82,5', 82.5],
    ['-10', -10],
    ['−10', -10],
    ['', null],
    ['abc', null],
  ])('%s parses to %s', (text, kg) => {
    expect(parseKg(text)).toBe(kg);
  });
});
