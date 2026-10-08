import { memo } from 'react';
import type { TrackInfo } from '../types';
import { formatDuration } from '../lib/format';
import Thumb from './Thumb';

interface Props {
  track: TrackInfo;
  checked: boolean;
  disabled: boolean;
  onToggle: (id: string) => void;
}

function TrackRow({ track, checked, disabled, onToggle }: Props) {
  const inputId = `track-${track.id}`;
  return (
    <li>
      <label
        htmlFor={inputId}
        className={`flex items-center gap-3 rounded-xl px-2 py-2 transition focus-within:ring-2 focus-within:ring-violet-600 dark:focus-within:ring-violet-400 ${
          disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800/70'
        }`}
      >
        <input
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={() => onToggle(track.id)}
          className="h-5 w-5 shrink-0 cursor-[inherit] accent-violet-600"
        />
        <Thumb src={track.thumbnail} className="h-10 w-10" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{track.title}</span>
          <span className="block truncate text-xs text-slate-600 dark:text-slate-400">{track.artist}</span>
        </span>
        <span className="shrink-0 text-xs tabular-nums text-slate-600 dark:text-slate-400">
          {formatDuration(track.durationSec)}
        </span>
      </label>
    </li>
  );
}

export default memo(TrackRow);
