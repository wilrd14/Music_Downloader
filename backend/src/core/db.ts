import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config';
import type { AudioFormat, JobState, JobStatus, SourceKind, TrackInfo, TrackStatus } from './types';

/** Cola de trabajos persistente. La comparten la API y el worker (procesos distintos) vía SQLite en modo WAL. */

export interface JobRow {
  id: string;
  provider: string;
  source_url: string;
  title: string;
  kind: SourceKind;
  format: AudioFormat;
  thumbnail: string | null;
  status: JobStatus;
  error: string | null;
  created_at: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface TrackRow {
  job_id: string;
  idx: number;
  track_id: string;
  title: string;
  artist: string;
  duration_sec: number | null;
  thumbnail: string | null;
  url: string;
  status: TrackStatus;
  progress: number;
  error: string | null;
  file_path: string | null;
}

let db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (db) return db;
  fs.mkdirSync(config.dataDir, { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec(`
    PRAGMA busy_timeout = 5000;
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS jobs (
      id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      source_url TEXT NOT NULL,
      title TEXT NOT NULL,
      kind TEXT NOT NULL,
      format TEXT NOT NULL,
      thumbnail TEXT,
      status TEXT NOT NULL,
      error TEXT,
      created_at INTEGER NOT NULL,
      started_at INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status, created_at);
    CREATE TABLE IF NOT EXISTS tracks (
      job_id TEXT NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      track_id TEXT NOT NULL,
      title TEXT NOT NULL,
      artist TEXT NOT NULL,
      duration_sec INTEGER,
      thumbnail TEXT,
      url TEXT NOT NULL,
      status TEXT NOT NULL,
      progress REAL NOT NULL DEFAULT 0,
      error TEXT,
      file_path TEXT,
      PRIMARY KEY (job_id, idx)
    );
  `);
  return db;
}

export interface NewJob {
  id: string;
  provider: string;
  sourceUrl: string;
  title: string;
  kind: SourceKind;
  format: AudioFormat;
  thumbnail: string | null;
  tracks: TrackInfo[];
}

export function createJob(job: NewJob): void {
  const d = getDb();
  const insertJob = d.prepare(
    `INSERT INTO jobs (id, provider, source_url, title, kind, format, thumbnail, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?)`,
  );
  const insertTrack = d.prepare(
    `INSERT INTO tracks (job_id, idx, track_id, title, artist, duration_sec, thumbnail, url, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued')`,
  );
  d.exec('BEGIN');
  try {
    insertJob.run(job.id, job.provider, job.sourceUrl, job.title, job.kind, job.format, job.thumbnail, Date.now());
    job.tracks.forEach((t, i) =>
      insertTrack.run(job.id, i, t.id, t.title, t.artist, t.durationSec, t.thumbnail, t.url),
    );
    d.exec('COMMIT');
  } catch (err) {
    d.exec('ROLLBACK');
    throw err;
  }
}

/** Toma el siguiente trabajo en cola de forma atómica. */
export function claimNextJob(): JobRow | null {
  const row = getDb()
    .prepare(
      `UPDATE jobs SET status = 'running', started_at = ?
       WHERE id = (SELECT id FROM jobs WHERE status = 'queued' ORDER BY created_at, rowid LIMIT 1)
       RETURNING *`,
    )
    .get(Date.now());
  return (row as unknown as JobRow | undefined) ?? null;
}

export function getJobRow(id: string): JobRow | null {
  const row = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id);
  return (row as unknown as JobRow | undefined) ?? null;
}

export function getTrackRows(jobId: string): TrackRow[] {
  return getDb().prepare('SELECT * FROM tracks WHERE job_id = ? ORDER BY idx').all(jobId) as unknown as TrackRow[];
}

export function updateTrack(
  jobId: string,
  idx: number,
  patch: Partial<Pick<TrackRow, 'status' | 'progress' | 'error' | 'file_path'>>,
): void {
  const keys = Object.keys(patch) as (keyof typeof patch)[];
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE tracks SET ${sets} WHERE job_id = ? AND idx = ?`)
    .run(...keys.map((k) => patch[k] ?? null), jobId, idx);
}

export function finishJob(id: string, status: Extract<JobStatus, 'done' | 'failed'>, error: string | null = null): void {
  getDb().prepare('UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?').run(status, error, Date.now(), id);
}

/** Reencola trabajos que quedaron "running" por un cierre inesperado del worker. */
export function recoverInterruptedJobs(): number {
  const d = getDb();
  d.exec(`UPDATE tracks SET status = 'queued', progress = 0
          WHERE status IN ('downloading', 'converting')
            AND job_id IN (SELECT id FROM jobs WHERE status = 'running')`);
  const res = d.prepare(`UPDATE jobs SET status = 'queued' WHERE status = 'running'`).run();
  return Number(res.changes);
}

export function findExpiredJobIds(olderThanMs: number): string[] {
  const cutoff = Date.now() - olderThanMs;
  const rows = getDb()
    .prepare(`SELECT id FROM jobs WHERE status IN ('done', 'failed') AND finished_at < ?`)
    .all(cutoff) as unknown as { id: string }[];
  return rows.map((r) => r.id);
}

export function markExpired(id: string): void {
  const d = getDb();
  d.prepare(`UPDATE jobs SET status = 'expired' WHERE id = ?`).run(id);
  d.prepare('UPDATE tracks SET file_path = NULL WHERE job_id = ?').run(id);
}

export function getJobState(id: string): JobState | null {
  const job = getJobRow(id);
  if (!job) return null;
  const tracks = getTrackRows(id);

  const total = tracks.length || 1;
  const sum = tracks.reduce((acc, t) => acc + (t.status === 'done' || t.status === 'failed' ? 100 : t.progress), 0);
  const progress = job.status === 'done' || job.status === 'failed' ? 100 : Math.min(99, Math.round(sum / total));

  let queuePosition: number | null = null;
  if (job.status === 'queued') {
    const ahead = getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM jobs WHERE status = 'queued'
         AND (created_at < ? OR (created_at = ? AND rowid < (SELECT rowid FROM jobs WHERE id = ?)))`,
      )
      .get(job.created_at, job.created_at, job.id) as unknown as { n: number };
    queuePosition = ahead.n + 1;
  }

  return {
    id: job.id,
    status: job.status,
    kind: job.kind,
    title: job.title,
    thumbnail: job.thumbnail,
    format: job.format,
    progress,
    queuePosition,
    error: job.error,
    downloadReady: job.status === 'done' && tracks.some((t) => t.status === 'done'),
    tracks: tracks.map((t) => ({
      id: t.track_id,
      title: t.title,
      artist: t.artist,
      status: t.status,
      progress: Math.round(t.progress),
      error: t.error,
    })),
  };
}
