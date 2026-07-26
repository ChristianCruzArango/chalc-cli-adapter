// test/docread.test.mjs — lectura de documentos sin dependencias, en cualquier SO.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';

import { readDocument, _internals } from '../lib/docread.mjs';
import { t } from '../lib/i18n.mjs';

const dir = mkdtempSync(join(tmpdir(), 'chalc-docread-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** Arma un ZIP mínimo (deflate) con las entradas dadas: { nombre: contenido }. */
function makeZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.from(content, 'utf8');
    const comp = deflateRawSync(data);
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, comp);

    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(comp.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(offset, 42);
    central.push(cd, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const localBuf = Buffer.concat(locals);
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(Object.keys(files).length, 8);
  eocd.writeUInt16LE(Object.keys(files).length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(localBuf.length, 16);
  return Buffer.concat([localBuf, centralBuf, eocd]);
}

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

test('.docx corrupto da un mensaje accionable, no un ENOENT de textutil', async () => {
  const file = join(dir, 'roto.docx');
  writeFileSync(file, Buffer.from('esto no es un zip'));
  await assert.rejects(() => readDocument(file), (e) => {
    assert.match(e.message, /roto\.docx/);
    assert.equal(e.message, t('docReadFailWord', 'roto.docx', t('docNotZip')));   // mensaje traducido, no un ENOENT
    assert.doesNotMatch(e.message, /textutil|macOS|ENOENT/);
    return true;
  });
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
