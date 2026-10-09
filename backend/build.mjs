// Empaqueta el modo local en UN solo archivo ESM: dist/tunedrop.mjs (`node dist/tunedrop.mjs`).
// Los módulos integrados de Node (incluido node:sqlite) quedan como externos; todo lo demás se incluye.
import { build } from 'esbuild';

await build({
  entryPoints: ['src/local/index.ts'],
  outfile: 'dist/tunedrop.mjs',
  bundle: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  sourcemap: false,
  legalComments: 'none',
  logLevel: 'info',
  // Algunas dependencias (fastify, pino...) usan require() de módulos integrados dentro del bundle ESM.
  banner: { js: "import { createRequire as __tdCreateRequire } from 'node:module';\nconst require = __tdCreateRequire(import.meta.url);" },
});
