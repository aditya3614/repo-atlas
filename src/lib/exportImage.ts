import { formatDate } from './format';
import type { Summary } from './protocol';

/**
 * Compose the two map canvases into one image with a title, the date on the
 * playhead and the estimate caveat, then hand it to the browser as a download.
 *
 * Everything happens on a canvas in this tab. Nothing is uploaded.
 */

const PAD = 40;
const HEADER = 96;
const FOOTER = 56;

export interface ShotOptions {
  base: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  summary: Summary;
  /** Date currently on the playhead. */
  at: number;
  mode: string;
  root: string;
  theme: 'night' | 'paper';
}

function tokens() {
  const cs = getComputedStyle(document.documentElement);
  return {
    bg: cs.getPropertyValue('--bg').trim(),
    text: cs.getPropertyValue('--text').trim(),
    muted: cs.getPropertyValue('--text-muted').trim(),
    faint: cs.getPropertyValue('--text-faint').trim(),
    hairline: cs.getPropertyValue('--hairline').trim(),
    accent: cs.getPropertyValue('--accent').trim(),
  };
}

export function composeShot(o: ShotOptions): HTMLCanvasElement {
  const t = tokens();
  // The map canvases are already at device resolution; keep that for the file.
  const mapW = o.base.width;
  const mapH = o.base.height;
  const scale = mapW / Math.max(1, o.base.clientWidth);

  const out = document.createElement('canvas');
  out.width = mapW + PAD * 2 * scale;
  out.height = mapH + (HEADER + FOOTER) * scale;
  const ctx = out.getContext('2d')!;
  ctx.scale(scale, scale);
  const w = out.width / scale;

  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, w, out.height / scale);

  // --- header ---
  ctx.fillStyle = t.text;
  ctx.font = '700 26px Inter, sans-serif';
  ctx.textBaseline = 'alphabetic';
  const title = o.root === '' ? o.summary.repo : `${o.summary.repo} / ${o.root}`;
  ctx.fillText(title, PAD, 46);

  ctx.fillStyle = t.muted;
  ctx.font = '400 13px "Source Code Pro", monospace';
  const line = [
    formatDate(o.at),
    `${o.summary.commits.toLocaleString()} commits`,
    `${o.summary.files.toLocaleString()} files`,
    `coloured by ${o.mode}`,
  ].join('  ·  ');
  ctx.fillText(line, PAD, 68);

  ctx.strokeStyle = t.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PAD, HEADER - 14);
  ctx.lineTo(w - PAD, HEADER - 14);
  ctx.stroke();

  // --- the map itself, both layers ---
  ctx.drawImage(o.base, PAD, HEADER, mapW / scale, mapH / scale);
  ctx.drawImage(o.overlay, PAD, HEADER, mapW / scale, mapH / scale);

  // --- footer ---
  const footY = HEADER + mapH / scale + 26;
  ctx.fillStyle = t.faint;
  ctx.font = '400 12px Inter, sans-serif';
  ctx.fillText(
    'File sizes are estimated from commit line counts, never measured. Made with Repo Atlas.',
    PAD,
    footY,
  );

  return out;
}

export async function downloadShot(o: ShotOptions): Promise<void> {
  const canvas = composeShot(o);
  const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
  if (!blob) throw new Error('The browser could not produce a PNG.');
  saveBlob(blob, `${fileStem(o.summary.repo, o.root)}.png`);
}

export function fileStem(repo: string, root: string): string {
  const parts = [repo, root.replace(/\//g, '-')].filter(Boolean).join('-');
  return `repo-atlas-${parts.replace(/[^a-z0-9-_]+/gi, '-').replace(/-+/g, '-')}`;
}

/** Hands a blob to the browser as a file. No network involved. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick so the download has certainly started.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
