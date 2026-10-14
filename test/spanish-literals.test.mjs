// T8 (spec 022, R19, C2) — lo que la CLI imprime o lanza pasa por t(). Un literal con letras del español
// (á é í ó ú ñ ¿ ¡) en un console.*, un process.std*.write, una pregunta del prompter o un throw de lib/ o cli/ es un texto que el
// usuario de la CLI en inglés vería en español. Quedan fuera los diccionarios (lib/i18n/), los prompts
// (lib/prompts/) y los comentarios.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKIP = new Set(['lib/i18n', 'lib/prompts']);
const SPANISH = /[áéíóúñ¿¡]/i;
const CALL = /\b(?:console\.(?:log|error|warn|info)|process\.std(?:out|err)\.write|throw new Error|prompter\.(?:yesno|select|multi|text|secret))\(/g;
const LITERAL = /(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g;

// Errores de programación (contrato de una API interna) que nunca ve quien usa la CLI; registrados con su motivo
// también en test/revision-m03.test.mjs (R30).
const CONTRACT = new Set([
  'cli/tools/registry.mjs::createTools requiere root (raíz del proyecto).',
  'lib/promptkit.mjs::Nombre de sección inválido: ${name}'
]);

const walk = (dir) => readdirSync(dir).flatMap((n) => {
  const p = join(dir, n);
  const rel = relative(ROOT, p).replace(/\\/g, '/');
  if (SKIP.has(rel)) return [];
  return statSync(p).isDirectory() ? walk(p) : p.endsWith('.mjs') ? [p] : [];
});

// Sin comentarios: los de bloque y los de línea que empiezan la línea o van tras un espacio (no `://` de una URL).
const withoutComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

// Los argumentos de la llamada que empieza en `from`: hasta el paréntesis que la cierra.
function argsAt(src, from) {
  let depth = 1;
  let quote = '';
  for (let i = from; i < src.length; i++) {
    const c = src[i];
    if (quote) { if (c === '\\') i++; else if (c === quote) quote = ''; continue; }
    if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '(') depth++;
    else if (c === ')' && --depth === 0) return src.slice(from, i);
  }
  return src.slice(from);
}

export function spanishLiterals(rel, source) {
  const src = withoutComments(source);
  const found = [];
  for (const m of src.matchAll(CALL)) {
    for (const lit of argsAt(src, m.index + m[0].length).matchAll(LITERAL)) {
      const key = `${rel}::${lit[2]}`;
      if (SPANISH.test(lit[2]) && !CONTRACT.has(key)) found.push(key);
    }
  }
  return found;
}

test('C2: el detector encuentra literales en español y respeta comentarios y t()', () => {
  assert.deepEqual(spanishLiterals('x.mjs', "console.log('  ✓ listo, sin más');"), ['x.mjs::  ✓ listo, sin más']);
  assert.deepEqual(spanishLiterals('x.mjs', 'throw new Error(`falló ${a}`);'), ['x.mjs::falló ${a}']);
  assert.deepEqual(spanishLiterals('x.mjs', "process.stdout.write(\n  'línea'\n);"), ['x.mjs::línea']);
  assert.deepEqual(spanishLiterals('x.mjs', "await prompter.yesno(`¿Seguir?`, false);"), ['x.mjs::¿Seguir?']);
  assert.deepEqual(spanishLiterals('x.mjs', "// console.log('aquí no')\nconsole.log(t('clave'), 'ok');"), []);
  assert.deepEqual(spanishLiterals('x.mjs', "/* console.warn('también') */ console.warn(`${t('k')}`);"), []);
});

test('C2: lib/ y cli/ no imprimen ni lanzan literales en español fuera de i18n', () => {
  const found = ['lib', 'cli'].flatMap((r) => walk(join(ROOT, r)))
    .flatMap((file) => spanishLiterals(relative(ROOT, file).replace(/\\/g, '/'), readFileSync(file, 'utf8')));
  assert.deepEqual(found, []);
});
