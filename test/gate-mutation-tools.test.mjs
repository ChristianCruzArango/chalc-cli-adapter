// F-19 — integración con las herramientas de mutación: mutmut 3, atribución por archivo y rutas de PIT.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { runMutation } from '../catalog/gate/lib/mutation.mjs';
import { parseMutmutStats } from '../catalog/gate/lib/report-mutmut.mjs';

async function write(dir, rel, content) {
  await mkdir(dirname(join(dir, rel)), { recursive: true });
  await writeFile(join(dir, rel), content);
}

test('mutmut 3 cicd stats are scored like any other report', () => {
  const r = parseMutmutStats(JSON.stringify({ killed: 6, survived: 1, total: 9, no_tests: 1, skipped: 1, suspicious: 0, timeout: 2, check_was_interrupted_by_user: false, segfault: 0 }));
  assert.equal(r.score, 80);
  assert.equal(r.aggregate, true);
  assert.throws(() => parseMutmutStats('{"killed":1,"survived":0,"check_was_interrupted_by_user":true}'), (e) => e.problem === 'mutmutInterrupted');
  assert.throws(() => parseMutmutStats('<xml/>'), (e) => e.problem === 'notJson');
});

test('a failing mutmut run shows one aggregated finding', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-f19-'));
  const run = async () => { await write(dir, 'mutants/mutmut-cicd-stats.json', JSON.stringify({ killed: 1, survived: 3, no_tests: 0, timeout: 0 })); return { code: 0, ms: 1 }; };
  const r = await runMutation({ mutation: { command: 'mutmut run; mutmut export-cicd-stats', report: 'mutants/mutmut-cicd-stats.json', format: 'mutmut-stats' } }, { root: dir, run });
  assert.equal(r.ok, false);
  assert.equal(r.score, 25);
  assert.equal(r.findings.length, 1);
  assert.match(r.findings[0].data.status, /3 Survived/);
});

const pit = (mutations) => `<mutations>${mutations.map(([pkg, file, line, status]) =>
  `<mutation detected="${status === 'KILLED'}" status="${status}"><sourceFile>${file}</sourceFile><mutatedClass>${pkg}.${file.replace('.java', '')}</mutatedClass><lineNumber>${line}</lineNumber><mutator>org.pitest.X</mutator></mutation>`).join('')}</mutations>`;

test('PIT mutants outside the task files do not count, and PIT paths match git paths by suffix', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-f19-pit-'));
  const changed = ['src/main/java/com/acme/Precio.java'];
  const run = async () => {
    await write(dir, 'target/pit-reports/2026/mutations.xml', pit([
      ['com.acme', 'Precio.java', 10, 'KILLED'],
      ['com.acme', 'Legado.java', 5, 'SURVIVED'],
      ['com.acme', 'Legado.java', 6, 'SURVIVED']
    ]));
    return { code: 0, ms: 1 };
  };
  await write(dir, changed[0], 'class Precio {}');
  const r = await runMutation({ mutation: { command: 'mvn pit', report: 'target/pit-reports/**/mutations.xml', format: 'pit' } }, { root: dir, changed, run });
  assert.equal(r.score, 100, 'los supervivientes de Legado.java no son de esta tarea');
  assert.equal(r.ok, true);
});
