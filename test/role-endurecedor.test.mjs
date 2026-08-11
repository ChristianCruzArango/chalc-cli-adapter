// T11–T12 (R10, R11) — el rol nuevo, y la razón por la que no estorba.
//
// El portón mide lo medible. El revisor juzga calidad de test, abstracción, nombres y mínimo. Nadie
// pregunta específicamente qué pasa cuando la entrada es inválida, cuando la dependencia externa
// falla o cuando llega el caso borde — que es donde vive la mayoría de los bugs reales.
//
// El riesgo de añadir un rol no es que falte: es que SOBRE. Un rol que repite lo que otro ya dijo se
// ignora entero, y con él el que sí aportaba. Por eso la no-superposición es un requisito (R10) y se
// comprueba aquí, en los dos sentidos: lo que el endurecedor NO reclama, y lo que declara ajeno.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS_DIR, loadRoles, toolsFor } from '../lib/roles.mjs';

const ROOT = resolvePath(dirname(fileURLToPath(import.meta.url)), '..');

const roles = await loadRoles();
const endurecedor = roles.find((r) => r.id === 'endurecedor');

const promptOf = (id, file) => readFile(join(AGENTS_DIR, id, file), 'utf8');

// ── T11: existe y su contrato es coherente ────────────────────────────────────────────────────

test('R10 — el endurecedor existe y entra al cerrar la feature', () => {
  assert.ok(endurecedor, 'falta el rol endurecedor');
  assert.equal(endurecedor.cadence, 'feature', 'su cadencia por defecto es por feature (R15)');
});

test('R10 — va después del revisor: audita sobre código ya revisado', () => {
  const revisor = roles.find((r) => r.id === 'revisor');
  assert.ok(endurecedor.order > revisor.order);
});

test('R10 — deja bitácora como el revisor, y no puede tocar nada más', () => {
  assert.deepEqual(endurecedor.writes, ['.chalc/review.md']);
  assert.doesNotThrow(() => toolsFor(endurecedor));
  for (const forbidden of ['Edit', 'NotebookEdit', 'MultiEdit']) {
    assert.ok(!endurecedor.tools.includes(forbidden));
  }
});

test('R11 — su prompt existe en los dos idiomas y cubre los cuatro frentes', async () => {
  const frentes = {
    es: [/entrada|inválid/i, /error|excepci/i, /borde|límite/i, /depend|externa|red|timeout/i],
    en: [/input|invalid/i, /error|exception/i, /edge|boundary/i, /depend|external|network|timeout/i]
  };

  for (const [code, patterns] of Object.entries(frentes)) {
    const text = await promptOf('endurecedor', code === 'es' ? 'agent.md' : 'agent.en.md');
    for (const pattern of patterns) {
      assert.match(text, pattern, `endurecedor/${code}: no cubre ${pattern}`);
    }
  }
});

test('R11 — su prompt lleva el marcador de skills, como el resto', async () => {
  for (const file of ['agent.md', 'agent.en.md']) {
    assert.match(await promptOf('endurecedor', file), /\{\{SKILLS\}\}/, `${file}: falta el marcador`);
  }
});

test('R8 — su bitácora se firma con SU id, no con el del revisor', async () => {
  for (const file of ['agent.md', 'agent.en.md']) {
    const text = await promptOf('endurecedor', file);
    assert.match(text, /endurecedor/, `${file}: la entrada debe llevar su propio rol`);
    assert.ok(!/·\s*revisor\s*·/.test(text), `${file}: no puede firmar como el revisor`);
  }
});

// ── T12: no se solapa con el portón ni con el revisor ─────────────────────────────────────────

test('R10 — no reclama lo que el portón ya mide', async () => {
  // Repetir una medida que otro calculó es de donde salen los "score 92%" que nadie ejecutó.
  const medibles = [/score de mutación|mutation score/i, /fronteras de capa|layer boundaries/i,
    /una cosa por archivo|one thing per file/i, /trazabilidad|traceability/i];

  for (const file of ['agent.md', 'agent.en.md']) {
    const text = await promptOf('endurecedor', file);
    for (const pattern of medibles) {
      assert.ok(!pattern.test(text), `${file}: el endurecedor reclama ${pattern}, que ya mide el portón`);
    }
  }
});

test('R10 — declara explícitamente qué NO es suyo', async () => {
  for (const [file, pattern] of [['agent.md', /No es tuyo|no te corresponde/i], ['agent.en.md', /Not yours|not your job/i]]) {
    assert.match(await promptOf('endurecedor', file), pattern, `${file}: falta la delimitación explícita`);
  }
});

test('R10 — el revisor tampoco invade lo del endurecedor', async () => {
  // La delimitación tiene que ser recíproca, o los dos acaban diciendo lo mismo.
  for (const [file, pattern] of [['agent.md', /endurecedor/i], ['agent.en.md', /endurecedor|hardener/i]]) {
    assert.match(await promptOf('revisor', file), pattern, `revisor/${file}: no remite al otro rol`);
  }
});

test('R10 — los dos roles no comparten su frase de propósito', async () => {
  const revisor = await promptOf('revisor', 'agent.md');
  const hardener = await promptOf('endurecedor', 'agent.md');

  const firstLine = (t) => t.split(/\r?\n/).find((l) => l.trim().length > 40);
  assert.notEqual(firstLine(revisor), firstLine(hardener));
});
