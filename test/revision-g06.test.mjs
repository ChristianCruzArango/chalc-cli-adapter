// G-06 (spec 016, R15) — el lector XML de reportes de mutación respeta `>` dentro de atributos entre
// comillas, decodifica entidades hexadecimales en una sola pasada y devuelve CDATA tal cual. Antes,
// `<testcase name="a>b">` perdía archivo y línea, y un mutante superviviente así se descartaba.

import test from 'node:test';
import assert from 'node:assert/strict';
import { elements, attrsOf, childText } from '../catalog/gate/lib/xml.mjs';
import { parseJUnit } from '../catalog/gate/lib/report-junit.mjs';

test('R15: a ">" inside a quoted attribute does not cut the tag', () => {
  const [el] = elements('<testcase name="cmp a>b" file="src/x.py" line="7"><failure/></testcase>', 'testcase');
  assert.deepEqual(el.attrs, { name: 'cmp a>b', file: 'src/x.py', line: '7' });
  assert.equal(el.inner, '<failure/>');
  const [single] = elements("<testcase name='x>y' file='a.py' />", 'testcase');
  assert.deepEqual(single, { attrs: { name: 'x>y', file: 'a.py' }, inner: null });
});

test('R15: a surviving mutant whose name contains ">" keeps its file and line (score does not go up)', () => {
  const xml = '<testsuite><testcase name="src/x.py:12:cmp a>b" line="12"><failure/></testcase><testcase name="src/y.py:3" /></testsuite>';
  const report = parseJUnit(xml);
  assert.equal(report.survived, 1);
  assert.deepEqual(report.survivors.map((s) => [s.file, s.line]), [['src/x.py', 12]]);
});

test('R15: hex and decimal entities decode once, without double decoding', () => {
  assert.deepEqual(attrsOf('a="&#x3C;&#X3e;" b="&#60;&amp;" c="&#38;lt;" d="&amp;amp;" e="&#x1F600;"'),
    { a: '<>', b: '<&', c: '&lt;', d: '&amp;', e: '😀' });
});

test('R15: CDATA is returned verbatim, entities outside it are decoded', () => {
  assert.equal(childText('<d><![CDATA[a < b && &lt;x&gt;]]> &amp; c</d>', 'd'), 'a < b && &lt;x&gt; & c');
  assert.equal(childText('<d k="v>w">t</d>', 'd'), 't');
  assert.equal(childText('<d>&#x41;</d>', 'd'), 'A');
  assert.equal(childText('<d>\n  A  \n</d>', 'd'), 'A');
  assert.equal(attrsOf('a="&LT;&Amp;"').a, '&LT;&Amp;');
});

test('R15: name anchoring still separates <mutation> from <mutations>', () => {
  const xml = '<mutations><mutation detected="false"><sourceFile>A.java</sourceFile></mutation></mutations>';
  assert.equal(elements(xml, 'mutation').length, 1);
  assert.equal(childText(elements(xml, 'mutation')[0].inner, 'sourceFile'), 'A.java');
});
