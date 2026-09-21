import { useId } from 'react';

/** Four rounded tiles in a pink gradient: a repo read as territory. */
export function Logo({ size = 28 }: { size?: number }) {
  const id = useId();
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff9cc2" />
          <stop offset="1" stopColor="#ee4f8d" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="14" height="14" rx="4" fill={`url(#${id})`} />
      <rect x="18" y="2" width="8" height="8" rx="2.5" fill={`url(#${id})`} fillOpacity="0.6" />
      <rect x="18" y="12" width="8" height="14" rx="2.5" fill={`url(#${id})`} fillOpacity="0.85" />
      <rect x="2" y="18" width="14" height="8" rx="2.5" fill={`url(#${id})`} fillOpacity="0.4" />
    </svg>
  );
}
