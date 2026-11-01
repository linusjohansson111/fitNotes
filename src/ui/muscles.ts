import type { Muscle } from '../domain/types';

/** Primary reads clearly brighter than secondary (AC3). */
export const PRIMARY_FILL = '#ffffff';
export const SECONDARY_FILL = '#636366';

/** BodyMap fills. A muscle listed as both reads as primary. */
export function muscleFills(primary: Muscle[], secondary: Muscle[]): Partial<Record<Muscle, string>> {
  const fills: Partial<Record<Muscle, string>> = {};
  for (const muscle of secondary) fills[muscle] = SECONDARY_FILL;
  for (const muscle of primary) fills[muscle] = PRIMARY_FILL;
  return fills;
}
