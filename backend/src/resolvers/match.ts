import { config, UserError } from '../core';
import { run } from './proc';
import type { CommandRunner } from './youtube';

export interface MatchQuery {
  title: string;
  artist: string;
  durationSec: number;
}

export interface YoutubeMatch {
  url: string;
  title: string;
  durationSec: number | null;
  score: number;
}

interface Candidate {
  title: string;
  channel?: string | null;
  durationSec: number | null;
}

/** Puntaje mínimo para aceptar un resultado; por debajo se considera 'sin coincidencia'. */
const MIN_SCORE = 55;

/** Palabras de relleno que no aportan a la comparación de títulos. */
const NOISE = new Set([
  'official', 'oficial', 'audio', 'video', 'videoclip', 'lyrics', 'lyric', 'letra', 'hd', 'hq', 'music', 'topic',
  'ft', 'feat', 'featuring', 'visualizer',
]);

/** Variantes no deseadas, salvo que la propia búsqueda las contenga. */
const BAD_VARIANTS = ['live', 'en vivo', 'cover', 'karaoke', 'remix', 'reaction', 'slowed', 'sped up', '8d', 'nightcore'];

/** minúsculas, sin acentos ni puntuación, espacios simples. */
function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const tokens = (s: string) => normalize(s).split(' ').filter((t) => t && !NOISE.has(t));

/** Fracción (0..1) de los tokens de `needle` presentes en `haystack`. */
function coverage(needle: string[], haystack: string[]): number {
  if (!needle.length) return 0;
  const set = new Set(haystack);
  return needle.filter((t) => set.has(t)).length / needle.length;
}

const hasPhrase = (normalized: string, phrase: string) => ` ${normalized} `.includes(` ${phrase} `);

function durationScore(wanted: number, got: number | null): number {
  if (got === null) return 10; // desconocida: neutral-baja
  const d = Math.abs(got - wanted);
  if (d <= 3) return 50;
  if (d <= 6) return 40;
  if (d <= 15) return 40 - (d - 6) * 3; // 37 .. 13
  return -40;
}

/** Puntaje de un candidato de YouTube frente a la pista de Spotify. Más alto = mejor. */
export function scoreCandidate(q: MatchQuery, c: Candidate): number {
  const title = normalize(c.title);
  const channel = normalize(c.channel ?? '');
  const artist = normalize(q.artist);
  let score = durationScore(q.durationSec, c.durationSec);

  // Título (hasta 30) y artista en título o canal (hasta 15).
  score += 30 * coverage(tokens(q.title), tokens(c.title));
  score += 15 * coverage(tokens(q.artist), [...tokens(c.title), ...tokens(c.channel ?? '')]);

  // Canales oficiales: "Artista - Topic" o que contienen el nombre del artista.
  if (/ topic$/.test(channel)) score += 15;
  else if (artist && channel.includes(artist)) score += 8;

  // Versiones no deseadas, salvo que se pidan en la búsqueda.
  const wanted = normalize(`${q.title} ${q.artist}`);
  for (const bad of BAD_VARIANTS) {
    if (hasPhrase(title, bad) && !hasPhrase(wanted, bad)) score -= 30;
  }
  return Math.round(score * 10) / 10;
}

interface SearchEntry {
  id?: string;
  title?: string;
  channel?: string | null;
  uploader?: string | null;
  duration?: number | null;
}

/** Busca en YouTube y devuelve el mejor candidato, o null si ninguno es suficientemente parecido. */
export async function findYoutubeMatch(q: MatchQuery, runCmd: CommandRunner = run): Promise<YoutubeMatch | null> {
  const res = await runCmd(
    config.ytDlpPath,
    ['-J', '--flat-playlist', '--no-warnings', '--', `ytsearch6:${q.artist} - ${q.title} audio`],
    { timeoutMs: 60_000 },
  );
  if (res.code !== 0) throw new UserError('No se pudo buscar la canción en YouTube.', 502);

  let info: { entries?: (SearchEntry | null)[] };
  try {
    info = JSON.parse(res.stdout) as typeof info;
  } catch {
    throw new UserError('No se pudo leer los resultados de búsqueda de YouTube.', 502);
  }

  let best: YoutubeMatch | null = null;
  for (const e of info.entries ?? []) {
    if (!e?.id || !e.title) continue;
    const durationSec = typeof e.duration === 'number' ? Math.round(e.duration) : null;
    const score = scoreCandidate(q, { title: e.title, channel: e.channel ?? e.uploader, durationSec });
    if (score >= MIN_SCORE && (!best || score > best.score)) {
      best = { url: `https://www.youtube.com/watch?v=${e.id}`, title: e.title, durationSec, score };
    }
  }
  return best;
}
