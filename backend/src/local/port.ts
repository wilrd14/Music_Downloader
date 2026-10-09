/**
 * Intenta escuchar en `start`, `start + 1`... (hasta `attempts` puertos seguidos) y devuelve el primero libre.
 * `listen` es inyectable: en la app real llama a `app.listen({ host: '127.0.0.1', port })`.
 */
export async function listenOnFreePort(
  listen: (port: number) => Promise<unknown>,
  start: number,
  attempts = 10,
): Promise<number> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const port = start + i;
    if (port > 65535) break;
    try {
      await listen(port);
      return port;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code !== 'EADDRINUSE' && code !== 'EACCES') throw err;
      lastError = err;
    }
  }
  throw new Error(`No hay ningún puerto libre entre ${start} y ${Math.min(start + attempts - 1, 65535)}.`, { cause: lastError });
}
