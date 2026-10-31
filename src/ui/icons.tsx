import type { ReactNode } from 'react';

function Icon({ size = 24, children }: { size?: number; children: ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

export function HomeIcon() {
  return (
    <Icon>
      <path d="M3 11l9-8 9 8" />
      <path d="M5 9.5V21h14V9.5" />
    </Icon>
  );
}

export function PlusIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M12 4v16M4 12h16" />
    </Icon>
  );
}

export function MinusIcon({ size }: { size?: number }) {
  return (
    <Icon size={size}>
      <path d="M4 12h16" />
    </Icon>
  );
}

export function BodyIcon() {
  return (
    <Icon>
      <circle cx="12" cy="5" r="2.5" />
      <path d="M12 9.5V15M5 10.5h14M12 15l-3.5 6M12 15l3.5 6" />
    </Icon>
  );
}

export function SettingsIcon() {
  return (
    <Icon size={22}>
      <path d="M4 7h9M18 7h2M4 17h2M11 17h9" />
      <circle cx="15.5" cy="7" r="2.5" />
      <circle cx="8.5" cy="17" r="2.5" />
    </Icon>
  );
}

export function GraphIcon() {
  return (
    <Icon size={20}>
      <path d="M3 18l6-7 4 4 8-10" />
    </Icon>
  );
}
