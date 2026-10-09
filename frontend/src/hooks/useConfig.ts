import { useEffect, useState } from 'react';
import { getConfig } from '../api/client';
import type { AppConfig } from '../types';

/**
 * Carga /api/config una vez. `config` es null mientras carga; si falla o no trae `mode`
 * se asume modo servidor (compatibilidad con el backend anterior).
 */
export function useConfig() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [downloadDir, setDownloadDir] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getConfig()
      .then((c) => {
        if (!alive) return;
        setConfig({ ...c, mode: c.mode === 'local' ? 'local' : 'server' });
        setDownloadDir(c.downloadDir ?? null);
      })
      .catch(() => alive && setConfig({ mode: 'server', turnstileSiteKey: null }));
    return () => {
      alive = false;
    };
  }, []);

  return {
    /** null mientras se carga. */
    config,
    loaded: config !== null,
    isLocal: config?.mode === 'local',
    downloadDir,
    setDownloadDir,
  };
}
