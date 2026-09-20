import { motion } from 'framer-motion';
import { Logo } from '../components/Logo';
import { useAtlas } from '../store/atlas';
import { formatCount } from '../lib/dom';
import { transition, usePrefersReducedMotion } from '../lib/motion';
import '../styles/loading.css';

export function Loading({ onCancel }: { onCancel: () => void }) {
  const progress = useAtlas((s) => s.progress);
  const reduced = usePrefersReducedMotion();

  const pct = progress.totalBytes > 0 ? Math.min(1, progress.bytes / progress.totalBytes) : 0;

  return (
    <motion.div
      className="loading"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={transition(reduced)}
    >
      <div className="loading-box">
        <div className="brand loading-brand">
          <Logo size={22} />
          <span className="brand-name">Repo Atlas</span>
        </div>

        <p className="label loading-kicker">Reading your history</p>

        <p className="loading-counts mono" aria-live="polite">
          Read {formatCount(progress.commits)} commits, {formatCount(progress.files)} files
        </p>

        <div
          className="bar"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(pct * 100)}
          aria-label="Parsing progress"
        >
          <div className="bar-fill" style={{ transform: `scaleX(${pct})` }} />
        </div>

        <div className="loading-foot">
          <span className="tiny">Nothing is uploaded — this is your browser reading a local file.</span>
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </motion.div>
  );
}
