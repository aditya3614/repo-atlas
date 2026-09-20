import { AnimatePresence, motion } from 'framer-motion';
import { useUi } from '../store/ui';
import { transition, usePrefersReducedMotion } from '../lib/motion';

export function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const reduced = usePrefersReducedMotion();

  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            type="button"
            className={`toast ${t.tone === 'error' ? 'toast-error' : ''}`}
            onClick={() => dismiss(t.id)}
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
            transition={transition(reduced)}
          >
            {t.message}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  );
}
