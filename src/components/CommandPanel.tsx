import { useState } from 'react';
import { copyText } from '../lib/dom';
import { useUi } from '../store/ui';
import { DropZone } from './DropZone';

const BASE =
  "git -c core.quotepath=false log --reverse --no-merges -M --numstat \\\n  --format='@@@%n%H%n%an%n%ae%n%aI%n%s'";

const VARIANTS = {
  file: { label: 'Save to a file', cmd: `${BASE} > atlas.txt`, note: 'Then drop atlas.txt below.' },
  stdout: { label: 'Print to terminal', cmd: BASE, note: 'Then copy the output and paste it below.' },
} as const;

type VariantKey = keyof typeof VARIANTS;

export function CommandPanel({ onInput }: { onInput: (blob: Blob, name: string) => void }) {
  const [variant, setVariant] = useState<VariantKey>('file');
  const [copied, setCopied] = useState(false);
  const toast = useUi((s) => s.toast);
  const active = VARIANTS[variant];

  const copy = async () => {
    const ok = await copyText(active.cmd);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } else {
      toast('Could not reach the clipboard — select the command and copy it.', 'error');
    }
  };

  return (
    <div className="steps card">
      <ol className="step-list">
        <li className="step">
          <span className="step-n" aria-hidden="true">1</span>
          <div className="step-body">
            <h3 className="h3">Copy the command</h3>
            <div className="seg" role="tablist" aria-label="Command variant">
              {(Object.keys(VARIANTS) as VariantKey[]).map((k) => (
                <button
                  key={k}
                  role="tab"
                  type="button"
                  aria-selected={variant === k}
                  className={`seg-btn ${variant === k ? 'is-on' : ''}`}
                  onClick={() => setVariant(k)}
                >
                  {VARIANTS[k].label}
                </button>
              ))}
            </div>
            <div className="cmd">
              <pre className="mono cmd-text" tabIndex={0}>{active.cmd}</pre>
              <button type="button" className="btn btn-primary cmd-copy" onClick={copy}>
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
        </li>

        <li className="step">
          <span className="step-n" aria-hidden="true">2</span>
          <div className="step-body">
            <h3 className="h3">Run it in your repo’s root</h3>
            <p className="label">
              It writes commit metadata only — author, date, subject and line counts. {active.note}
            </p>
          </div>
        </li>

        <li className="step">
          <span className="step-n" aria-hidden="true">3</span>
          <div className="step-body">
            <h3 className="h3">Drop the file here</h3>
            <DropZone onInput={onInput} />
          </div>
        </li>
      </ol>
    </div>
  );
}
