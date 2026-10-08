import type { AudioFormat, HealthState, JobState, ResolveResponse } from '../types';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('No se pudo conectar con el servicio. Inténtalo de nuevo en unos instantes.', 0);
  }
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (!res.ok) {
    const msg =
      data && typeof data === 'object' && 'error' in data && typeof (data as { error: unknown }).error === 'string'
        ? (data as { error: string }).error
        : `Error inesperado del servidor (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data as T;
}

export const getHealth = () => request<HealthState>('/api/health');

export const resolveUrl = (url: string) =>
  request<ResolveResponse>('/api/resolve', { method: 'POST', body: JSON.stringify({ url }) });

export const createJob = (url: string, format: AudioFormat, trackIds?: string[]) =>
  request<{ id: string }>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify(trackIds ? { url, format, trackIds } : { url, format }),
  });

export const getJob = (id: string) => request<JobState>(`/api/jobs/${encodeURIComponent(id)}`);

export const downloadUrl = (id: string) => `/api/jobs/${encodeURIComponent(id)}/download`;

const isFinal = (s: JobState) => s.status === 'done' || s.status === 'failed' || s.status === 'expired';

/**
 * Subscribe to job updates via SSE. Falls back to polling every second
 * if EventSource errors repeatedly. Returns an unsubscribe function.
 */
export function subscribeJob(
  id: string,
  onState: (s: JobState) => void,
  onFatal: (err: ApiError) => void,
): () => void {
  let closed = false;
  let es: EventSource | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let errors = 0;

  const stop = () => {
    closed = true;
    es?.close();
    es = null;
    if (pollTimer) clearTimeout(pollTimer);
  };

  const poll = async () => {
    if (closed) return;
    try {
      const s = await getJob(id);
      if (closed) return;
      onState(s);
      if (isFinal(s)) {
        stop();
        return;
      }
    } catch (e) {
      if (closed) return;
      if (e instanceof ApiError && e.status === 404) {
        stop();
        onFatal(e);
        return;
      }
    }
    pollTimer = setTimeout(poll, 1000);
  };

  const startPolling = () => {
    es?.close();
    es = null;
    void poll();
  };

  if (typeof EventSource === 'undefined') {
    startPolling();
  } else {
    es = new EventSource(`/api/jobs/${encodeURIComponent(id)}/events`);
    es.onmessage = (ev) => {
      errors = 0;
      try {
        const s = JSON.parse(ev.data) as JobState;
        onState(s);
        if (isFinal(s)) stop();
      } catch {
        /* ignore malformed frame */
      }
    };
    es.onerror = () => {
      if (closed) return;
      errors += 1;
      if (errors >= 3) startPolling();
    };
  }

  return stop;
}
