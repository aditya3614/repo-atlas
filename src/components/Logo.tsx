/** Contour-ring mark: a repo read as terrain. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 28 28" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="26" height="26" rx="7" fill="none" stroke="currentColor" strokeOpacity="0.35" />
      <rect x="5.5" y="5.5" width="10" height="10" rx="2" fill="currentColor" fillOpacity="0.9" />
      <rect x="17" y="5.5" width="5.5" height="5.5" rx="1.5" fill="currentColor" fillOpacity="0.45" />
      <rect x="17" y="12.5" width="5.5" height="10" rx="1.5" fill="var(--accent)" />
      <rect x="5.5" y="17" width="10" height="5.5" rx="1.5" fill="currentColor" fillOpacity="0.3" />
    </svg>
  );
}
