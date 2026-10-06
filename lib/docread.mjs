// lib/docread.mjs — extrae texto de un documento (Word / PDF / md / txt / etc.) sin dependencias npm.
// Multiplataforma: .docx/.odt/.rtf/.html se leen con Node puro (zip + zlib); las herramientas del
// sistema (textutil, soffice, pdftotext) solo se usan como respaldo para formatos legacy.

import { readFile, mkdtemp, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, basename, join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { inflateRawSync, inflateSync } from 'node:zlib';
import { t } from './i18n.mjs';
import { isCompound } from './ole2.mjs';
import { xlsToSheets } from './xls.mjs';

const PLAIN = new Set(['.txt', '.md', '.markdown', '.text', '.rst', '.adoc', '.csv', '.tsv', '']);
const LEGACY_OFFICE = new Set(['.doc', '.odp', '.ods', '.wordml', '.pages']);

function sh(cmd, args) {
  return execFileSync(cmd, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

// ---------------------------------------------------------------- ZIP (OOXML/ODF)

function findEocd(buf) {
  const max = Math.min(buf.length, 66 * 1024);
  for (let i = buf.length - 22; i >= buf.length - max && i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) return i;
  }
  return -1;
}

/** Lista las entradas del directorio central de un ZIP. */
function zipEntries(buf) {
  const eocd = findEocd(buf);
  if (eocd < 0) throw new Error(t('docNotZip'));
  let count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  // ZIP64: los campos de 32 bits vienen saturados y hay que leer el EOCD64.
  if (offset === 0xffffffff || count === 0xffff) {
    const loc = eocd - 20;
    if (loc >= 0 && buf.readUInt32LE(loc) === 0x07064b50) {
      const eocd64 = Number(buf.readBigUInt64LE(loc + 8));
      if (buf.readUInt32LE(eocd64) === 0x06064b50) {
        count = Number(buf.readBigUInt64LE(eocd64 + 32));
        offset = Number(buf.readBigUInt64LE(eocd64 + 48));
      }
    }
  }
  const entries = [];
  let p = offset;
  for (let i = 0; i < count && p + 46 <= buf.length; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.push({ name, method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Devuelve el contenido (utf8) de la primera entrada cuyo nombre coincide. */
function zipRead(buf, matcher) {
  const entry = zipEntries(buf).find((e) => matcher(e.name.toLowerCase().replace(/^\/+/, '')));
  if (!entry) return null;
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error(t('docZipHeader'));
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.subarray(start, start + entry.compSize);
  if (entry.method === 0) return raw.toString('utf8');
  if (entry.method === 8) return inflateRawSync(raw).toString('utf8');
  throw new Error(t('docZipMethod', entry.method));
}

// ---------------------------------------------------------------- XML → texto

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeXml(s) {
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

function tidy(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((l) => l.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Recorre un XML y arma el texto. `opts.textIn` limita la captura a elementos
 * concretos (Word guarda el texto solo en <w:t>); si es null captura todo (ODF).
 */
function xmlToText(xml, { textIn = null, newlineAfter = [], tabAfter = [], voidMarks = {} } = {}) {
  const out = [];
  let depthInText = 0;
  const re = /<[^>]*>/g;
  let last = 0;
  let m;
  const local = (name) => name.replace(/^[^:]*:/, '').toLowerCase();
  while ((m = re.exec(xml))) {
    const chunk = xml.slice(last, m.index);
    if (chunk && (!textIn || depthInText > 0)) out.push(decodeXml(chunk));
    last = re.lastIndex;
    const tag = m[0].slice(1, -1);
    if (!tag || tag[0] === '?' || tag[0] === '!') continue;
    const closing = tag[0] === '/';
    const selfClosing = tag.endsWith('/');
    const name = local(tag.replace(/^\//, '').split(/[\s/>]/)[0]);
    if (voidMarks[name] && !closing) out.push(voidMarks[name]);
    if (textIn && textIn.has(name) && !selfClosing) depthInText += closing ? -1 : 1;
    if (depthInText < 0) depthInText = 0;
    if (closing && newlineAfter.includes(name)) out.push('\n');
    if (closing && tabAfter.includes(name)) out.push('\t');
  }
  const tail = xml.slice(last);
  if (tail && !textIn) out.push(decodeXml(tail));
  // las celdas dejan restos "\n\t" / "\t\n" al cerrar párrafo y celda a la vez
  const joined = out.join('').replace(/\n+\t/g, '\t').replace(/\t+\n/g, '\n').replace(/\t{2,}/g, '\t');
  return tidy(joined);
}

function docxToText(buf) {
  const parts = [];
  const main = zipRead(buf, (n) => n === 'word/document.xml');
  if (main == null) throw new Error(t('docNoDocumentXml'));
  parts.push(main);
  for (const extra of ['word/footnotes.xml', 'word/endnotes.xml']) {
    try {
      const xml = zipRead(buf, (n) => n === extra);
      if (xml) parts.push(xml);
    } catch { /* opcional */ }
  }
  const text = parts
    .map((xml) =>
      xmlToText(xml, {
        textIn: new Set(['t', 'delttext']),
        newlineAfter: ['p', 'tr'],
        tabAfter: ['tc'],
        voidMarks: { tab: '\t', br: '\n', cr: '\n' },
      })
    )
    .filter(Boolean)
    .join('\n\n');
  return tidy(text);
}

function odtToText(buf) {
  const xml = zipRead(buf, (n) => n === 'content.xml');
  if (xml == null) throw new Error(t('docNoContentXml'));
  const body = xml.replace(/<office:automatic-styles[\s\S]*?<\/office:automatic-styles>/g, '');
  return xmlToText(body, {
    newlineAfter: ['p', 'h', 'table-row', 'list-item'],
    tabAfter: ['table-cell'],
    voidMarks: { tab: '\t', 'line-break': '\n', s: ' ' },
  });
}

function htmlToText(html) {
  const stripped = html
    .replace(/<(script|style|head)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(br|hr)\b[^>]*>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|blockquote|pre)>/gi, '\n')
    .replace(/<\/t[dh]>/gi, '\t')
    .replace(/<[^>]+>/g, '');
  return tidy(decodeXml(stripped).replace(/\t+\n/g, '\n').replace(/[ \t]{2,}/g, ' '));
}

// grupos de RTF que no son texto del documento
const RTF_DEST = /^\{\\(?:\*|(?:fonttbl|colortbl|stylesheet|info|pict|nonshppict|listtable|listoverridetable|rsidtbl|filetbl|xmlnstbl|themedata|colorschememapping|latentstyles|datastore|fldinst|generator)\b)/;

function skipRtfGroup(s, i) {
  let depth = 0;
  for (; i < s.length; i++) {
    if (s[i] === '\\') { i++; continue; }
    if (s[i] === '{') depth++;
    else if (s[i] === '}' && --depth === 0) return i + 1;
  }
  return s.length;
}

function stripRtfGroups(s) {
  let out = '';
  let i = 0;
  while (i < s.length) {
    if (s[i] === '{' && RTF_DEST.test(s.slice(i, i + 40))) { i = skipRtfGroup(s, i); continue; }
    out += s[i++];
  }
  return out;
}

function rtfToText(rtf) {
  let s = stripRtfGroups(rtf); // fonttbl, colortbl, info, imágenes…
  s = s.replace(/\\'([0-9a-fA-F]{2})/g, (_, h) => Buffer.from(h, 'hex').toString('latin1'));
  s = s.replace(/\\u(-?\d+)\s?\??/g, (_, n) => String.fromCharCode(((+n % 65536) + 65536) % 65536));
  s = s.replace(/\\(par|line|sect)\b\s?/g, '\n');
  s = s.replace(/\\tab\b\s?/g, '\t');
  s = s.replace(/\\[a-zA-Z]+-?\d*\s?/g, ''); // resto de control words
  s = s.replace(/[{}]/g, '').replace(/\\([\\{}])/g, '$1');
  return tidy(s);
}

// ---------------------------------------------------------------- hojas de cálculo (OOXML)

/** Índice de columna a partir de la referencia de celda: "A1" -> 0, "BC12" -> 54. */
function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break; // el primer dígito corta las letras
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Texto plano de un fragmento XML: solo lo que hay dentro de <t>…</t>. */
function xmlTextNodes(xml) {
  let out = '';
  for (const m of xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)) out += decodeXml(m[1]);
  return out;
}

/** Tabla de cadenas compartidas de un .xlsx: una entrada por cada <si>. */
function xlsxSharedStrings(buf) {
  const xml = zipRead(buf, (n) => n === 'xl/sharedstrings.xml');
  if (!xml) return [];
  return [...xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => xmlTextNodes(m[1]));
}

/** Nombre de cada hoja y el archivo que la contiene, en el orden del libro. */
function xlsxSheetRefs(buf) {
  const wb = zipRead(buf, (n) => n === 'xl/workbook.xml');
  if (!wb) return [];
  const rels = zipRead(buf, (n) => n === 'xl/_rels/workbook.xml.rels') || '';
  const target = new Map();
  for (const m of rels.matchAll(/<Relationship\b[^>]*>/g)) {
    const id = /Id="([^"]+)"/.exec(m[0])?.[1];
    const to = /Target="([^"]+)"/.exec(m[0])?.[1];
    if (id && to) target.set(id, to.replace(/^\/?(xl\/)?/, 'xl/').toLowerCase());
  }
  const refs = [];
  let fallback = 0;
  for (const m of wb.matchAll(/<sheet\b[^>]*\/?>/g)) {
    const name = decodeXml(/name="([^"]*)"/.exec(m[0])?.[1] ?? '');
    const rid = /r:id="([^"]+)"/.exec(m[0])?.[1];
    fallback += 1;
    refs.push({ name, path: (rid && target.get(rid)) || `xl/worksheets/sheet${fallback}.xml` });
  }
  return refs;
}

/** Lee un .xlsx y devuelve sus hojas con datos: `[{ name, rows }]`, igual que xlsToSheets. */
function xlsxToSheets(buf) {
  const sst = xlsxSharedStrings(buf);
  const out = [];
  for (const ref of xlsxSheetRefs(buf)) {
    const xml = zipRead(buf, (n) => n === ref.path);
    if (!xml) continue;
    const rows = [];
    let maxCol = -1;
    for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const index = Number(/r="(\d+)"/.exec(rowMatch[0])?.[1] ?? rows.length + 1) - 1;
      const line = [];
      let auto = 0;
      for (const cell of rowMatch[1].matchAll(/<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const attrs = cell[1];
        const body = cell[2] ?? '';
        const ref2 = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const col = ref2 ? colIndex(ref2) : auto;
        auto = col + 1;
        const type = /t="([^"]+)"/.exec(attrs)?.[1];
        const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let value = '';
        if (type === 's') value = sst[Number(raw)] ?? '';
        else if (type === 'inlineStr') value = xmlTextNodes(body);
        else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
        else if (type === 'e') value = '';
        else if (raw != null) value = decodeXml(raw);
        value = String(value).trim();
        if (!value) continue;
        while (line.length < col) line.push('');
        line[col] = value;
        if (col > maxCol) maxCol = col;
      }
      while (rows.length < index) rows.push([]);
      rows[index] = line;
    }
    while (rows.length && rows.at(-1).length === 0) rows.pop();
    if (rows.some((r) => r.length)) out.push({ name: ref.name, rows });
  }
  return out;
}

/** Hojas -> texto: una cabecera por hoja y filas separadas por tabuladores. */
function sheetsToText(sheets) {
  return tidy(
    sheets
      .map((s) => [t('docSheet', s.name), ...s.rows.map((r) => r.join('\t'))].join('\n'))
      .join('\n\n')
  );
}

// ---------------------------------------------------------------- PDF

function pdfStrings(content) {
  const out = [];
  let pending = '';
  const flush = (suffix = '') => {
    if (pending) out.push(pending);
    pending = '';
    if (suffix) out.push(suffix);
  };
  for (let i = 0; i < content.length; i++) {
    const c = content[i];
    if (c === '(') {
      let depth = 1;
      let s = '';
      i++;
      for (; i < content.length && depth > 0; i++) {
        const ch = content[i];
        if (ch === '\\') {
          const next = content[++i];
          const map = { n: '\n', r: '\n', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' };
          if (next >= '0' && next <= '7') {
            let oct = next;
            while (oct.length < 3 && content[i + 1] >= '0' && content[i + 1] <= '7') oct += content[++i];
            s += String.fromCharCode(parseInt(oct, 8));
          } else if (next === '\n') { /* continuación de línea */ }
          else s += map[next] ?? next;
        } else if (ch === '(') { depth++; s += ch; }
        else if (ch === ')') { depth--; if (depth > 0) s += ch; }
        else s += ch;
      }
      i--;
      pending += s;
      continue;
    }
    if (c === '<' && content[i + 1] !== '<') {
      const end = content.indexOf('>', i);
      if (end < 0) break;
      const hex = content.slice(i + 1, end).replace(/[^0-9a-fA-F]/g, '');
      pending += Buffer.from(hex.length % 2 ? hex + '0' : hex, 'hex').toString('latin1');
      i = end;
      continue;
    }
    if (c === 'T' && (content[i + 1] === 'j' || content[i + 1] === 'J')) { flush(); i++; continue; }
    if (c === 'T' && (content[i + 1] === '*' || content[i + 1] === 'd' || content[i + 1] === 'D')) { flush('\n'); i++; continue; }
    if ((c === "'" || c === '"') && pending) { flush('\n'); continue; }
    if (c === 'E' && content.slice(i, i + 2) === 'ET') { flush('\n'); i++; continue; }
  }
  flush();
  return out.join('');
}

// caracteres de control / reemplazo: si abundan, lo extraído no es texto legible
const GARBAGE_RE = new RegExp('[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\ufffd]', 'g');

/** Extractor de PDF en Node puro: sirve para PDFs de texto con fuentes estándar. */
function pdfToText(buf) {
  const chunks = [];
  const marker = Buffer.from('stream');
  let idx = buf.indexOf(marker, 0);
  while (idx >= 0) {
    let start = idx + marker.length;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf(Buffer.from('endstream'), start);
    if (end < 0) break;
    const raw = buf.subarray(start, end);
    let data = null;
    try { data = inflateSync(raw); } catch { /* no comprimido o filtro no soportado */ }
    if (!data) { try { data = inflateRawSync(raw); } catch { data = null; } }
    if (!data && raw.length < 4 * 1024 * 1024) data = raw;
    if (data) {
      const s = data.toString('latin1');
      if (/(\bTj\b|\bTJ\b|\bTd\b|\bTf\b)/.test(s)) chunks.push(pdfStrings(s));
    }
    idx = buf.indexOf(marker, end + 1);
  }
  const text = tidy(chunks.join('\n'));
  if (!text || text.length < 20) return '';
  const garbage = (text.match(GARBAGE_RE) || []).length;
  if (garbage / text.length > 0.05) return ''; // fuentes CID: sale basura, mejor avisar
  return text;
}

// ---------------------------------------------------------------- respaldos externos

function sofficeCandidates() {
  const list = ['soffice', 'libreoffice'];
  if (process.platform === 'win32') {
    list.push('C:\\Program Files\\LibreOffice\\program\\soffice.exe');
    list.push('C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe');
  }
  return list;
}

async function convertWithSoffice(path) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-doc-'));
  try {
    for (const bin of sofficeCandidates()) {
      try {
        sh(bin, ['--headless', '--convert-to', 'txt:Text', '--outdir', dir, path]);
      } catch { continue; }
      const files = await readdir(dir);
      const txt = files.find((f) => f.toLowerCase().endsWith('.txt'));
      if (txt) return (await readFile(join(dir, txt), 'utf8')).trim();
    }
    return null;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

async function legacyOfficeToText(path, ext) {
  if (process.platform === 'darwin') {
    try { return sh('textutil', ['-convert', 'txt', '-stdout', path]).trim(); } catch { /* sigo */ }
  }
  const viaSoffice = await convertWithSoffice(path);
  if (viaSoffice) return viaSoffice;
  if (ext === '.doc') {
    try { return sh('antiword', [path]).trim(); } catch { /* sigo */ }
  }
  throw new Error(t('docLegacyNoTool', basename(path), ext));
}

// ---------------------------------------------------------------- API

export async function readDocument(path) {
  if (!existsSync(path)) throw new Error(t('docNoFile', path));
  const ext = extname(path).toLowerCase();

  if (PLAIN.has(ext)) return (await readFile(path, 'utf8')).trim();

  if (ext === '.docx' || ext === '.docm' || ext === '.dotx') {
    const buf = await readFile(path);
    try { return docxToText(buf); }
    catch (e) {
      const viaSoffice = await convertWithSoffice(path).catch(() => null);
      if (viaSoffice) return viaSoffice;
      throw new Error(t('docReadFailWord', basename(path), e.message));
    }
  }

  if (ext === '.odt') {
    const buf = await readFile(path);
    try { return odtToText(buf); }
    catch (e) { throw new Error(t('docReadFailOdt', basename(path), e.message)); }
  }

  if (ext === '.html' || ext === '.htm' || ext === '.xhtml') {
    return htmlToText(await readFile(path, 'utf8'));
  }

  if (ext === '.rtf') {
    const text = rtfToText(await readFile(path, 'latin1'));
    if (text) return text;
    return legacyOfficeToText(path, ext);
  }

  if (LEGACY_OFFICE.has(ext)) return legacyOfficeToText(path, ext);

  if (ext === '.pdf') {
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
  if (ext === '.xlsx' || ext === '.xlsm' || ext === '.xltx') {
    const buf = await readFile(path);
    // un .xlsx cifrado NO es un ZIP: Office lo envuelve en un contenedor OLE2
    if (isCompound(buf)) throw new Error(t('docXlsEncrypted'));
    try {
      const text = sheetsToText(xlsxToSheets(buf));
      if (text) return text;
    } catch (e) {
      const viaSoffice = await convertWithSoffice(path).catch(() => null);
      if (viaSoffice) return viaSoffice;
      throw new Error(t('docSheetsFail', basename(path), e.message));
    }
    const viaSoffice = await convertWithSoffice(path).catch(() => null);
    if (viaSoffice) return viaSoffice;
    throw new Error(t('docSheetsFail', basename(path), t('docSheetsEmpty')));
  }

  if (ext === '.xls' || ext === '.xlt') {
    const buf = await readFile(path);
    try {
      const text = sheetsToText(xlsToSheets(buf));
      if (text) return text;
    } catch (e) {
      const viaSoffice = await convertWithSoffice(path).catch(() => null);
      if (viaSoffice) return viaSoffice;
      throw new Error(t('docSheetsFail', basename(path), e.message));
    }
    const viaSoffice = await convertWithSoffice(path).catch(() => null);
    if (viaSoffice) return viaSoffice;
    throw new Error(t('docSheetsFail', basename(path), t('docSheetsEmpty')));
  }

  // desconocido: intento leerlo como texto
  try { return (await readFile(path, 'utf8')).trim(); }
  catch { throw new Error(t('docUnknownExt', ext)); }
}

export const _internals = { zipEntries, zipRead, docxToText, odtToText, htmlToText, rtfToText, pdfToText, xmlToText, xlsxToSheets, sheetsToText, colIndex };
