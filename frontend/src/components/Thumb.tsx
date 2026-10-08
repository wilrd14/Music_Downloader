import { useState } from 'react';
import { MusicIcon } from './icons';

interface Props {
  src: string | null;
  className?: string;
}

/** Thumbnail with graceful fallback to a placeholder icon. */
export default function Thumb({ src, className = 'h-12 w-12' }: Props) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) {
    return (
      <span
        aria-hidden="true"
        className={`flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-100 to-fuchsia-100 text-violet-600 dark:from-violet-950 dark:to-fuchsia-950 dark:text-violet-300 ${className}`}
      >
        <MusicIcon width={18} height={18} />
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={`shrink-0 rounded-lg bg-slate-200 object-cover dark:bg-slate-800 ${className}`}
    />
  );
}
