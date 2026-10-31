/**
 * The published denominator crosses zero near 1.75 kg, and the curve stops being
 * monotonic in weight below about 4 kg. At or above 5 it is continuous and strictly
 * increasing, because df/dw = 1 + x(d - 4.58)/d^2 stays positive while d > 4.58.
 */
const MIN_DENOMINATOR = 5;

/** Estimated one-rep max of `reps` at `weight`, on the fitNotes starting curve. */
export function e1rm(weight: number, reps: number): number {
  const denominator = Math.max(MIN_DENOMINATOR, -2.55 + 4.58 * Math.log(weight));
  return weight * (1 + Math.max(reps - 1, 0) ** 0.85 / denominator);
}

/** The weight whose e1rm at `reps` equals `strength`: `e1rm` inverted by bisection. */
export function weightFor(strength: number, reps: number): number {
  let low = 0;
  let high = strength; // e1rm(w, r) >= w, so the answer cannot exceed the strength.
  for (let i = 0; i < 50; i++) {
    const middle = (low + high) / 2;
    if (e1rm(middle, reps) < strength) low = middle;
    else high = middle;
  }
  return (low + high) / 2;
}
