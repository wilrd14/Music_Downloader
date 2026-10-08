import { useEffect, useState } from 'react';
import { getHealth } from '../api/client';
import type { HealthState } from '../types';

export type HealthStatus =
  | { state: 'loading' }
  | { state: 'offline' }
  | { state: 'ready'; health: HealthState };

export function useHealth(): HealthStatus {
  const [status, setStatus] = useState<HealthStatus>({ state: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((health) => !cancelled && setStatus({ state: 'ready', health }))
      .catch(() => !cancelled && setStatus({ state: 'offline' }));
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
