// lib/docread/pdf.mjs — extractor nativo de texto de PDF (streams Flate), con tope de descompresión.

import { inflateRawSync, inflateSync } from 'node:zlib';
import { t } from '../i18n.mjs';
import { inflateLimited, MAX_PDF_TOTAL } from './zip.mjs';
import { tidy } from './text.mjs';

// Un stream que no se pudo descomprimir se lee tal cual solo si es pequeño: más allá es binario.
const RAW_STREAM_MAX = 4 * 1024 * 1024;

// ---------------------------------------------------------------- PDF

const PDF_ESCAPES = { n: '\n', r: '\n', t: '\t', b: '', f: '', '(': '(', ')': ')', '\\': '\\' };

// Cadena literal `( ... )` que empieza en `start` (el paréntesis): admite paréntesis anidados y los
// escapes de PDF, incluidos los octales. Devuelve el texto y el índice del último carácter leído.
function pdfLiteral(content, start) {
  let depth = 1;
  let s = '';
  let i = start + 1;
  for (; i < content.length && depth > 0; i++) {
    const ch = content[i];
    if (ch === '\\') {
      const next = content[++i];
      if (next >= '0' && next <= '7') {
        let oct = next;
        while (oct.length < 3 && content[i + 1] >= '0' && content[i + 1] <= '7') oct += content[++i];
        s += String.fromCharCode(parseInt(oct, 8));
      } else if (next !== '\n') s += PDF_ESCAPES[next] ?? next; // '\n' tras '\\' es continuación de línea
    } else if (ch === '(') { depth++; s += ch; }
    else if (ch === ')') { depth--; if (depth > 0) s += ch; }
    else s += ch;
  }
  return { s, end: i - 1 };
}

export function pdfStrings(content) {
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
      const lit = pdfLiteral(content, i);
      pending += lit.s;
      i = lit.end;
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
export function pdfToText(buf) {
  const chunks = [];
  const marker = Buffer.from('stream');
  let inflated = 0;
  let idx = buf.indexOf(marker, 0);
  while (idx >= 0) {
    let start = idx + marker.length;
    if (buf[start] === 0x0d) start++;
    if (buf[start] === 0x0a) start++;
    const end = buf.indexOf(Buffer.from('endstream'), start);
    if (end < 0) break;
    const raw = buf.subarray(start, end);
    let data = null;
    try { data = inflateLimited(inflateSync, raw); } catch (e) { if (e.message === t('docTooLarge')) throw e; /* no comprimido o filtro no soportado */ }
    if (!data) { try { data = inflateLimited(inflateRawSync, raw); } catch (e) { if (e.message === t('docTooLarge')) throw e; data = null; } }
    if (data && (inflated += data.length) > MAX_PDF_TOTAL) throw new Error(t('docTooLarge'));
    if (!data && raw.length < RAW_STREAM_MAX) data = raw;
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
