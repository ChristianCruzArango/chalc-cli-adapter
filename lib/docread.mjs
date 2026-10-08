// lib/docread.mjs — extrae texto de un documento (Word / PDF / md / txt / etc.) sin dependencias npm.
// Multiplataforma: .docx/.odt/.rtf/.html se leen con Node puro (zip + zlib); las herramientas del
// sistema (textutil, soffice, pdftotext) solo se usan como respaldo para formatos legacy.

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, basename } from 'node:path';
import { t } from './i18n.mjs';
import { isCompound } from './ole2.mjs';
import { xlsToSheets } from './xls.mjs';
import { zipEntries, zipRead } from './docread/zip.mjs';
import { docxToText, odtToText, htmlToText, rtfToText, xmlToText } from './docread/text.mjs';
import { colIndex, xlsxToSheets, sheetsToText } from './docread/sheets.mjs';
import { pdfToText } from './docread/pdf.mjs';
import { sh, convertWithSoffice, legacyOfficeToText } from './docread/external.mjs';

const PLAIN = new Set(['.txt', '.md', '.markdown', '.text', '.rst', '.adoc', '.csv', '.tsv', '']);
const LEGACY_OFFICE = new Set(['.doc', '.odp', '.ods', '.wordml', '.pages']);

// ---------------------------------------------------------------- API

// ¿Es un contenedor de Office que LibreOffice podría rescatar? Un ZIP con la estructura dañada, o
// un OLE2 (un .doc antiguo renombrado a .docx). Lo que no es ninguna de las dos cosas no es un
// documento: LibreOffice lo «convertiría» como texto plano y devolvería basura como si fuera la HU.
const isZip = (buf) => buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && (buf[2] === 3 || buf[2] === 5);
const rescuable = (buf) => isZip(buf) || isCompound(buf);

async function readWord(path, { convert }) {
  const buf = await readFile(path);
  try { return docxToText(buf); }
  catch (e) {
    const viaSoffice = rescuable(buf) ? await convert(path).catch(() => null) : null;
    if (viaSoffice) return viaSoffice;
    throw new Error(t('docReadFailWord', basename(path), e.message));
  }
}

async function readOdt(path) {
  const buf = await readFile(path);
  try { return odtToText(buf); }
  catch (e) { throw new Error(t('docReadFailOdt', basename(path), e.message)); }
}

async function readRtf(path, _opts, ext) {
  const text = rtfToText(await readFile(path, 'latin1'));
  return text || legacyOfficeToText(path, ext);
}

async function readPdf(path) {
  try {
    const out = sh('pdftotext', ['-layout', '-nopgbrk', path, '-']).trim();
    if (out) return out;
  } catch { /* no está pdftotext: sigo con el extractor nativo */ }
  const native = pdfToText(await readFile(path));
  if (native) return native;
  throw new Error(t('docPdfNoText', basename(path)));
}

// Hojas de cálculo: dos familias distintas bajo la misma intención. El .xlsx es ZIP+XML como el
// .docx; el .xls es OLE2+BIFF8. Si el parseo nativo falla, queda el respaldo externo (R8).
async function readSheets(path, convert, buf, parse) {
  let reason = t('docSheetsEmpty');
  try {
    const text = sheetsToText(parse(buf));
    if (text) return text;
  } catch (e) { reason = e.message; }
  const viaSoffice = await convert(path).catch(() => null);
  if (viaSoffice) return viaSoffice;
  throw new Error(t('docSheetsFail', basename(path), reason));
}

async function readXlsx(path, { convert }) {
  const buf = await readFile(path);
  // un .xlsx cifrado NO es un ZIP: Office lo envuelve en un contenedor OLE2
  if (isCompound(buf)) throw new Error(t('docXlsEncrypted'));
  return readSheets(path, convert, buf, xlsxToSheets);
}

async function readXls(path, { convert }) {
  return readSheets(path, convert, await readFile(path), xlsToSheets);
}

const readHtml = async (path) => htmlToText(await readFile(path, 'utf8'));
const readLegacy = (path, _opts, ext) => legacyOfficeToText(path, ext);

const HANDLERS = new Map([
  ...['.docx', '.docm', '.dotx'].map((e) => [e, readWord]),
  ['.odt', readOdt],
  ...['.html', '.htm', '.xhtml'].map((e) => [e, readHtml]),
  ['.rtf', readRtf],
  ...[...LEGACY_OFFICE].map((e) => [e, readLegacy]),
  ['.pdf', readPdf],
  ...['.xlsx', '.xlsm', '.xltx'].map((e) => [e, readXlsx]),
  ...['.xls', '.xlt'].map((e) => [e, readXls]),
]);

// `convert` es el respaldo con LibreOffice; se inyecta para poder probar las dos configuraciones
// (instalado o no) sin depender de lo que tenga la máquina.
export async function readDocument(path, { convert = convertWithSoffice } = {}) {
  if (!existsSync(path)) throw new Error(t('docNoFile', path));
  const ext = extname(path).toLowerCase();
  if (PLAIN.has(ext)) return (await readFile(path, 'utf8')).trim();
  const handler = HANDLERS.get(ext);
  if (handler) return handler(path, { convert }, ext);
  // desconocido: intento leerlo como texto
  try { return (await readFile(path, 'utf8')).trim(); }
  catch { throw new Error(t('docUnknownExt', ext)); }
}

export const _internals = { zipEntries, zipRead, docxToText, odtToText, htmlToText, rtfToText, pdfToText, xmlToText, xlsxToSheets, sheetsToText, colIndex };

