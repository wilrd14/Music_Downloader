export type SourceKind = 'track' | 'playlist';
export type AudioFormat = 'mp3' | 'm4a';
export const AUDIO_FORMATS: AudioFormat[] = ['mp3', 'm4a'];

export interface TrackInfo {
  id: string;
  title: string;
  artist: string;
  durationSec: number | null;
  thumbnail: string | null;
  url: string;
}

export interface ResolvedSource {
  provider: string;
  kind: SourceKind;
  title: string;
  thumbnail: string | null;
  sourceUrl: string;
  tracks: TrackInfo[];
}

export type TrackStatus = 'queued' | 'downloading' | 'converting' | 'done' | 'failed';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'expired';

export interface TrackState {
  id: string;
  title: string;
  artist: string;
  status: TrackStatus;
  progress: number;
  error: string | null;
}

export interface JobState {
  id: string;
  status: JobStatus;
  kind: SourceKind;
  title: string;
  thumbnail: string | null;
  format: AudioFormat;
  progress: number;
  queuePosition: number | null;
  error: string | null;
  downloadReady: boolean;
  /** Modo local: carpeta donde quedaron los archivos; null en modo servidor o si aún no se sabe. */
  savedTo: string | null;
  tracks: TrackState[];
}

export interface DownloadOptions {
  outDir: string;
  /** Nombre del archivo sin extensión. */
  fileBase: string;
  format: AudioFormat;
  onProgress(percent: number, phase: 'downloading' | 'converting'): void;
  signal?: AbortSignal;
}

/** Cada fuente (YouTube, YouTube Music, ...) implementa esta interfaz. */
export interface Resolver {
  readonly name: string;
  canHandle(url: string): boolean;
  resolve(url: string): Promise<ResolvedSource>;
  /** Descarga la pista y devuelve la ruta absoluta del archivo final. */
  download(track: TrackInfo, opts: DownloadOptions): Promise<string>;
}

export interface HealthState {
  ok: boolean;
  ytDlp: string | null;
  ffmpeg: boolean;
}
