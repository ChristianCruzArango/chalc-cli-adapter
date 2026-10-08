// lib/docread/sheets.mjs — hojas de cálculo OOXML (.xlsx) a filas, con los límites reales de Excel.

import { t } from '../i18n.mjs';
import { zipRead, MAX_ROWS, MAX_COLS, MAX_CELLS } from './zip.mjs';
import { decodeXml, tidy } from './text.mjs';
import { elements, startTags } from '../markup.mjs';

// ---------------------------------------------------------------- hojas de cálculo (OOXML)

/** Índice de columna a partir de la referencia de celda: "A1" -> 0, "BC12" -> 54. */
export function colIndex(ref) {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break; // el primer dígito corta las letras
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

/** Texto plano de un fragmento XML: solo lo que hay dentro de <t>…</t>. */
export function xmlTextNodes(xml) {
  let out = '';
  for (const { body } of elements(xml, 't')) out += decodeXml(body);
  return out;
}

/** Tabla de cadenas compartidas de un .xlsx: una entrada por cada <si>. */
function xlsxSharedStrings(buf) {
  const xml = zipRead(buf, (n) => n === 'xl/sharedstrings.xml');
  if (!xml) return [];
  return [...elements(xml, 'si')].map(({ body }) => xmlTextNodes(body));
}

/** Nombre de cada hoja y el archivo que la contiene, en el orden del libro. */
function xlsxSheetRefs(buf) {
  const wb = zipRead(buf, (n) => n === 'xl/workbook.xml');
  if (!wb) return [];
  const rels = zipRead(buf, (n) => n === 'xl/_rels/workbook.xml.rels') || '';
  const target = new Map();
  for (const attrs of startTags(rels, 'Relationship')) {
    const id = /Id="([^"]+)"/.exec(attrs)?.[1];
    const to = /Target="([^"]+)"/.exec(attrs)?.[1];
    if (id && to) target.set(id, to.replace(/^\/?(xl\/)?/, 'xl/').toLowerCase());
  }
  const refs = [];
  let fallback = 0;
  for (const attrs of startTags(wb, 'sheet')) {
    const name = decodeXml(/name="([^"]*)"/.exec(attrs)?.[1] ?? '');
    const rid = /r:id="([^"]+)"/.exec(attrs)?.[1];
    fallback += 1;
    refs.push({ name, path: (rid && target.get(rid)) || `xl/worksheets/sheet${fallback}.xml` });
  }
  return refs;
}

// Texto de una celda según su tipo (`t`): cadena compartida, en línea, booleano, error o valor.
function cellValue(attrs, body, sst) {
  const type = /t="([^"]+)"/.exec(attrs)?.[1];
  const raw = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
  let value = '';
  if (type === 's') value = sst[Number(raw)] ?? '';
  else if (type === 'inlineStr') value = xmlTextNodes(body);
  else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
  else if (type !== 'e' && raw != null) value = decodeXml(raw);
  return String(value).trim();
}

/** Lee un .xlsx y devuelve sus hojas con datos: `[{ name, rows }]`, igual que xlsToSheets. */
export function xlsxToSheets(buf) {
  const sst = xlsxSharedStrings(buf);
  const out = [];
  let cells = 0;
  const spend = (n) => { cells += n; if (cells > MAX_CELLS) throw new Error(t('docTooLarge')); };
  for (const ref of xlsxSheetRefs(buf)) {
    const xml = zipRead(buf, (n) => n === ref.path);
    if (!xml) continue;
    const rows = [];
    for (const row of elements(xml, 'row')) {
      const index = Number(/r="(\d+)"/.exec(row.attrs)?.[1] ?? rows.length + 1) - 1;
      if (!(index >= 0 && index < MAX_ROWS)) throw new Error(t('docTooLarge'));
      const line = [];
      let auto = 0;
      for (const { attrs, body } of elements(row.body, 'c')) {
        const ref2 = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
        const col = ref2 ? colIndex(ref2) : auto;
        auto = col + 1;
        const value = cellValue(attrs, body, sst);
        if (!value) continue;
        if (col >= MAX_COLS) throw new Error(t('docTooLarge'));
        spend(Math.max(0, col + 1 - line.length));
        while (line.length < col) line.push('');
        line[col] = value;
      }
      spend(Math.max(0, index + 1 - rows.length));
      while (rows.length < index) rows.push([]);
      rows[index] = line;
    }
    while (rows.length && rows.at(-1).length === 0) rows.pop();
    if (rows.some((r) => r.length)) out.push({ name: ref.name, rows });
  }
  return out;
}

/** Hojas -> texto: una cabecera por hoja y filas separadas por tabuladores. */
export function sheetsToText(sheets) {
  return tidy(
    sheets
      .map((s) => [t('docSheet', s.name), ...s.rows.map((r) => r.join('\t'))].join('\n'))
      .join('\n\n')
  );
}
