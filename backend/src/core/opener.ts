import { spawn } from 'node:child_process';

/** Orden del sistema para abrir una carpeta o una URL en la aplicación predeterminada. */
export interface OpenCommand {
  cmd: string;
  args: string[];
}

/**
 * Comando para abrir `target` (una carpeta o una URL http local) según el sistema. Siempre un binario con
 * argumentos, nunca una cadena para un shell: `target` no puede inyectar comandos.
 * En Windows `explorer.exe <ruta|url>` abre la carpeta o el navegador predeterminado.
 */
export function openCommand(target: string, platform: NodeJS.Platform = process.platform): OpenCommand {
  if (platform === 'win32') return { cmd: 'explorer.exe', args: [target] };
  if (platform === 'darwin') return { cmd: 'open', args: [target] };
  return { cmd: 'xdg-open', args: [target] };
}

/** Lanza el comando en segundo plano, sin shell. Resuelve cuando el proceso arrancó; rechaza si no existe el binario. */
export function openWithSystem(target: string, platform: NodeJS.Platform = process.platform): Promise<void> {
  const { cmd, args } = openCommand(target, platform);
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { shell: false, detached: true, stdio: 'ignore', windowsHide: false });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}
