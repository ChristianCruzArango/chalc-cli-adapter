// T8 (spec 022, R19, C5) — UN conversor HTML→texto (lib/markup.mjs) para las fuentes remotas y los documentos
// locales, con la unión de las tablas de entidades que tenían los dos que había.

import test from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText, decodeEntities } from '../lib/markup.mjs';
import { stripHtml } from '../lib/sources.mjs';
import { _internals } from '../lib/docread.mjs';

test('C5: la tabla de entidades es la unión (nbsp, amp, lt, gt, quot, apos, #39 y numéricas), en una pasada', () => {
  assert.equal(decodeEntities('a&nbsp;b &amp;lt; &lt;&gt; &quot;x&quot; &apos;y&#39; &#x41;&#66; &raro;'),
    'a b &lt; <> "x" \'y\' AB &raro;');
});

test('C5: listas, saltos, celdas y bloques no textuales en un solo recorrido', () => {
  const html = '<head><title>t</title></head><script>x()</script><!-- c --><ul><li>uno</li><li>dos</li></ul>'
    + '<p>a&apos;b</p><table><tr><td>c</td><td>d</td></tr></table><br>\nfin';
  assert.equal(htmlToText(html), '- uno\n- dos\na\'b\nc\td\n\nfin');
});

test('C5: las fuentes remotas y los documentos locales usan el mismo conversor', () => {
  const html = '<style>p{}</style><p>Hola&apos;&nbsp;<b>mundo</b></p><li>x</li><td>a</td><td>b</td>';
  assert.equal(stripHtml(html), htmlToText(html));
  assert.equal(_internals.htmlToText(html), htmlToText(html));
});

test('C5: entidades hexadecimales en mayúscula y saltos de Windows', () => {
  assert.equal(decodeEntities('&#X41;&#x62;'), 'Ab');
  assert.equal(htmlToText('a\r\nb\r\n\r\n\r\n\r\nc'), 'a\nb\n\nc');
});

test('C5: cada bloque cierra con un salto, también en mayúsculas', () => {
  for (const tag of ['p', 'div', 'li', 'tr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'blockquote', 'pre', 'P']) {
    assert.equal(htmlToText(`<${tag}>a</${tag}>b`), tag === 'li' ? '- a\nb' : 'a\nb', tag);
  }
  assert.equal(htmlToText('<span>a</span>b'), 'ab');
});

test('C5: celdas, <br>, <hr> y espacios', () => {
  assert.equal(htmlToText('<th>a</th><th>b</th>'), 'a\tb');
  assert.equal(htmlToText('a<br>\nb'), 'a\nb', 'un <br> seguido de salto no añade otro');
  assert.equal(htmlToText('\nx<br>y'), 'x\ny', 'mira el texto que SIGUE, no el anterior');
  assert.equal(htmlToText('a<hr>b'), 'a\nb');
  assert.equal(htmlToText('a  \t b'), 'a b');
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText(null), '');
});

test('C5: script, style, head y comentarios dejan un espacio; <scripts> o <header> no son esos bloques', () => {
  assert.equal(htmlToText('a<script>x</script>b'), 'a b');
  assert.equal(htmlToText('a<STYLE>x</STYLE>b'), 'a b');
  assert.equal(htmlToText('a<head>x</head>b'), 'a b');
  assert.equal(htmlToText('a<!-- x -->b'), 'a b');
  assert.equal(htmlToText('<header>a</header><scripts>b</scripts>'), 'ab');
});
