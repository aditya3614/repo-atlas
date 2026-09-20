import type { ReactNode } from 'react';
import type { InputError } from '../lib/protocol';

export function ErrorState({ error, onRetry }: { error: InputError; onRetry: () => void }) {
  return (
    <div className="state card state-error" role="alert">
      <span className="chip chip-error">Could not read this file</span>
      <h3 className="h2 state-title">{error.title}</h3>
      {error.detail && <p className="body state-detail">{error.detail}</p>}
      {error.offending !== undefined && (
        <pre className="mono state-line">
          {error.line !== undefined && <span className="state-lineno">line {error.line}</span>}
          {error.offending || '(empty line)'}
        </pre>
      )}
      <p className="label state-hint">{error.hint}</p>
      <button type="button" className="btn btn-secondary" onClick={onRetry}>
        Try another file
      </button>
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: ReactNode;
}) {
  return (
    <div className="state card">
      <h3 className="h3 state-title">{title}</h3>
      <p className="label state-detail">{body}</p>
      {action}
    </div>
  );
}
