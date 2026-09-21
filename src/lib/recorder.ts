import { saveBlob } from './exportImage';

/**
 * Records the map as a WebM video.
 *
 * The map is two stacked canvases, so neither can be captured alone. A third
 * canvas composites them every frame and that one is captured. The compositing
 * only runs while recording.
 */

export interface RecorderHandle {
  stop: () => Promise<void>;
  cancel: () => void;
}

const TYPES = [
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
];

export function canRecord(): boolean {
  return (
    typeof MediaRecorder !== 'undefined' &&
    TYPES.some((t) => MediaRecorder.isTypeSupported(t))
  );
}

export function startRecording(
  base: HTMLCanvasElement,
  overlay: HTMLCanvasElement,
  fileName: string,
  onError: (message: string) => void,
): RecorderHandle | null {
  if (!canRecord()) {
    onError('This browser cannot record video from a canvas.');
    return null;
  }

  const composite = document.createElement('canvas');
  composite.width = base.width;
  composite.height = base.height;
  const ctx = composite.getContext('2d', { alpha: false });
  if (!ctx) {
    onError('Could not open a canvas to record into.');
    return null;
  }

  let raf = 0;
  const paint = () => {
    ctx.drawImage(base, 0, 0);
    ctx.drawImage(overlay, 0, 0);
    raf = requestAnimationFrame(paint);
  };
  paint();

  const mimeType = TYPES.find((t) => MediaRecorder.isTypeSupported(t))!;
  const stream = composite.captureStream(30);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.start(250);

  const teardown = () => {
    cancelAnimationFrame(raf);
    for (const track of stream.getTracks()) track.stop();
  };

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        recorder.onstop = () => {
          teardown();
          if (chunks.length > 0) saveBlob(new Blob(chunks, { type: mimeType }), `${fileName}.webm`);
          resolve();
        };
        if (recorder.state === 'inactive') {
          teardown();
          resolve();
        } else {
          recorder.stop();
        }
      }),
    cancel: () => {
      teardown();
      if (recorder.state !== 'inactive') recorder.stop();
      chunks.length = 0;
    },
  };
}
