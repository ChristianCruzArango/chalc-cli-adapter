// Spec 026 (no-destruir), T1 — la bitácora de `chalc-cli` vive en `.chalc/cli-review.md` y nunca toca
// `.chalc/review.md`, que es la bitácora append-only de los roles (la leen el advisor y la memoria).
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DICT } from '../lib/i18n.mjs';
import { tempDir } from './helpers/tmpdir.mjs';
import {
  REVIEW_REL, reviewPath, startReview, logRound, logFixOrder, logFixResult, logVerify
} from '../cli/engine/reviewfile.mjs';

const ROLES_LOG = '## revisor · 2026-11-22T10:00:00Z · abc1234\nOK\n\nRegla aprendida (pagos; sinónimos: cobros): validar el total.\n';

async function projectWithRolesLog(t) {
  const dir = await tempDir(t, 'chalc-026-review-');
  await mkdir(join(dir, '.chalc'), { recursive: true });
  await writeFile(join(dir, '.chalc', 'review.md'), ROLES_LOG);
  return dir;
}
const rolesLog = (dir) => readFileSync(join(dir, '.chalc', 'review.md'), 'utf8');

test('R1: la bitácora de chalc-cli se abre en .chalc/cli-review.md', async (t) => {
  const dir = await tempDir(t, 'chalc-026-review-');
  const file = startReview(dir, 'añadir login', { reviewer: 'modelo-x' });
  assert.equal(REVIEW_REL, '.chalc/cli-review.md');
  assert.equal(file, join(dir, '.chalc', 'cli-review.md'));
  assert.equal(reviewPath(dir), file);
  assert.match(readFileSync(file, 'utf8'), /^# Revisión: añadir login/);
  assert.equal(existsSync(join(dir, '.chalc', 'review.md')), false, 'no crea la bitácora de los roles');
});

test('R2: abrir la bitácora deja .chalc/review.md idéntico', async (t) => {
  const dir = await projectWithRolesLog(t);
  startReview(dir, 'añadir login');
  assert.equal(rolesLog(dir), ROLES_LOG);
});

test('R2: cada anotación va a la bitácora de chalc-cli y .chalc/review.md no cambia', async (t) => {
  const dir = await projectWithRolesLog(t);
  startReview(dir, 'añadir login');
  assert.equal(logRound(dir, 1, { ok: false, findings: '1. falta validar' }), true);
  assert.equal(logFixOrder(dir, 'valida el total'), true);
  assert.equal(logFixResult(dir, { done: true, summary: 'hecho' }), true);
  assert.equal(logVerify(dir, 1, { ok: true, command: 'npm run build' }), true);
  assert.equal(rolesLog(dir), ROLES_LOG);
  const own = readFileSync(reviewPath(dir), 'utf8');
  assert.match(own, /## Ronda 1 — HALLAZGOS/);
  assert.match(own, /### Orden de corrección al junior/);
  assert.match(own, /### Resultado del junior/);
  assert.match(own, /## Verificación ronda 1 — OK/);
});

test('R2: sin bitácora de chalc-cli abierta, anotar no escribe en la de los roles', async (t) => {
  const dir = await projectWithRolesLog(t);
  assert.equal(logRound(dir, 1, { ok: true }), false);
  assert.equal(logVerify(dir, 1, { ok: true, command: 'npm run build' }), false);
  assert.equal(rolesLog(dir), ROLES_LOG);
  assert.equal(existsSync(reviewPath(dir)), false);
});

for (const code of ['es', 'en']) {
  test(`R3 (${code}): el mensaje y la ayuda nombran .chalc/cli-review.md`, () => {
    const dict = DICT[code];
    assert.ok(dict.cliReviewLogAt(REVIEW_REL).includes('.chalc/cli-review.md'));
    const help = [].concat(dict.aiRolesIntro).join('\n');
    assert.ok(help.includes('.chalc/cli-review.md'), 'la ayuda nombra la bitácora de chalc-cli');
    assert.equal(help.includes('.chalc/review.md'), false, 'la ayuda ya no atribuye review.md a chalc-cli');
  });
}
