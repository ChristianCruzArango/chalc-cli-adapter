// T36b (R20) — las skills que chalc copia a cada repo deben decir lo MISMO que espera el portón.
//
// `copySkills` copia el contenido real de las skills al repo equipado. Si una skill manda
// `mutmut results` (que imprime por pantalla) o no habilita el reporter `json` de Stryker, el repo
// se queda sin archivo de reporte y el portón bloquea en cada tarea — por seguir la guía al pie de
// la letra. Por eso lo esperado se DERIVA de `gatedetect.mjs` en vez de escribirse a mano aquí:
// si mañana cambia el comando detectado, este test cae y obliga a actualizar la skill.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectGateConfig } from '../lib/gatedetect.mjs';
import { loadToolTable } from '../lib/tooltable.mjs';
import { renderMutationSkill } from '../lib/toolskill.mjs';

const SKILLS = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'catalog', 'skills');

// Desde la spec 011, `mutation-testing` es una PLANTILLA: sus tablas se derivan de `catalog/tools/`
// al copiarla al repo. El invariante de R20 no cambia —lo que el asistente lee tiene que coincidir
// con lo que el portón espera— pero ahora se comprueba sobre el texto RENDERIZADO, que es el que de
// verdad llega al repo. Leer la plantilla cruda solo encontraría marcadores.
const stacks = await loadToolTable();

async function skill(id) {
  const text = await readFile(join(SKILLS, id, 'SKILL.md'), 'utf8');
  return /\{\{\w+\}\}/.test(text) ? renderMutationSkill(text, { stacks, stack: null, tools: null }) : text;
}

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-skills-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf8');
  }
  return dir;
}

// Todos los SKILL.md del catálogo, para las reglas que valen en cualquiera.
async function allSkills() {
  const found = [];
  for (const entry of await readdir(SKILLS, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    try {
      found.push({ id: entry.name, text: await readFile(join(SKILLS, entry.name, 'SKILL.md'), 'utf8') });
    } catch { /* skill sin SKILL.md: no aplica */ }
  }
  return found;
}

// ── el comando y el reporte que la skill enseña son los que el portón espera ───────────────────

test('the mutation-testing skill teaches the JS command and report path the gate parses', async () => {
  const dir = await project({ 'package.json': { name: 'x', devDependencies: { jest: '^29.0.0' }, scripts: { test: 'jest' } } });
  const { mutation } = await detectGateConfig(dir);
  const text = await skill('mutation-testing');

  assert.ok(text.includes(mutation.command), `la skill debe enseñar "${mutation.command}"`);
  assert.ok(text.includes(mutation.report), `la skill debe apuntar al reporte "${mutation.report}"`);
  // Stryker NO escribe ese JSON por defecto: sin habilitar el reporter no hay nada que parsear.
  assert.match(text, /reporters/, 'la skill debe decir cómo habilitar el reporter json');
});

test('the mutation-testing skill teaches the .NET install and report path of the gate', async () => {
  const dir = await project({ 'Api.csproj': '<Project />' });
  const { mutation } = await detectGateConfig(dir);
  const text = await skill('mutation-testing');

  assert.ok(text.includes('dotnet new tool-manifest'), 'la instalación de .NET es local, no global');
  assert.ok(text.includes(mutation.report.split('/')[0]), 'la skill debe nombrar dónde deja el reporte Stryker.NET');
});

test('the mutation-testing skill teaches the mutmut command that produces a report file', async () => {
  const dir = await project({ 'pyproject.toml': '[project]\nname = "x"\ndependencies = ["pytest"]\n' });
  const { mutation } = await detectGateConfig(dir);
  const text = await skill('mutation-testing');

  assert.ok(text.includes('mutmut junitxml'), 'mutmut results imprime por pantalla: el portón necesita el XML');
  assert.ok(text.includes(mutation.report), `la skill debe apuntar al reporte "${mutation.report}"`);
});

test('the python-testing skill agrees with the mutmut command of the gate', async () => {
  const dir = await project({ 'requirements.txt': 'pytest\n' });
  const { mutation } = await detectGateConfig(dir);
  const text = await skill('python-testing');

  assert.ok(text.includes('mutmut junitxml'));
  assert.ok(text.includes(mutation.report));
});

test('the dotnet-testing skill agrees with the local install of the gate', async () => {
  const text = await skill('dotnet-testing');

  assert.ok(text.includes('dotnet new tool-manifest'));
  assert.doesNotMatch(text, /dotnet tool install\s+-g\b/, 'instalación global: rompe la reproducibilidad y el manifiesto');
});

test('the mutation-testing skill teaches the PIT report path the gate parses', async () => {
  const dir = await project({ 'pom.xml': '<project />' });
  const { mutation } = await detectGateConfig(dir);
  const text = await skill('mutation-testing');

  assert.ok(text.includes('target/pit-reports'), `la skill debe nombrar "${mutation.report}"`);
});

// ── lo que ninguna skill puede decir ──────────────────────────────────────────────────────────

// Es la frase que autoriza el auto-reporte: con el portón, chalc SÍ ejecuta y exige evidencia.
test('no skill claims that chalc does not run mutation testing', async () => {
  for (const { id, text } of await allSkills()) {
    assert.doesNotMatch(text, /chalc does not run mutation/i, `${id} contradice al portón`);
  }
});

test('no skill instructs a global tool install', async () => {
  for (const { id, text } of await allSkills()) {
    assert.doesNotMatch(text, /(?:tool install|npm i|npm install|pip install|composer require)[^\n]*\s-g\b/, `${id} instruye instalación global`);
  }
});

// Donde el portón no tiene parser, la etapa BLOQUEA. La skill tiene que decirlo y decir dónde se
// arregla, o el usuario ve el bloqueo como un fallo de chalc.
test('the mutation-testing skill warns where the gate has no parser yet', async () => {
  const text = await skill('mutation-testing');

  assert.match(text, /\.chalc\/gate\.json/, 'la skill debe indicar dónde se completa la config del portón');
  for (const tool of ['Dart', 'Flutter']) {
    assert.ok(text.includes(tool), `la skill debe decir qué pasa en ${tool}, que no tiene herramienta estándar`);
  }
});

// El portón lee el ARCHIVO de reporte, nunca el stdout: la skill no puede sugerir lo contrario.
test('the mutation-testing skill states that the score comes from the report file', async () => {
  const text = await skill('mutation-testing');

  assert.match(text, /\.chalc\/gate\.mjs/, 'la skill debe nombrar el portón que verifica la corrida');
});
