// lib/docread.mjs — extrae texto de un documento (Word / PDF / md / txt / etc.) sin dependencias npm.
// Usa herramientas del sistema cuando hace falta (textutil en macOS, pdftotext si está).

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import { execFileSync } from 'node:child_process';

const PLAIN = new Set(['.txt', '.md', '.markdown', '.text', '.rst', '.adoc', '.csv', '.tsv', '']);
const OFFICE = new Set(['.docx', '.doc', '.rtf', '.odt', '.html', '.htm', '.wordml']);

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}

export async function readDocument(path) {
  if (!existsSync(path)) throw new Error(`No existe el archivo: ${path}`);
  const ext = extname(path).toLowerCase();

  if (PLAIN.has(ext)) return (await readFile(path, 'utf8')).trim();

  if (OFFICE.has(ext)) {
    try { return sh('textutil', ['-convert', 'txt', '-stdout', path]).trim(); }
    catch (e) { throw new Error(`No pude leer ${ext} con textutil (¿estás en macOS?). Exporta a .txt/.md. (${e.message})`); }
  }

  if (ext === '.pdf') {
    try { return sh('pdftotext', ['-layout', '-nopgbrk', path, '-']).trim(); }
    catch {
      throw new Error('Para PDF necesito `pdftotext` (instálalo con `brew install poppler`) o exporta el PDF a .txt/.md.');
    }
  }

  if (ext === '.xlsx' || ext === '.xls') {
    throw new Error('Excel binario no se lee sin dependencias. Exporta la hoja a .csv (Archivo → Guardar como CSV).');
  }

  // desconocido: intento leerlo como texto
  try { return (await readFile(path, 'utf8')).trim(); }
  catch { throw new Error(`No sé leer "${ext}". Usa .txt, .md, .docx o .pdf, o pega el texto.`); }
}
