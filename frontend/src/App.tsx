import { useState } from 'react';
import { ApiError, createJob, resolveUrl } from './api/client';
import type { AudioFormat, ResolveResponse } from './types';
import { useTheme } from './hooks/useTheme';
import { useHealth } from './hooks/useHealth';
import { useJob } from './hooks/useJob';
import Header from './components/Header';
import Footer from './components/Footer';
import HealthBanner from './components/HealthBanner';
import UrlForm from './components/UrlForm';
import SourcePreview from './components/SourcePreview';
import JobProgress from './components/JobProgress';
import Skeleton from './components/Skeleton';
import { Spinner } from './components/icons';

const msg = (e: unknown) => (e instanceof ApiError || e instanceof Error ? e.message : 'Ocurrió un error inesperado.');

export default function App() {
  const { theme, toggle } = useTheme();
  const health = useHealth();
  const { job, jobId, resuming, connectionError, start, reset } = useJob();

  const [source, setSource] = useState<ResolveResponse | null>(null);
  const [sourceUrl, setSourceUrl] = useState('');
  const [format, setFormat] = useState<AudioFormat>('mp3');
  const [resolving, setResolving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [jobError, setJobError] = useState<string | null>(null);

  const handleResolve = async (url: string) => {
    setResolving(true);
    setResolveError(null);
    setSource(null);
    try {
      const res = await resolveUrl(url);
      setSourceUrl(url);
      setSource(res);
    } catch (e) {
      setResolveError(msg(e));
    } finally {
      setResolving(false);
    }
  };

  const handleConfirm = async (trackIds: string[] | undefined) => {
    setSubmitting(true);
    setJobError(null);
    try {
      const { id } = await createJob(sourceUrl, format, trackIds);
      setSource(null);
      start(id);
    } catch (e) {
      setJobError(msg(e));
    } finally {
      setSubmitting(false);
    }
  };

  const handleNew = () => {
    reset();
    setSource(null);
    setResolveError(null);
    setJobError(null);
  };

  const showJob = jobId !== null && !resuming;

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-clip">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-96 bg-gradient-to-b from-violet-200/60 via-fuchsia-100/30 to-transparent dark:from-violet-900/30 dark:via-fuchsia-950/20"
      />
      <Header theme={theme} onToggleTheme={toggle} />
      <HealthBanner status={health} />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 pb-8">
        {!showJob && (
          <div className="py-8 text-center sm:py-12">
            <h1 className="text-4xl font-extrabold tracking-tight sm:text-5xl">
              Tu música,{' '}
              <span className="bg-gradient-to-r from-violet-600 to-fuchsia-600 bg-clip-text text-transparent dark:from-violet-400 dark:to-fuchsia-400">
                en un clic
              </span>
            </h1>
            <p className="mx-auto mt-3 max-w-md text-base text-slate-600 dark:text-slate-300">
              Descarga canciones y playlists de YouTube, o canciones y álbumes de Spotify, como audio MP3 o M4A. Gratis y sin registro.
            </p>
          </div>
        )}

        {resuming && (
          <div role="status" className="flex items-center justify-center gap-2 py-10 text-slate-600 dark:text-slate-300">
            <Spinner />
            Recuperando tu descarga…
          </div>
        )}

        {connectionError && !resuming && (
          <div
            role="alert"
            className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/60 dark:text-amber-100"
          >
            <span>{connectionError}</span>
            <button
              type="button"
              onClick={handleNew}
              className="rounded-lg px-2.5 py-1 font-semibold underline focus-visible:outline-2 focus-visible:outline-violet-600"
            >
              Nueva descarga
            </button>
          </div>
        )}

        {showJob && job && <JobProgress job={job} onNew={handleNew} />}
        {showJob && !job && !connectionError && <Skeleton label="Cargando descarga" />}

        {!showJob && !resuming && (
          <div className="space-y-6">
            <UrlForm
              loading={resolving}
              error={resolveError}
              onDismissError={() => setResolveError(null)}
              onSubmit={handleResolve}
            />
            {resolving && <Skeleton label="Buscando información del enlace" />}
            {source && !resolving && (
              <SourcePreview
                key={source.sourceUrl + source.tracks.length}
                source={source}
                format={format}
                onFormatChange={setFormat}
                submitting={submitting}
                error={jobError}
                onDismissError={() => setJobError(null)}
                onConfirm={handleConfirm}
                onCancel={handleNew}
              />
            )}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
