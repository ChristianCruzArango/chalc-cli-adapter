// S-10 — ningún patrón ni documento fabricado puede bloquear el event loop.
//
// La auditoría midió `(a+)+$` sin terminar en 300 ms (hubo que matar el proceso) y la limpieza HTML
// creciendo de forma cuadrática. Con 320 KB fabricados, varias limpiezas de texto pasaban de 40 s.
// Cada caso de aquí tiene que terminar muy por debajo de un segundo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsTools } from '../cli/tools/fs.mjs';
import { lineMatcher, safeTest, RegexTimeoutError, hasNestedQuantifier } from '../lib/saferegex.mjs';
import { _internals } from '../lib/docread.mjs';
import { stripHtml } from '../lib/sources.mjs';
import { buildAgentReplaySpec } from '../lib/qaagent.mjs';

const N = 320 * 1024;
const fast = (fn, label) => {
  const start = Date.now();
  fn();
  const ms = Date.now() - start;
  assert.ok(ms < 1500, `${label}: ${ms} ms`);
};

test('a catastrophic regex is cut off instead of freezing the process', () => {
  const evil = lineMatcher('(a+)+$');
  const start = Date.now();
  assert.throws(() => evil([`${'a'.repeat(120)}!`]), RegexTimeoutError);
  assert.ok(Date.now() - start < 2000);
});

test('plain text is matched literally and regex syntax still works', () => {
  assert.deepEqual(lineMatcher('a.b')(['a.b', 'axb']), [true, true]);   // `.` es sintaxis: regex
  assert.deepEqual(lineMatcher('users')(['the users', 'nope']), [true, false]);
  assert.equal(safeTest('^/login$', '/login'), true);
});

test('grep reports a slow pattern as an error the model can act on', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-s10-'));
  await writeFile(join(root, 'a.txt'), `${'a'.repeat(120)}!\n`);
  const { grep } = createFsTools({ root });
  const r = await grep.run({ pattern: '(a+)+$' });
  assert.match(r.error, /regex too slow/);
  assert.equal((await grep.run({ pattern: 'aaa' })).matches.length, 1);
});

test('document cleanup is linear on unterminated markup', () => {
  const { htmlToText, xmlToText, odtToText, xlsxToSheets } = _internals;
  fast(() => htmlToText('<script'.repeat(N / 7)), 'script');
  fast(() => htmlToText('<!--'.repeat(N / 4)), 'comment');
  fast(() => htmlToText('<br'.repeat(N / 3)), 'br');
  fast(() => htmlToText('<a'.repeat(N / 2)), 'any tag');
  fast(() => htmlToText(`${' '.repeat(N)}x`), 'trailing spaces');
  fast(() => htmlToText(`${'\t'.repeat(N)}x`), 'tab run');
  fast(() => xmlToText(`${'\n'.repeat(N)}x`, {}), 'newline run');
  fast(() => xmlToText('<a'.repeat(N / 2), {}), 'xml any tag');
  fast(() => stripHtml('<li'.repeat(N / 3)), 'sources li');
  assert.equal(typeof odtToText, 'function');
  assert.equal(typeof xlsxToSheets, 'function');
});

test('HTML cleanup keeps its output', () => {
  const html = '<html><head><title>x</title></head><body><SCRIPT>bad()</SCRIPT><!-- c --><p>Hola&nbsp;mundo</p><br/>'
    + '<table><tr><td>a</td><td>b</td></tr></table><style>p{}</style></body></html>';
  assert.equal(_internals.htmlToText(html), 'Hola mundo\n\na\tb');
  assert.equal(stripHtml('<ul><li>uno</li><li>dos</li></ul><link rel="x"><p>fin</p>'), '- uno\n- dos\nfin');
});

test('a nested-quantifier URL pattern is replayed as a literal', () => {
  assert.equal(hasNestedQuantifier('(a+)+$'), true);
  assert.equal(hasNestedQuantifier('/orders/\\d+'), false);
  const steps = [{ action: { type: 'browser', requirement: 'R1', steps: [{ op: 'expectUrl', value: '(a+)+$' }, { op: 'expectUrl', value: '/orders/\\d+' }] }, observation: { ok: true } }];
  const spec = buildAgentReplaySpec('001', 'http://x', steps);
  assert.match(spec, /new RegExp\("\\\\\(a\\\\\+\\\\\)\\\\\+\\\\\$"\)/);
  assert.match(spec, /new RegExp\("\/orders\/\\\\d\+"\)/);
});
