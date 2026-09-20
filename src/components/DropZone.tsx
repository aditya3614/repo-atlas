import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Drag-and-drop, file picker and paste all lead to the same place: a Blob that
 * the worker streams. Nothing is read on the main thread beyond a sniff.
 */
export function DropZone({ onInput }: { onInput: (blob: Blob, name: string) => void }) {
  const [over, setOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setOver(false);
      const file = e.dataTransfer.files[0];
      if (file) onInput(file, file.name);
      else {
        const text = e.dataTransfer.getData('text/plain');
        if (text) onInput(new Blob([text], { type: 'text/plain' }), 'pasted history');
      }
    },
    [onInput],
  );

  // Paste anywhere on the landing screen, as long as focus is not in a field.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
      const text = e.clipboardData?.getData('text/plain');
      if (text && text.trim().length > 0) {
        e.preventDefault();
        onInput(new Blob([text], { type: 'text/plain' }), 'pasted history');
      }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [onInput]);

  return (
    <div
      className={`drop ${over ? 'is-over' : ''}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
    >
      <input
        ref={inputRef}
        id="atlas-file"
        type="file"
        className="sr-only"
        accept=".txt,.log,text/plain"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onInput(file, file.name);
          e.target.value = '';
        }}
      />
      <label htmlFor="atlas-file" className="drop-label">
        <span className="drop-title">Drop <span className="mono">atlas.txt</span> here</span>
        <span className="label">or <span className="drop-link">choose a file</span> — you can also paste the output</span>
      </label>
    </div>
  );
}
