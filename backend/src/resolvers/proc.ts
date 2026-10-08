import { spawn, type ChildProcess } from 'node:child_process';
import { UserError } from '../core';

export interface RunOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Se invoca por cada línea de stdout. */
  onLine?: (line: string) => void;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Mata el proceso y sus hijos (en Windows `kill()` no alcanza a ffmpeg). */
function killTree(child: ChildProcess): void {
  if (process.platform === 'win32' && child.pid) {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
  } else {
    child.kill();
  }
}

/** Ejecuta un binario sin shell y devuelve su salida. Nunca interpreta los argumentos. */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      windowsHide: true,
      signal: opts.signal,
      // En Windows yt-dlp usaría la codepage local para stdout; forzamos UTF-8.
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', PYTHONUTF8: '1' },
    });
    let stdout = '';
    let stderr = '';
    let buffer = '';
    let timedOut = false;

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(child);
        }, opts.timeoutMs)
      : null;

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');

    child.stdout.on('data', (chunk: string) => {
      if (opts.onLine) {
        buffer += chunk;
        const lines = buffer.split(/\r?\n|\r/);
        buffer = lines.pop() ?? '';
        lines.forEach((l) => l && opts.onLine!(l));
      } else {
        stdout += chunk;
      }
    });
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-8000);
    });

    child.on('error', (err: NodeJS.ErrnoException) => {
      if (timer) clearTimeout(timer);
      if (err.code === 'ENOENT') {
        reject(new UserError(`No se encontró "${cmd}". Instálalo o define su ruta en .env.`, 503));
      } else if (err.name === 'AbortError') {
        reject(new UserError('Descarga cancelada.', 499));
      } else {
        reject(err);
      }
    });

    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (buffer && opts.onLine) opts.onLine(buffer);
      if (timedOut) return reject(new UserError('La operación tardó demasiado y fue cancelada.', 504));
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}
