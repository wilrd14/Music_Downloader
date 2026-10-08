import assert from 'node:assert/strict';
import { test } from 'node:test';
import { UserError } from '../core';
import { findYoutubeMatch, scoreCandidate, type MatchQuery } from './match';
import type { RunResult } from './proc';

const q: MatchQuery = { title: 'Tití Me Preguntó', artist: 'Bad Bunny', durationSec: 243 };
const ok = (entries: unknown[]): RunResult => ({ code: 0, stdout: JSON.stringify({ entries }), stderr: '' });

test('prefiere el upload Topic con la duración correcta frente a un en vivo', async () => {
  let args: string[] = [];
  const m = await findYoutubeMatch(q, async (_cmd, a) => {
    args = a;
    return ok([
      { id: 'live1', title: 'Bad Bunny - Tití Me Preguntó (Live)', channel: 'BadBunnyVEVO', duration: 301 },
      { id: 'cover', title: 'Tití Me Preguntó cover', channel: 'Alguien', duration: 244 },
      { id: 'topic', title: 'Tití Me Preguntó', channel: 'Bad Bunny - Topic', duration: 244 },
    ]);
  });
  assert.equal(m?.url, 'https://www.youtube.com/watch?v=topic');
  assert.equal(m?.durationSec, 244);
  assert.ok(args.includes('-J') && args.includes('--flat-playlist'));
  assert.ok(args.includes('ytsearch6:Bad Bunny - Tití Me Preguntó audio'));
});

test('devuelve null si nada se parece', async () => {
  const m = await findYoutubeMatch(q, async () =>
    ok([
      { id: 'a', title: 'Otra canción distinta', channel: 'X', duration: 100 },
      { id: 'b', title: 'Tití Me Preguntó', channel: 'Y', duration: 600 },
    ]),
  );
  assert.equal(m, null);
});

test('resultados vacíos o sin entries', async () => {
  assert.equal(await findYoutubeMatch(q, async () => ok([])), null);
  assert.equal(await findYoutubeMatch(q, async () => ({ code: 0, stdout: '{}', stderr: '' })), null);
  assert.equal(await findYoutubeMatch(q, async () => ok([null, { title: 'sin id' }])), null);
});

test('duración desconocida: acepta si título y canal coinciden, pero puntúa menos', async () => {
  const c = { title: 'Tití Me Preguntó', channel: 'Bad Bunny - Topic' };
  assert.ok(scoreCandidate(q, { ...c, durationSec: null }) < scoreCandidate(q, { ...c, durationSec: 243 }));
  const m = await findYoutubeMatch(q, async () => ok([{ id: 'n', ...c }]));
  assert.equal(m?.url, 'https://www.youtube.com/watch?v=n');
  assert.equal(m?.durationSec, null);
  // Sin duración y sin pistas de título/canal no alcanza.
  assert.equal(await findYoutubeMatch(q, async () => ok([{ id: 'z', title: 'Nada que ver', channel: 'Z' }])), null);
});

test('no penaliza "live" si la búsqueda lo contiene', () => {
  const live: MatchQuery = { title: 'Song (Live)', artist: 'Band', durationSec: 200 };
  const c = { title: 'Band - Song (Live)', channel: 'Band', durationSec: 200 };
  assert.ok(scoreCandidate(live, c) > scoreCandidate({ ...live, title: 'Song' }, c));
});

test('puntaje: la duración domina', () => {
  const base = { title: 'Tití Me Preguntó', channel: 'Bad Bunny - Topic' };
  const s = (d: number) => scoreCandidate(q, { ...base, durationSec: d });
  assert.ok(s(243) >= s(248) && s(248) > s(255) && s(255) > s(300));
});

test('error de yt-dlp o JSON inválido -> UserError', async () => {
  await assert.rejects(
    findYoutubeMatch(q, async () => ({ code: 1, stdout: '', stderr: 'boom' })),
    (e: unknown) => e instanceof UserError && e.status === 502,
  );
  await assert.rejects(findYoutubeMatch(q, async () => ({ code: 0, stdout: 'no json', stderr: '' })), UserError);
});
