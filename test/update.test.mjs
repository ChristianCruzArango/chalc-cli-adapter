// test/update.test.mjs — core de `chalc update` (specs/003-chalc-update). Todo con fuentes y
// catálogos LOCALES en tmp: cero red, cero npx.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { installSkill } from '../lib/install.mjs';
import { listInstalledSkills, checkSkillUpdate, applySkillUpdate, writeSkillsLock, updateSkills } from '../lib/update.mjs';

const makeTmp = (p) => mkdtemp(join(tmpdir(), p));

// e2e del comando real, SIN red: las skills instaladas del catálogo vienen de skills.sh y sin
// --allow-exec (y sin TTY) deben quedar en error needs-exec — nada se descarga, exit 0 (R1, R7).
test('R7 e2e: chalc update --check sin --allow-exec reporta needs-exec y sale 0 sin ejecutar npx', async () => {
  const { execFile } = await import('node:child_process');
  const { fileURLToPath } = await import('node:url');
  const { dirname, resolve } = await import('node:path');
  const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const r = await new Promise((resolveRun) => {
    execFile(process.execPath, [resolve(ROOT, 'bin/chalc.mjs'), 'update', '--check'], { cwd: ROOT, encoding: 'utf8' }, (error, stdout, stderr) => {
      resolveRun({ code: error?.code ?? 0, output: `${stdout}${stderr}` });
    });
  });
  assert.equal(r.code, 0, r.output);
  assert.match(r.output, /angular-migration/);
  assert.match(r.output, /--allow-exec/);   // la razón needs-exec, localizada en ambos idiomas
});

// Catálogo de juguete: <catalog>/skills/<id>/SKILL.md (+ manifiesto opcional).
async function makeCatalog({ withManifest = [], builtin = [], corrupt = [] } = {}) {
  const catalog = await makeTmp('chalc-update-cat-');
  for (const id of [...withManifest, ...builtin, ...corrupt]) {
    await mkdir(join(catalog, 'skills', id), { recursive: true });
    await writeFile(join(catalog, 'skills', id, 'SKILL.md'), `# ${id}\n`);
  }
  for (const id of withManifest) {
    await writeFile(join(catalog, 'skills', id, '.chalc-skill.json'), JSON.stringify({
      id, source: `/fuentes/${id}`, sourceType: 'local', contentSha256: 'abc', installedAt: '2026-01-01T00:00:00Z'
    }));
  }
  for (const id of corrupt) {
    await writeFile(join(catalog, 'skills', id, '.chalc-skill.json'), '{manifiesto roto');
  }
  return catalog;
}

test('R1: listInstalledSkills lista solo las skills con manifiesto, con su fuente', async () => {
  const catalog = await makeCatalog({ withManifest: ['zeta-skill', 'alfa-skill'], builtin: ['clean-code'] });
  try {
    const { installed, builtins } = await listInstalledSkills(catalog);
    assert.deepEqual(installed.map((s) => s.id), ['alfa-skill', 'zeta-skill']);   // orden estable por id
    assert.equal(installed[0].manifest.source, '/fuentes/alfa-skill');
    assert.equal(installed[0].manifest.sourceType, 'local');
    assert.deepEqual(builtins, ['clean-code']);
  } finally { await rm(catalog, { recursive: true, force: true }); }
});

test('R9: sin manifiesto o con manifiesto corrupto → builtin (no-actualizable), jamás revienta', async () => {
  const catalog = await makeCatalog({ withManifest: ['ok-skill'], builtin: ['b1', 'b2'], corrupt: ['roto'] });
  try {
    const { installed, builtins } = await listInstalledSkills(catalog);
    assert.deepEqual(installed.map((s) => s.id), ['ok-skill']);
    assert.deepEqual(builtins, ['b1', 'b2', 'roto']);   // el corrupto no se puede actualizar: se cuenta, no se lanza
  } finally { await rm(catalog, { recursive: true, force: true }); }
});

test('R1: catálogo sin carpeta skills → listas vacías (no lanza)', async () => {
  const catalog = await makeTmp('chalc-update-vacio-');
  try {
    assert.deepEqual(await listInstalledSkills(catalog), { installed: [], builtins: [] });
  } finally { await rm(catalog, { recursive: true, force: true }); }
});

test('R8: writeSkillsLock regenera el lock COMPLETO desde los manifiestos (los builtin quedan fuera)', async () => {
  const catalog = await makeCatalog({ withManifest: ['beta-skill', 'alfa-skill'], builtin: ['clean-code'] });
  const root = await makeTmp('chalc-update-root-');
  try {
    // un lock viejo con una entrada obsoleta: debe desaparecer (el lock es espejo, no historia)
    await writeFile(join(root, 'skills-lock.json'), JSON.stringify({ version: 1, skills: { 'skill-borrada': {} } }));
    const file = await writeSkillsLock(root, catalog);
    assert.equal(file, join(root, 'skills-lock.json'));
    const lock = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(lock.version, 1);
    assert.deepEqual(Object.keys(lock.skills), ['alfa-skill', 'beta-skill']);   // orden estable, sin builtins ni obsoletas
    assert.equal(lock.skills['alfa-skill'].source, '/fuentes/alfa-skill');
    assert.equal(lock.skills['alfa-skill'].sourceType, 'local');
    assert.equal(lock.skills['alfa-skill'].contentSha256, 'abc');
    assert.equal(lock.skills['alfa-skill'].installedAt, '2026-01-01T00:00:00Z');
  } finally { await rm(catalog, { recursive: true, force: true }); await rm(root, { recursive: true, force: true }); }
});

// Instala de verdad (fuente local → sin ejecución externa) y devuelve { catalog, srcRoot, skillDir }.
async function installFixture(id) {
  const catalog = await makeTmp('chalc-update-real-');
  const srcRoot = await makeTmp('chalc-update-src-');
  const skillDir = join(srcRoot, id);
  await mkdir(skillDir, { recursive: true });
  await writeFile(join(skillDir, 'SKILL.md'), `# ${id} v1\n`);
  await writeFile(join(skillDir, 'extra.md'), 'archivo de la v1\n');
  await installSkill({ source: skillDir, CATALOG: catalog, log: () => {} });
  return { catalog, srcRoot, skillDir };
}

async function manifestOf(catalog, id) {
  return JSON.parse(await readFile(join(catalog, 'skills', id, '.chalc-skill.json'), 'utf8'));
}

test('R3: fuente idéntica → fresh, sin tocar ningún archivo', async () => {
  const { catalog, srcRoot } = await installFixture('mi-skill');
  try {
    const antes = await manifestOf(catalog, 'mi-skill');
    const r = await checkSkillUpdate({ id: 'mi-skill', manifest: antes });
    assert.equal(r.status, 'fresh');
    assert.deepEqual(await manifestOf(catalog, 'mi-skill'), antes);   // nada cambió
  } finally { await rm(catalog, { recursive: true, force: true }); await rm(srcRoot, { recursive: true, force: true }); }
});

test('R2: fuente cambiada → outdated, y applySkillUpdate reemplaza contenido + manifiesto con updatedAt', async () => {
  const { catalog, srcRoot, skillDir } = await installFixture('mi-skill');
  try {
    const antes = await manifestOf(catalog, 'mi-skill');
    // la fuente evoluciona: cambia un archivo y BORRA otro (el reemplazo no debe dejar restos de la v1)
    await writeFile(join(skillDir, 'SKILL.md'), '# mi-skill v2 mejorada\n');
    await rm(join(skillDir, 'extra.md'));
    const r = await checkSkillUpdate({ id: 'mi-skill', manifest: antes });
    assert.equal(r.status, 'outdated');
    assert.notEqual(r.newHash, antes.contentSha256);
    await applySkillUpdate({ id: 'mi-skill', catalog, dir: r.dir, manifest: antes, newHash: r.newHash });
    assert.match(await readFile(join(catalog, 'skills', 'mi-skill', 'SKILL.md'), 'utf8'), /v2 mejorada/);
    assert.equal(existsSync(join(catalog, 'skills', 'mi-skill', 'extra.md')), false);   // sin restos de la v1
    const despues = await manifestOf(catalog, 'mi-skill');
    assert.equal(despues.contentSha256, r.newHash);
    assert.equal(despues.installedAt, antes.installedAt);                // se conserva cuándo se instaló
    assert.ok(!Number.isNaN(Date.parse(despues.updatedAt)));            // y se registra cuándo se actualizó
    // tras aplicar, una segunda comprobación queda al día
    assert.equal((await checkSkillUpdate({ id: 'mi-skill', manifest: despues })).status, 'fresh');
  } finally { await rm(catalog, { recursive: true, force: true }); await rm(srcRoot, { recursive: true, force: true }); }
});

test('applySkillUpdate valida la copia temporal antes del swap y conserva la versión instalada ante un hash inválido', async () => {
  const { catalog, srcRoot, skillDir } = await installFixture('mi-skill');
  try {
    const antes = await manifestOf(catalog, 'mi-skill');
    await writeFile(join(skillDir, 'SKILL.md'), '# mi-skill v2\n');
    await assert.rejects(
      () => applySkillUpdate({ id: 'mi-skill', catalog, dir: skillDir, manifest: antes, newHash: 'hash-falso' }),
      /hash inesperado/
    );
    assert.match(await readFile(join(catalog, 'skills', 'mi-skill', 'SKILL.md'), 'utf8'), /v1/);
    assert.deepEqual(await manifestOf(catalog, 'mi-skill'), antes);
  } finally { await rm(catalog, { recursive: true, force: true }); await rm(srcRoot, { recursive: true, force: true }); }
});

test('R2+R8: updateSkills aplica lo desactualizado y regenera el lock', async () => {
  const { catalog, srcRoot, skillDir } = await installFixture('mi-skill');
  const root = await makeTmp('chalc-update-root-');
  try {
    await writeFile(join(skillDir, 'SKILL.md'), '# mi-skill v2\n');
    const { results, lockWritten } = await updateSkills({ catalog, chalcRoot: root, allowExternalExec: true });
    assert.deepEqual(results.map((r) => ({ id: r.id, status: r.status })), [{ id: 'mi-skill', status: 'updated' }]);
    assert.equal(lockWritten, true);
    assert.match(await readFile(join(catalog, 'skills', 'mi-skill', 'SKILL.md'), 'utf8'), /v2/);
    const lock = JSON.parse(await readFile(join(root, 'skills-lock.json'), 'utf8'));
    assert.ok(lock.skills['mi-skill'].updatedAt);
  } finally {
    for (const d of [catalog, srcRoot, root]) await rm(d, { recursive: true, force: true });
  }
});

test('R5: --check es solo lectura estricta — reporta outdated sin tocar catálogo ni lock', async () => {
  const { catalog, srcRoot, skillDir } = await installFixture('mi-skill');
  const root = await makeTmp('chalc-update-root-');
  try {
    await writeFile(join(skillDir, 'SKILL.md'), '# mi-skill v2\n');
    const { results, lockWritten } = await updateSkills({ catalog, chalcRoot: root, check: true, allowExternalExec: true });
    assert.equal(results[0].status, 'outdated');
    assert.equal(lockWritten, false);
    assert.match(await readFile(join(catalog, 'skills', 'mi-skill', 'SKILL.md'), 'utf8'), /v1/);   // intacto
    assert.equal(existsSync(join(root, 'skills-lock.json')), false);
  } finally {
    for (const d of [catalog, srcRoot, root]) await rm(d, { recursive: true, force: true });
  }
});

test('R6: con ids se procesan solo esas; un id desconocido se reporta claro y no aborta', async () => {
  const { catalog, srcRoot } = await installFixture('mi-skill');
  const root = await makeTmp('chalc-update-root-');
  try {
    const { results } = await updateSkills({ catalog, chalcRoot: root, ids: ['fantasma', 'mi-skill'], allowExternalExec: true });
    const byId = Object.fromEntries(results.map((r) => [r.id, r.status]));
    assert.equal(byId.fantasma, 'unknown');
    assert.equal(byId['mi-skill'], 'fresh');
  } finally {
    for (const d of [catalog, srcRoot, root]) await rm(d, { recursive: true, force: true });
  }
});

test('R7: fuente que ejecuta herramientas externas sin --allow-exec ni prompter → error needs-exec SIN ejecutar nada', async () => {
  const catalog = await makeTmp('chalc-update-cat-');
  const root = await makeTmp('chalc-update-root-');
  try {
    // manifiesto de una skill que vino de skills.sh: actualizarla ejecutaría `npx --yes skills add …`
    await mkdir(join(catalog, 'skills', 'remota'), { recursive: true });
    await writeFile(join(catalog, 'skills', 'remota', 'SKILL.md'), '# remota\n');
    await writeFile(join(catalog, 'skills', 'remota', '.chalc-skill.json'), JSON.stringify({
      id: 'remota', source: 'paquete-remoto', sourceType: 'skillssh', contentSha256: 'x', installedAt: '2026-01-01T00:00:00Z'
    }));
    const { results } = await updateSkills({ catalog, chalcRoot: root });   // ni allow-exec ni prompter
    assert.equal(results[0].status, 'error');
    assert.equal(results[0].reason, 'needs-exec');
  } finally {
    for (const d of [catalog, root]) await rm(d, { recursive: true, force: true });
  }
});

test('R4: fuente desaparecida → error SIN lanzar y sin ejecutar nada externo', async () => {
  const { catalog, srcRoot } = await installFixture('mi-skill');
  try {
    const manifest = await manifestOf(catalog, 'mi-skill');
    await rm(srcRoot, { recursive: true, force: true });   // la fuente local ya no existe
    const r = await checkSkillUpdate({ id: 'mi-skill', manifest });
    // OJO: una ruta local borrada NO debe caer al fallback skills.sh (eso ejecutaría npx): error claro
    assert.equal(r.status, 'error');
    assert.ok(r.error);
  } finally { await rm(catalog, { recursive: true, force: true }); }
});

test('R4: la skill ya no existe dentro de la fuente → error de esa skill, sin lanzar', async () => {
  const { catalog, srcRoot, skillDir } = await installFixture('mi-skill');
  try {
    const manifest = await manifestOf(catalog, 'mi-skill');
    // la fuente sigue viva pero reorganizada: ahora contiene OTRA skill
    await rm(join(skillDir, 'SKILL.md'));
    await mkdir(join(skillDir, 'otra-skill'), { recursive: true });
    await writeFile(join(skillDir, 'otra-skill', 'SKILL.md'), '# otra\n');
    const r = await checkSkillUpdate({ id: 'mi-skill', manifest });
    assert.equal(r.status, 'error');
    assert.match(String(r.error), /mi-skill/);
  } finally { await rm(catalog, { recursive: true, force: true }); await rm(srcRoot, { recursive: true, force: true }); }
});
