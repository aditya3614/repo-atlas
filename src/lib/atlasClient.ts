import type { FromWorker, InputError, Progress, Summary, ToWorker } from './protocol';

/**
 * Main-thread handle on the worker. One worker for the life of the tab: it
 * keeps the parsed dataset, and M2's layout requests go to the same instance.
 */

export interface LoadHandlers {
  onProgress: (p: Progress) => void;
  onDone: (s: Summary) => void;
  onError: (e: InputError) => void;
  onCancelled: () => void;
}

let worker: Worker | null = null;

export function atlasWorker(): Worker {
  worker ??= new Worker(new URL('../worker/atlas.worker.ts', import.meta.url), {
    type: 'module',
    name: 'repo-atlas',
  });
  return worker;
}

export function load(msg: Extract<ToWorker, { type: 'parse' }>, h: LoadHandlers): () => void {
  const w = atlasWorker();
  const onMessage = (e: MessageEvent<FromWorker>) => {
    const m = e.data;
    if (m.type === 'progress') h.onProgress(m.progress);
    else if (m.type === 'done') {
      w.removeEventListener('message', onMessage);
      h.onDone(m.summary);
    } else if (m.type === 'error') {
      w.removeEventListener('message', onMessage);
      h.onError(m.error);
    } else if (m.type === 'cancelled') {
      w.removeEventListener('message', onMessage);
      h.onCancelled();
    }
  };
  w.addEventListener('message', onMessage);
  w.postMessage(msg);

  return () => {
    // Stop listening first. The worker checks its cancel flag between reads,
    // but a parse that is already finishing would otherwise deliver `done`
    // after the user has cancelled and pull them into a view they left.
    w.removeEventListener('message', onMessage);
    w.postMessage({ type: 'cancel' } satisfies ToWorker);
  };
}
