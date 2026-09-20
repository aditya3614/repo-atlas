import { useEffect, useState } from 'react';

export const EASE = [0.22, 1, 0.36, 1] as const;
export const DUR = { fast: 0.25, mid: 0.32, slow: 0.45 } as const;

const QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia(QUERY);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/** Framer transition honouring reduced motion (crossfade only, no movement). */
export function transition(reduced: boolean, duration = DUR.mid) {
  return reduced ? { duration: 0.12, ease: 'linear' as const } : { duration, ease: EASE };
}
