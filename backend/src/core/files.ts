/**
 * Convierte texto arbitrario en un nombre de archivo seguro para Windows/Linux.
 * Quita también los caracteres invisibles de formato (control C1, espacio de ancho cero, marcas y anulaciones de
 * dirección como U+202E «RLO»; se conservan U+200C/U+200D, necesarios en persa o en emojis compuestos): permiten disfrazar el nombre (p. ej. que `Tema‮gpj.3pm` se vea como
 * «Tema mp3.jpg») o hacerlo invisible.
 */
export function sanitizeFileName(input: string, maxLength = 120): string {
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/[\u007f-\u009f­؜᠎​‎‏‪-‮⁠-⁯﻿￹-￻]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const cut = cleaned.slice(0, maxLength).trim().replace(/[. ]+$/, '');
  if (!cut) return 'audio';
  // Nombres reservados de Windows (CON, NUL, COM1, COM¹...) no son válidos ni con extensión.
  return /^(con|prn|aux|nul|com[\d¹²³]|lpt[\d¹²³])(\..*)?$/i.test(cut) ? `_${cut}` : cut;
}
