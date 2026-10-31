import { useSyncExternalStore } from 'react';
import { today } from '../domain/date';
import type { ISODate } from '../domain/types';

function subscribe(listener: () => void): () => void {
  document.addEventListener('visibilitychange', listener);
  return () => document.removeEventListener('visibilitychange', listener);
}

/** Today, rechecked on every return to the app: iOS can keep it open for days. */
export function useToday(): ISODate {
  return useSyncExternalStore(subscribe, () => today());
}
