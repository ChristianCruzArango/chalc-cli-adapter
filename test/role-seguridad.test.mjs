// spec 014 · T14, T15, T25, T26 (R17, R21, R27, R28) — el rol `seguridad`.
//
// El portón ya detecta lo que se afirma con archivo y línea. Lo que pide entender el programa —si una
// ruta exige permiso, si un dato es sensible, si una entrada llega de fuera— lo revisa este rol, en
// CADA tarea, antes que el revisor. Y no puede dar `OK` de palabra: deja una checklist por categoría
// que el advisor comprueba (R29), y lee la referencia concreta de su stack en vez de un catálogo de
// veinte mil líneas.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS_DIR, loadRoles, toolsFor } from '../lib/roles.mjs';

const SKILLS_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '..'), 'catalog', 'skills');
const PROMPTS = { es: 'agent.md', en: 'agent.en.md' };

const roles = await loadRoles();
const seguridad = roles.find((r) => r.id === 'seguridad');
const promptOf = (code) => readFile(join(AGENTS_DIR, 'seguridad', PROMPTS[code]), 'utf8');

const OWASP = ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10'];
const MASVS = ['STORAGE', 'CRYPTO', 'AUTH', 'NETWORK', 'PLATFORM', 'CODE', 'RESILIENCE', 'PRIVACY'].map((g) => `MASVS-${g}`);

// ── T14 (R17): el contrato ────────────────────────────────────────────────────────────────────

test('R17: the security role exists and runs on every task', () => {
  assert.ok(seguridad, 'falta el rol seguridad');
  assert.equal(seguridad.cadence, 'task');
});

// Va antes del revisor: el revisor comprueba que las correcciones de seguridad son reales (R23).
test('R17: it runs before the reviewer', () => {
  const revisor = roles.find((r) => r.id === 'revisor');
  assert.ok(seguridad.order < revisor.order);
});

test('R17: it may only append to its log and cannot edit code', () => {
  assert.deepEqual(seguridad.writes, ['.chalc/review.md']);
  assert.doesNotThrow(() => toolsFor(seguridad));
  for (const forbidden of ['Edit', 'NotebookEdit', 'MultiEdit']) assert.ok(!seguridad.tools.includes(forbidden));
});

// ── T15 (R21): qué revisa y qué no ────────────────────────────────────────────────────────────

test('R21: the prompt covers what the gate cannot measure, in both languages', async () => {
  const fronts = {
    es: [/autorizaci/i, /autenticaci/i, /sesi[oó]n/i, /datos sensibles/i, /entrada/i, /SSRF/, /deserializaci/i],
    en: [/authori[sz]ation/i, /authentication/i, /session/i, /sensitive data/i, /input/i, /SSRF/, /deseriali[sz]ation/i]
  };
  for (const [code, patterns] of Object.entries(fronts)) {
    const text = await promptOf(code);
    for (const pattern of patterns) assert.match(text, pattern, `seguridad/${code}: no cubre ${pattern}`);
  }
});

test('R21: the prompt forbids repeating the findings of the gate security stage', async () => {
  assert.match(await promptOf('es'), /etapa `security`[^]*no (?:los )?repitas|no repitas[^]*etapa `security`/i);
  assert.match(await promptOf('en'), /`security` stage[^]*do not repeat|do not repeat[^]*`security` stage/i);
});

test('R21: the prompt carries the skills marker and the fixed log header with its role', async () => {
  for (const code of Object.keys(PROMPTS)) {
    const text = await promptOf(code);
    assert.ok(text.includes('{{SKILLS}}'), `${code}: falta {{SKILLS}}`);
    assert.match(text, /## \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ · [0-9a-f]+ · seguridad · OK/, `${code}: encabezado OK`);
    assert.match(text, /## \d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ · [0-9a-f]+ · seguridad · FINDINGS: \d+/, `${code}: encabezado FINDINGS`);
  }
});

// ── T25 (R27): qué lee, según el stack ────────────────────────────────────────────────────────

// Cada ruta que el prompt manda leer tiene que existir: `security-review` ya cita guías que no
// existen, y una referencia rota hace que el modelo improvise justo donde se le pedía precisión.
test('R27: every skill file the prompt points to exists in the catalog', async () => {
  for (const code of Object.keys(PROMPTS)) {
    const paths = [...(await promptOf(code)).matchAll(/`((?:security-review|code-security|security-and-hardening|secure-coding)\/[\w./-]+\.md)`/g)]
      .map((m) => m[1]);
    assert.ok(paths.length >= 8, `${code}: el mapa de lectura cita muy pocas referencias (${paths.length})`);
    for (const path of paths) assert.ok(existsSync(join(SKILLS_DIR, path)), `${code}: no existe ${path}`);
  }
});

test('R27: the prompt forbids reading the 4,900-line catalog file whole', async () => {
  assert.match(await promptOf('es'), /no leas[^.\n]*`code-security\/AGENTS\.md`/i);
  assert.match(await promptOf('en'), /do not read[^.\n]*`code-security\/AGENTS\.md`/i);
});

// Las skills son de terceros: una pide revisar «the ENTIRE codebase», otra aplicar el arreglo. El
// contrato del rol tiene que ganarles, y decirlo.
test('R27: the role contract takes precedence over what any skill says', async () => {
  assert.match(await promptOf('es'), /tu contrato manda/i);
  assert.match(await promptOf('en'), /your contract (?:wins|takes precedence)/i);
});

// ── T26 (R28): la checklist ───────────────────────────────────────────────────────────────────

test('R28: the prompt asks for one checklist line per OWASP category and, on mobile, per MASVS group', async () => {
  for (const code of Object.keys(PROMPTS)) {
    const text = await promptOf(code);
    for (const id of [...OWASP, ...MASVS]) assert.ok(text.includes(id), `${code}: falta ${id}`);
  }
});

test('R28: the checklist line format is fixed: reviewed with file:line, or not applicable with a reason', async () => {
  const es = await promptOf('es');
  assert.match(es, /- A01 [^:\n]*: revisado — [\w./-]+:\d+/);
  assert.match(es, /- A\d\d [^:\n]*: no aplica — \S+ \S+ \S+/);

  const en = await promptOf('en');
  assert.match(en, /- A01 [^:\n]*: reviewed — [\w./-]+:\d+/);
  assert.match(en, /- A\d\d [^:\n]*: n\/a — \S+ \S+ \S+/);
});

test('R28: each finding cites its category and the skill rule it relies on', async () => {
  assert.match(await promptOf('es'), /categor[ií]a[^.\n]*regla de la skill|regla de la skill[^.\n]*categor[ií]a/i);
  assert.match(await promptOf('en'), /category[^.\n]*skill rule|skill rule[^.\n]*category/i);
});
