/** Weight for display: no trailing zeros, a real minus sign for assistance. */
export function formatKg(kg: number): string {
  const rounded = Math.round(kg * 100) / 100;
  return rounded < 0 ? `−${Math.abs(rounded)}` : String(rounded);
}

/** Parses typed weight. iPhones on a Swedish region type a decimal comma. */
export function parseKg(text: string): number | null {
  const trimmed = text.trim().replace(',', '.').replace('−', '-');
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}
