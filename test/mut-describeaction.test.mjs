// T10 (spec 022, R5, extracto al aprobar) — mutantes de cli/shell/describeaction.mjs.
// Fija la etiqueta exacta de cada herramienta y los bordes del extracto (líneas y caracteres).

import test from 'node:test';
import assert from 'node:assert/strict';
import { t } from '../lib/i18n.mjs';
import { describeAction, actionPreview } from '../cli/shell/describeaction.mjs';

test('R5: etiqueta de write con tamaño exacto, append y ruta por alias', () => {
  assert.equal(describeAction({ tool: 'write', args: { path: 'a.txt', content: 'hola' } }), 'write a.txt (4 bytes)');
  assert.equal(describeAction({ tool: 'write', args: { file: 'b', text: 'xyz', append: true } }), 'write (append) b (3 bytes)');
  assert.equal(describeAction({ tool: 'write', args: { filename: 'c' } }), 'write c (0 bytes)');
  // content vacío ('') no cae a text: ?? solo salta null/undefined
  assert.equal(describeAction({ tool: 'write', args: { file_path: 'd', content: '', text: 'zz' } }), 'write d (0 bytes)');
  assert.equal(describeAction({ tool: 'write', args: {} }), `write ${t('cliNoPath')} (0 bytes)`);
});

test('R5: etiquetas de edit, bash, MCP y genérica', () => {
  assert.equal(describeAction({ tool: 'edit', args: { path: 'x.js' } }), 'edit x.js');
  assert.equal(describeAction({ tool: 'bash', args: { command: 'ls -la' } }), 'bash: ls -la');
  assert.equal(describeAction({ tool: 'bash' }), 'bash: ');
  assert.equal(describeAction({ tool: 'mcp__srv__do__it', args: { q: 1 } }), 'MCP srv/do__it {"q":1}');
  assert.equal(describeAction({ tool: 'read', args: { path: 'r' } }), 'read {"path":"r"}');
  assert.equal(describeAction({ tool: 'x_mcp__', args: {} }), 'x_mcp__ {}');
});

test('R5: actionPreview de write recorta a 12 líneas y avisa de las omitidas', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => `l${i}`).join('\n');
  const p12 = actionPreview({ tool: 'write', args: { content: twelve } }).split('\n');
  assert.equal(p12.length, 12);
  assert.equal(p12[0], '  │ l0');
  const p14 = actionPreview({ tool: 'write', args: { text: twelve + '\nm\nn' } }).split('\n');
  assert.equal(p14.length, 13);
  assert.equal(p14[12], `  │ ${t('cliPreviewMoreLines', 2)}`);
  assert.equal(actionPreview({ tool: 'write', args: {} }), '  │ ');
});

test('R5: una línea de 160 caracteres no se recorta; la de 161 sí, con …', () => {
  const exact = 'a'.repeat(160);
  assert.equal(actionPreview({ tool: 'write', args: { content: exact } }), `  │ ${exact}`);
  assert.equal(actionPreview({ tool: 'write', args: { content: exact + 'b' } }), `  │ ${exact}…`);
});

test('R5: actionPreview de edit muestra old con - y new con +, 6 líneas por lado', () => {
  assert.equal(actionPreview({ tool: 'edit', args: { old: 'a', new: 'b' } }), '  - a\n  + b');
  const seven = Array.from({ length: 7 }, (_, i) => `o${i}`).join('\n');
  const lines = actionPreview({ tool: 'edit', args: { old: seven, new: 'z' } }).split('\n');
  assert.equal(lines.length, 8);
  assert.equal(lines[6], `  - ${t('cliPreviewMoreLines', 1)}`);
  assert.equal(lines[7], '  + z');
});

test('R5: actionPreview de herramientas sin texto es vacío', () => {
  assert.equal(actionPreview({ tool: 'bash', args: { command: 'x' } }), '');
  assert.equal(actionPreview({ tool: 'read' }), '');
});

test('R5: edit sin old ni new muestra extractos vacíos, no texto inventado', () => {
  assert.equal(actionPreview({ tool: 'edit', args: {} }), '  - \n  + ');
});
