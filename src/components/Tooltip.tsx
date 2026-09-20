import { useEffect, useRef, useState } from 'react';
import { atlasWorker } from '../lib/atlasClient';
import { compact, formatDate } from '../lib/format';
import type { FromWorker } from '../lib/protocol';
import { Sparkline } from './Sparkline';

export interface TooltipData {
  path: string;
  size: number;
  commits: number;
  lastTouch: number;
  fileId: number;
  x: number;
  y: number;
}

const SAMPLES = 40;

export function Tooltip({ data }: { data: TooltipData }) {
  const ref = useRef<HTMLDivElement>(null);
  const [spark, setSpark] = useState<Float32Array | null>(null);

  // The size history comes from the worker; a hover must not block on it.
  useEffect(() => {
    setSpark(null);
    const w = atlasWorker();
    const onMessage = (e: MessageEvent<FromWorker>) => {
      if (e.data.type === 'sparkline' && e.data.sparkline.fileId === data.fileId) {
        setSpark(e.data.sparkline.values);
      }
    };
    w.addEventListener('message', onMessage);
    w.postMessage({ type: 'sparkline', fileId: data.fileId, samples: SAMPLES });
    return () => w.removeEventListener('message', onMessage);
  }, [data.fileId]);

  // Positioned directly, so following the pointer never re-lays out the page.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 14;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const x = data.x + pad + w > window.innerWidth ? data.x - w - pad : data.x + pad;
    const y = data.y + pad + h > window.innerHeight ? data.y - h - pad : data.y + pad;
    el.style.transform = `translate(${Math.max(8, x)}px, ${Math.max(8, y)}px)`;
  }, [data.x, data.y, data.path, spark]);

  return (
    <div className="tip" ref={ref} role="presentation">
      <p className="tip-path mono">{data.path}</p>
      <dl className="tip-rows">
        <div>
          <dt>Size</dt>
          <dd className="mono">~{compact(data.size)} lines</dd>
        </div>
        <div>
          <dt>Commits</dt>
          <dd className="mono">{data.commits.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Last touched</dt>
          <dd className="mono">{formatDate(data.lastTouch)}</dd>
        </div>
      </dl>
      <Sparkline values={spark} width={196} height={28} />
      <p className="tip-foot tiny">Size is estimated from line counts.</p>
    </div>
  );
}
