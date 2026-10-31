import type { ComponentProps } from 'react';
import { goWithinTap, href } from './nav';

/** Opens search inside the tap, so that iOS raises the keyboard for its input. */
export function SearchLink(props: ComponentProps<'a'>) {
  const route = { name: 'search' } as const;
  return (
    <a
      {...props}
      href={href(route)}
      onClick={(event) => {
        event.preventDefault();
        goWithinTap(route);
      }}
    />
  );
}
