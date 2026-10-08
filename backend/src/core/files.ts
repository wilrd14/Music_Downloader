/** Convierte texto arbitrario en un nombre de archivo seguro para Windows/Linux. */
export function sanitizeFileName(input: string, maxLength = 120): string {
  const cleaned = input
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  const cut = cleaned.slice(0, maxLength).trim().replace(/[. ]+$/, '');
  if (!cut) return 'audio';
  // Nombres reservados de Windows (CON, NUL, COM1...) no son válidos ni con extensión.
  return /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i.test(cut) ? `_${cut}` : cut;
}
