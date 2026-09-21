import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { downloadShot, fileStem } from '../lib/exportImage';
import { canRecord, startRecording, type RecorderHandle } from '../lib/recorder';
import { clock, currentTime, notifyClock, seekToCommit } from '../map/clock';
import { useMap } from '../store/map';
import { useUi } from '../store/ui';
import { transition, usePrefersReducedMotion } from '../lib/motion';
import type { Summary } from '../lib/protocol';

/** Saving a picture or a recording. Both are produced in this tab. */
export function ExportMenu({ summary }: { summary: Summary }) {
  const [open, setOpen] = useState(false);
  const [recording, setRecording] = useState(false);
  const handle = useRef<RecorderHandle | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const toast = useUi((s) => s.toast);
  const theme = useUi((s) => s.theme);
  const reduced = usePrefersReducedMotion();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => window.removeEventListener('mousedown', onDown);
  }, [open]);

  const canvases = () => {
    const all = document.querySelectorAll<HTMLCanvasElement>('.map-wrap canvas');
    return { base: all[0] ?? null, overlay: all[1] ?? null };
  };

  const savePng = async () => {
    setOpen(false);
    const { base, overlay } = canvases();
    if (!base || !overlay) return;
    try {
      await downloadShot({
        base,
        overlay,
        summary,
        at: currentTime(),
        mode: useMap.getState().mode,
        root: useMap.getState().root,
        theme,
      });
      toast('Saved a PNG of the map.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the image.', 'error');
    }
  };

  const startVideo = () => {
    setOpen(false);
    const { base, overlay } = canvases();
    if (!base || !overlay) return;
    const h = startRecording(base, overlay, fileStem(summary.repo, useMap.getState().root), (m) =>
      toast(m, 'error'),
    );
    if (!h) return;
    handle.current = h;
    setRecording(true);
    // Record the history from the beginning, which is what people want.
    seekToCommit(0);
    clock.playing = true;
    notifyClock();
    toast('Recording. Press Stop when you have enough.');
  };

  const stopVideo = async () => {
    clock.playing = false;
    notifyClock();
    await handle.current?.stop();
    handle.current = null;
    setRecording(false);
    toast('Saved a WebM recording.');
  };

  // Stop cleanly if the view goes away mid-recording.
  useEffect(() => () => handle.current?.cancel(), []);

  if (recording) {
    return (
      <button type="button" className="btn btn-ghost rec" onClick={stopVideo}>
        <span className="rec-dot" aria-hidden="true" />
        Stop recording
      </button>
    );
  }

  return (
    <div className="menu-wrap" ref={box}>
      <button
        type="button"
        className="btn btn-ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        Export
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu"
            role="menu"
            initial={reduced ? { opacity: 0 } : { opacity: 0, y: -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={transition(reduced)}
          >
            <button type="button" role="menuitem" className="menu-item" onClick={savePng}>
              <span>Save the map as a PNG</span>
              <span className="tiny menu-note">Current view, with the date on it</span>
            </button>
            <button
              type="button"
              role="menuitem"
              className="menu-item"
              onClick={startVideo}
              disabled={!canRecord()}
            >
              <span>Record the playback as WebM</span>
              <span className="tiny menu-note">
                {canRecord()
                  ? 'Plays from the first commit; stop whenever you like'
                  : 'This browser cannot record a canvas'}
              </span>
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
