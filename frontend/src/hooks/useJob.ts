import { useCallback, useEffect, useState } from 'react';
import { ApiError, getJob, subscribeJob } from '../api/client';
import type { JobState } from '../types';

const KEY = 'tunedrop:jobId';

function readStored(): string | null {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
}
function writeStored(id: string | null) {
  try {
    if (id) localStorage.setItem(KEY, id);
    else localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Tracks the current job: persists its id, resumes on load, and streams updates.
 * `resuming` is true while a stored job is being fetched on first load.
 */
export function useJob() {
  const [jobId, setJobId] = useState<string | null>(readStored);
  const [job, setJob] = useState<JobState | null>(null);
  const [resuming, setResuming] = useState<boolean>(() => readStored() !== null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    if (!jobId) {
      setJob(null);
      return;
    }
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const drop = () => {
      writeStored(null);
      setJobId(null);
      setJob(null);
    };

    getJob(jobId)
      .then((initial) => {
        if (cancelled) return;
        setResuming(false);
        if (initial.status === 'expired') return drop();
        setJob(initial);
        setConnectionError(null);
        if (initial.status === 'queued' || initial.status === 'running') {
          unsubscribe = subscribeJob(
            jobId,
            (s) => !cancelled && setJob(s),
            () => !cancelled && drop(),
          );
        }
      })
      .catch((e) => {
        if (cancelled) return;
        setResuming(false);
        if (e instanceof ApiError && (e.status === 404 || e.status === 410)) return drop();
        setConnectionError(e instanceof Error ? e.message : 'No se pudo recuperar la descarga.');
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, [jobId]);

  const start = useCallback((id: string) => {
    writeStored(id);
    setConnectionError(null);
    setResuming(false);
    setJob(null);
    setJobId(id);
  }, []);

  const reset = useCallback(() => {
    writeStored(null);
    setConnectionError(null);
    setJob(null);
    setJobId(null);
  }, []);

  return { jobId, job, resuming, connectionError, start, reset };
}
