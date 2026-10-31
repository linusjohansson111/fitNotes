import type { Muscle } from '../domain/types';

export interface BodyMapProps {
  /** CSS colour per muscle. Muscles left out show as the plain body colour. */
  fills: Partial<Record<Muscle, string>>;
  onMuscle?: (muscle: Muscle) => void;
  /** Height in px of each figure. */
  height?: number;
}

/** Front and back figures side by side. */
export function BodyMap(_props: BodyMapProps) {
  return null;
}
