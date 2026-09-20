import { useEffect, useState } from 'react';
import { Streamgraph } from './Streamgraph';
import {
  clock,
  currentTime,
  notifyClock,
  seekToCommit,
  SPEEDS,
  subscribeClock,
  toggleQuiet,
  type Speed,
} from '../map/clock';
import { formatCount } from '../lib/dom';
import { formatDate } from '../lib/format';
import type { Summary, Tables, TimelinePayload } from '../lib/protocol';
import type { Palette } from '../map/colors';

/** Re-renders at the clock's notify rate, not per frame. */
function useClockTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => subscribeClock(() => setTick((t) => t + 1)), []);
  return tick;
}

export function Dock({
  summary,
  timeline,
  tables,
  pal,
  onSeek,
}: {
  summary: Summary;
  timeline: TimelinePayload | null;
  tables: Tables;
  pal: Palette;
  onSeek: () => void;
}) {
  useClockTick();

  const play = () => {
    // Playing from the end starts over rather than doing nothing.
    if (!clock.playing && clock.commit >= clock.commits - 1) seekToCommit(0);
    clock.playing = !clock.playing;
    notifyClock();
    onSeek();
  };

  const step = (n: number) => {
    clock.playing = false;
    seekToCommit(clock.commit + n);
    notifyClock();
    onSeek();
  };

  return (
    <div className="dock">
      <div className="dock-controls">
        <div className="transport">
          <button
            type="button"
            className="tbtn tbtn-main"
            onClick={play}
            aria-label={clock.playing ? 'Pause (space)' : 'Play (space)'}
            title={clock.playing ? 'Pause — space' : 'Play — space'}
          >
            {clock.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button
            type="button"
            className="tbtn"
            onClick={() => step(-1)}
            aria-label="Step back one commit"
            title="Back one commit — ←"
          >
            <StepIcon back />
          </button>
          <button
            type="button"
            className="tbtn"
            onClick={() => step(1)}
            aria-label="Step forward one commit"
            title="Forward one commit — →"
          >
            <StepIcon />
          </button>
        </div>

        <div className="seg seg-sm" role="radiogroup" aria-label="Playback speed">
          {SPEEDS.map((s: Speed) => (
            <button
              key={s}
              type="button"
              role="radio"
              aria-checked={clock.speed === s}
              className={`seg-btn ${clock.speed === s ? 'is-on' : ''}`}
              onClick={() => {
                clock.speed = s;
                notifyClock();
              }}
              title={s === 1 ? 'The whole history in about 45 seconds' : `${s}x`}
            >
              {s}x
            </button>
          ))}
        </div>

        <label className="toggle" title="Compress gaps longer than a few typical ones">
          <input
            type="checkbox"
            checked={clock.skipQuiet}
            onChange={(e) => toggleQuiet(e.target.checked)}
          />
          <span>Skip quiet periods</span>
          {timeline && timeline.quietGaps > 0 && (
            <span className="tiny toggle-note">
              {formatCount(timeline.quietGaps)} gap{timeline.quietGaps === 1 ? '' : 's'}
            </span>
          )}
        </label>

        <div className="now">
          <span className="mono now-date">{formatDate(currentTime())}</span>
          <span className="mono tiny now-commit">
            commit {formatCount(clock.commit + 1)} of {formatCount(summary.commits)}
          </span>
        </div>
      </div>

      {timeline ? (
        <Streamgraph timeline={timeline} tables={tables} pal={pal} onSeek={onSeek} />
      ) : (
        <div className="stream stream-empty">
          <span className="tiny">Building the timeline…</span>
        </div>
      )}
    </div>
  );
}

function PlayIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d="M3 1.5 L12 7 L3 12.5 Z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <rect x="3" y="2" width="3" height="10" fill="currentColor" />
      <rect x="8" y="2" width="3" height="10" fill="currentColor" />
    </svg>
  );
}
function StepIcon({ back = false }: { back?: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <g transform={back ? 'scale(-1,1) translate(-14,0)' : undefined}>
        <path d="M3 2.5 L9.5 7 L3 11.5 Z" fill="currentColor" />
        <rect x="10" y="2.5" width="1.8" height="9" fill="currentColor" />
      </g>
    </svg>
  );
}
