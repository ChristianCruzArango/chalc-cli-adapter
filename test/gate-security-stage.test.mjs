// spec 014 · T11 (R9) — la etapa revisa lo que escribió la tarea, no la deuda que ya estaba.
//
// Es la misma regla que rige `smells` y `duplication`: un repo con historia tiene MD5 viejos y URLs
// http olvidadas, y volcarlos en cada tarea enterraría lo que se hizo hoy. Pero lo que la tarea SÍ
// escribió se revisa siempre, y un archivo nuevo —sin líneas anotadas— se revisa entero.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { lintSecurity } from '../catalog/gate/lib/security.mjs';

const VIEJO = "const h = createHash('md5');";
const NUEVO = 'const apiKey = "a1b2c3d4e5f6";';

async function repo(files) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-sec-'));
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

test('R9: only findings on lines the task wrote are reported', async () => {
  const root = await repo({ 'src/pago.ts': `${VIEJO}\nconst x = 1;\n${NUEVO}\n` });
  const lines = new Map([['src/pago.ts', new Set([3])]]);

  const { findings } = await lintSecurity(['src/pago.ts'], { root, lines });

  assert.deepEqual(findings.map((f) => [f.line, f.rule]), [[3, 'hardcoded-secret']]);
});

// Sin líneas anotadas no se puede atribuir nada, y callar sería aprobar sin mirar.
test('R9: a file with no line information is reviewed whole', async () => {
  const root = await repo({ 'src/nuevo.ts': `${VIEJO}\n${NUEVO}\n` });

  const { findings } = await lintSecurity(['src/nuevo.ts'], { root, lines: new Map() });
  assert.deepEqual(findings.map((f) => f.rule), ['weak-hash', 'hardcoded-secret']);

  const sinMapa = await lintSecurity(['src/nuevo.ts'], { root });
  assert.equal(sinMapa.findings.length, 2);
});

// Una supresión vieja sin motivo es deuda de otra tarea; la que se escribe hoy, no.
test('R9: a reasonless allow counts only when the task wrote it', async () => {
  const root = await repo({ 'src/a.ts': '// chalc-allow: weak-hash\nconst x = 1;\n// chalc-allow: tls-disabled\n' });
  const lines = new Map([['src/a.ts', new Set([3])]]);

  const { findings } = await lintSecurity(['src/a.ts'], { root, lines });
  assert.deepEqual(findings.map((f) => [f.line, f.rule, f.data.rule]), [[3, 'allow-without-reason', 'tls-disabled']]);
});

// Lo suprimido se informa con la misma regla: la evidencia de esta tarea habla de esta tarea.
test('R9: suppressions are reported for the lines the task wrote', async () => {
  const text = `// chalc-allow: weak-hash — checksum de caché sin uso criptográfico\n${VIEJO}\n`;
  const root = await repo({ 'src/cache.ts': text, 'src/viejo.ts': text });
  const lines = new Map([['src/cache.ts', new Set([2])], ['src/viejo.ts', new Set([1])]]);

  const { findings, allowed } = await lintSecurity(['src/cache.ts', 'src/viejo.ts'], { root, lines });

  assert.deepEqual(findings, []);
  assert.deepEqual(allowed.map((a) => [a.file, a.line, a.rule]), [['src/cache.ts', 2, 'weak-hash']]);
});

// Un archivo borrado viene en el diff, pero ya no hay nada que revisar: no puede tumbar la corrida.
test('R9: missing files and languages with no dialect are skipped', async () => {
  const root = await repo({ 'docs/notas.md': `${NUEVO}\n` });

  const { findings, allowed } = await lintSecurity(['src/borrado.ts', 'docs/notas.md'], { root });
  assert.deepEqual([findings, allowed], [[], []]);
});
