// Entrada de línea de comandos del worker (`npm run start:worker`, modo servidor con procesos separados).
// La lógica vive en start.ts para poder arrancarla desde otro proceso (modo local, src/local/index.ts)
// sin efectos secundarios al importar.
import { startWorker } from './start';

export { startWorker, cleanup, type WorkerHandle, type WorkerOptions } from './start';

startWorker();
