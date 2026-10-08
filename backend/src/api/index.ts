import { config } from '../core';
import { buildApp } from './app';

const app = await buildApp({ logger: { level: 'info' } });

try {
  await app.listen({ port: config.apiPort, host: '127.0.0.1' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
