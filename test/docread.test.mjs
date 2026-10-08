// test/docread.test.mjs — lectura de documentos sin dependencias, en cualquier SO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { readDocument, _internals } from '../lib/docread.mjs';
import { t } from '../lib/i18n.mjs';
import { makeZip } from './helpers/zip.mjs';

const dir = mkdtempSync(join(tmpdir(), 'chalc-docread-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const DOCX_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>HU 3 &amp; anexos</w:t></w:r></w:p>
<w:p><w:r><w:t xml:space="preserve">Criterio </w:t></w:r><w:r><w:tab/><w:t>tabulado</w:t><w:br/><w:t>segunda linea</w:t></w:r></w:p>
<w:p><w:fldSimple w:instr=" HYPERLINK \\l ignorame "><w:r><w:t>enlace</w:t></w:r></w:fldSimple></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Campo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Tipo</w:t></w:r></w:p></w:tc></w:tr>
<w:tr><w:tc><w:p><w:r><w:t>Codigo</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Alfanumerico</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;

test('lee un .docx sin herramientas del sistema', async () => {
  const file = join(dir, 'hu.docx');
  writeFileSync(file, makeZip({ '[Content_Types].xml': '<Types/>', 'word/document.xml': DOCX_XML }));
  const text = await readDocument(file);
  assert.match(text, /^HU 3 & anexos$/m);
  assert.match(text, /Criterio ?\ttabulado\nsegunda linea/);
  assert.match(text, /^enlace$/m);
  assert.match(text, /^Campo\tTipo$/m);
  assert.match(text, /^Codigo\tAlfanumerico$/m);
  assert.doesNotMatch(text, /HYPERLINK|<w:/); // sin marcado ni campos internos
});

test('.docx con notas al pie incluye su texto', async () => {
  const file = join(dir, 'notas.docx');
  const notes = `<w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:footnote><w:p><w:r><w:t>Nota al pie relevante</w:t></w:r></w:p></w:footnote></w:footnotes>`;
  writeFileSync(file, makeZip({ 'word/document.xml': DOCX_XML, 'word/footnotes.xml': notes }));
  const text = await readDocument(file);
  assert.match(text, /Nota al pie relevante/);
});

// F-02 — la política no depende de lo que tenga instalado la máquina: el respaldo (LibreOffice) se
// inyecta y se prueban las dos configuraciones. Un archivo que ni siquiera es un contenedor de
// Office se rechaza SIEMPRE; uno que sí lo es pero está dañado se rescata si hay conversor.
const conLibreOffice = { convert: async () => 'texto rescatado' };
const sinLibreOffice = { convert: async () => null };

test('.docx que no es un documento da un mensaje accionable, con o sin LibreOffice', async () => {
  const file = join(dir, 'roto.docx');
  writeFileSync(file, Buffer.from('esto no es un zip'));
  for (const tools of [conLibreOffice, sinLibreOffice]) {
    await assert.rejects(() => readDocument(file, tools), (e) => {
      assert.match(e.message, /roto\.docx/);
      assert.equal(e.message, t('docReadFailWord', 'roto.docx', t('docNotZip')));   // mensaje traducido, no un ENOENT
      assert.doesNotMatch(e.message, /textutil|macOS|ENOENT/);
      return true;
    });
  }
});

test('.docx dañado pero con estructura de Office: se rescata con LibreOffice y, sin él, se explica', async () => {
  const file = join(dir, 'danado.docx');
  writeFileSync(file, makeZip({ 'otra/cosa.xml': '<x/>' }));   // ZIP válido sin word/document.xml
  assert.equal(await readDocument(file, conLibreOffice), 'texto rescatado');
  await assert.rejects(() => readDocument(file, sinLibreOffice), (e) => e.message === t('docReadFailWord', 'danado.docx', t('docNoDocumentXml')));
});

test('lee un .odt', async () => {
  const file = join(dir, 'doc.odt');
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:office" xmlns:text="urn:text">
<office:automatic-styles><style:style style:name="P1"/></office:automatic-styles>
<office:body><office:text><text:h>Titulo</text:h><text:p>Parrafo con &amp; entidad</text:p>
<text:p>Con<text:tab/>tab</text:p></office:text></office:body></office:document-content>`;
  writeFileSync(file, makeZip({ 'mimetype': 'application/vnd.oasis.opendocument.text', 'content.xml': content }));
  const text = await readDocument(file);
  assert.match(text, /^Titulo$/m);
  assert.match(text, /Parrafo con & entidad/);
  assert.match(text, /Con\ttab/);
  assert.doesNotMatch(text, /P1|style/);
});

test('lee .html y .rtf sin herramientas externas', async () => {
  const html = join(dir, 'p.html');
  writeFileSync(html, '<html><head><style>b{color:red}</style></head><body><h1>Titulo</h1><p>Hola <b>mundo</b> &amp; adios</p><script>var x=1</script></body></html>');
  const t1 = await readDocument(html);
  assert.match(t1, /^Titulo$/m);
  assert.match(t1, /Hola mundo & adios/);
  assert.doesNotMatch(t1, /color:red|var x/);

  const rtf = join(dir, 'p.rtf');
  writeFileSync(rtf, '{\\rtf1\\ansi{\\fonttbl{\\f0 Arial;}}{\\*\\generator Riched20}\\f0\\fs22 Primera linea\\par Segunda\\tab columna\\par}');
  const t2 = await readDocument(rtf);
  assert.match(t2, /^Primera linea$/m);
  assert.match(t2, /Segunda\tcolumna/);
  assert.doesNotMatch(t2, /rtf1|fonttbl|generator/);
});

test('extrae texto de un PDF simple sin pdftotext', () => {
  const content = `BT /F1 12 Tf 72 720 Td (Historia de usuario numero tres) Tj 0 -14 Td (Segunda linea del documento) Tj ET`;
  const pdf = Buffer.from(
    `%PDF-1.4\n1 0 obj<</Length ${content.length}>>\nstream\n${content}\nendstream\nendobj\ntrailer<<>>\n%%EOF\n`,
    'latin1'
  );
  const text = _internals.pdfToText(pdf);
  assert.match(text, /Historia de usuario numero tres/);
  assert.match(text, /Segunda linea del documento/);
});

test('.txt y .md siguen leyéndose directo', async () => {
  const file = join(dir, 'nota.md');
  writeFileSync(file, '# Hola\n\ncuerpo\n');
  assert.equal(await readDocument(file), '# Hola\n\ncuerpo');
  const missing = join(dir, 'no-existe.md');
  await assert.rejects(() => readDocument(missing), (e) => e.message === t('docNoFile', missing));
});

// ─────────────────────────────────────────────────────── hojas de cálculo .xlsx (spec 015)

/** Arma un .xlsx mínimo: libro, relaciones, cadenas compartidas y una hoja. */
function makeXlsx(sheetName, cellsXml, shared = []) {
  const si = shared.map((s) => `<si><t>${s}</t></si>`).join('');
  return makeZip({
    'xl/workbook.xml': `<workbook><sheets><sheet name="${sheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst count="${shared.length}">${si}</sst>`,
    'xl/worksheets/sheet1.xml': `<worksheet><sheetData>${cellsXml}</sheetData></worksheet>`
  });
}

test('colIndex traduce la referencia de celda a índice de columna', () => {
  assert.equal(_internals.colIndex('A1'), 0);
  assert.equal(_internals.colIndex('Z9'), 25);
  assert.equal(_internals.colIndex('AA1'), 26);
  assert.equal(_internals.colIndex('BC12'), 54);
});

test('.xlsx: lee cadenas compartidas, números y fórmulas con resultado (R1, R7)', async () => {
  const xlsx = makeXlsx(
    'Modelo',
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>' +
      '<row r="2"><c r="A2"><v>7700000</v></c><c r="B2"><f>A2*2</f><v>15400000</v></c></row>',
    ['Concepto', 'Valor']
  );
  const file = join(dir, 'libro.xlsx');
  writeFileSync(file, xlsx);
  const text = await readDocument(file);
  assert.ok(text.includes(t('docSheet', 'Modelo')));
  assert.match(text, /Concepto\tValor/);
  assert.match(text, /7700000\t15400000/);
});

test('.xlsx: la cadena en línea y el booleano se leen (R1)', () => {
  const xlsx = makeXlsx(
    'H',
    '<row r="1"><c r="A1" t="inlineStr"><is><t>en linea</t></is></c><c r="B1" t="b"><v>1</v></c></row>'
  );
  const [hoja] = _internals.xlsxToSheets(xlsx);
  assert.deepEqual(hoja.rows, [['en linea', 'TRUE']]);
});

test('.xlsx: conserva la columna vacía intermedia (R5)', () => {
  const xlsx = makeXlsx('H', '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>', ['A', 'C']);
  const [hoja] = _internals.xlsxToSheets(xlsx);
  assert.deepEqual(hoja.rows, [['A', '', 'C']]);
});

test('.xlsx: omite las hojas sin datos (R6)', () => {
  const xlsx = makeXlsx('Vacia', '<row r="1"><c r="A1"/></row>');
  assert.deepEqual(_internals.xlsxToSheets(xlsx), []);
});

test('.xlsx cifrado se reporta como protegido, no como zip corrupto (R4)', async () => {
  // Office envuelve el .xlsx cifrado en un contenedor OLE2, no en un ZIP
  const ole = Buffer.alloc(512);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole, 0);
  const file = join(dir, 'cifrado.xlsx');
  writeFileSync(file, ole);
  await assert.rejects(() => readDocument(file), (e) => e.message === t('docXlsEncrypted'));
});
