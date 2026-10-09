export type SourceKind = 'track' | 'playlist';
export type AudioFormat = 'mp3' | 'm4a';
export interface TrackInfo { id: string; title: string; artist: string; durationSec: number | null; thumbnail: string | null; url: string; }
export interface ResolvedSource { provider: string; kind: SourceKind; title: string; thumbnail: string | null; sourceUrl: string; tracks: TrackInfo[]; }
export type ResolveResponse = ResolvedSource & { maxTracksPerJob: number };
export type TrackStatus = 'queued' | 'downloading' | 'converting' | 'done' | 'failed';
export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'expired';
export interface TrackState { id: string; title: string; artist: string; status: TrackStatus; progress: number; error: string | null; }
export interface JobState { id: string; status: JobStatus; kind: SourceKind; title: string; thumbnail: string | null; format: AudioFormat; progress: number; queuePosition: number | null; error: string | null; downloadReady: boolean; savedTo: string | null; tracks: TrackState[]; }
export type AppMode = 'local' | 'server';
export interface AppConfig { mode?: AppMode; downloadDir?: string | null; turnstileSiteKey?: string | null; }
export interface AppSettings { downloadDir: string; }
export interface HealthState { ok: boolean; ytDlp: string | null; ffmpeg: boolean; }
