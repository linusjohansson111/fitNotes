import { useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'custom'; initialName?: string }
  | { name: 'log'; exerciseId: string; entryId?: string }
  | { name: 'exercise'; exerciseId: string }
  | { name: 'map' }
  | { name: 'settings' };

export function href(route: Route): string {
  switch (route.name) {
    case 'home':
      return '#/';
    case 'custom':
      return route.initialName ? `#/custom/${encodeURIComponent(route.initialName)}` : '#/custom';
    case 'log': {
      const base = `#/log/${encodeURIComponent(route.exerciseId)}`;
      return route.entryId ? `${base}/${encodeURIComponent(route.entryId)}` : base;
    }
    case 'exercise':
      return `#/exercise/${encodeURIComponent(route.exerciseId)}`;
    default:
      return `#/${route.name}`;
  }
}

export function parseRoute(hash: string): Route {
  const [name, first, second] = hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  if (name === 'search' || name === 'map' || name === 'settings') return { name };
  if (name === 'custom') return first ? { name, initialName: first } : { name };
  if (name === 'log' && first) return second ? { name, exerciseId: first, entryId: second } : { name, exerciseId: first };
  if (name === 'exercise' && first) return { name, exerciseId: first };
  return { name: 'home' };
}

export function go(route: Route): void {
  window.location.hash = href(route);
}

/**
 * `go`, with the new screen on the page before this returns. iOS raises the keyboard
 * only for a focus inside the tap, and the real hashchange event arrives after it.
 */
export function goWithinTap(route: Route): void {
  flushSync(() => {
    go(route);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

function subscribe(listener: () => void): () => void {
  window.addEventListener('hashchange', listener);
  return () => window.removeEventListener('hashchange', listener);
}

/** The current hash; compare or parse it with `parseRoute`. */
export function useRoute(): Route {
  return parseRoute(useSyncExternalStore(subscribe, () => window.location.hash));
}
