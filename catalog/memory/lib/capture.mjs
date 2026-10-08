// capture.mjs — la memoria se llena sola al cerrar una tarea (spec 015, R6, R11–R13). Responsabilidad
// ÚNICA: convertir lo que el ciclo dejó escrito en entradas de memoria. Razón de cambio: qué se
// aprende de una tarea.
//
// Este archivo lo emite chalc dentro de `.chalc/memory/lib/`. No edites aquí: se regenera al equipar.
//
// chalc no le pide al modelo que guarde nada: lee lo que ya existe. Las reglas aprendidas salen de
// las entradas de los roles en `.chalc/review.md`; las decisiones, de las supresiones que aceptó el
// portón. Cada captura lee solo lo posterior a la anterior: capturar dos veces lo mismo sumaría una
// «vez vista» que no ocurrió.

import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { allReviews } from '../../next/lib/review.mjs';
import { parseGateState } from '../../next/lib/state.mjs';
import { currentTask } from '../../next/lib/tasks.mjs';
import { headCommit } from '../../gate/lib/changed.mjs';
import { loadConfig } from '../../gate/lib/config.mjs';
import { newestSpec } from '../../gate/lib/spec.mjs';
import { STATE_REL as GATE_STATE_REL } from '../../gate/lib/evidence.mjs';
import { textOf } from '../../gate/lib/data.mjs';
import { compactIfNeeded, remember } from './store.mjs';
import { conceptsIn, learnSynonym, loadConcepts, normalizePhrase } from './concepts.mjs';

const STATE_REL = '.chalc/memory/state.json';
const REF = /[\w./-]+\.\w+(?=:\d+|\b)/g;


// El id de un concepto escrito por un rol. Si el rol usó un sinónimo («money»), es el concepto al que
// pertenece; si usó una palabra que nadie conocía, es un concepto nuevo.
function conceptId(raw, concepts) {
  const known = conceptsIn(raw, concepts);
  return known.length === 1 ? known[0] : normalizePhrase(raw).replace(/ /g, '-');
}

// La clave de una regla: sus palabras normalizadas, una a una. La misma regla con otra puntuación o
// mayúsculas es la misma regla.
const slug = (text) => normalizePhrase(text).replace(/ /g, '-').slice(0, 80);

// Dónde se aprendió: la spec vigente y la tarea que se está cerrando, con su marca `[bug]`.
async function originOf(root) {
  const { config } = await loadConfig(root);
  const spec = await newestSpec(root, config.spec?.dir || 'specs', 'tasks.md');
  const task = currentTask(spec?.text || '');
  return {
    spec: spec?.dir ? basename(spec.dir) : '',
    task: (task.match(/\b(T\d+[a-z]?)\b/) || [, ''])[1],
    bug: /\[bug\]/i.test(task)
  };
}

// Las reglas que los roles dejaron después de `since`, como entradas de memoria.
async function ruleEntries(root, { since, origin, commit }) {
  const concepts = await loadConcepts(root);
  const entries = [];
  for (const review of allReviews(await textOf(join(root, '.chalc/review.md'))).filter((r) => r.date > since)) {
    for (const rule of review.learned) {
      const concept = conceptId(rule.concept, concepts);
      for (const synonym of rule.synonyms) await learnSynonym(root, concept, synonym);
      const title = rule.text.split(' — ')[0].trim();
      entries.push({
        key: `${concept}:${slug(title)}`, kind: origin.bug ? 'bug' : 'rule', concepts: [concept], title,
        detail: rule.text, files: [...new Set(rule.text.match(REF) || [])], commit,
        origin: { spec: origin.spec, task: origin.task, role: review.role }
      });
    }
  }
  return entries;
}

// Las supresiones aceptadas por la corrida del portón, si es posterior a `since`.
async function decisionEntries(root, { since, origin, commit }) {
  const state = parseGateState(await textOf(join(root, GATE_STATE_REL)));
  if (!state.exists || state.date <= since) return [];
  const concepts = await loadConcepts(root);
  return state.suppressions.map((s) => ({
    key: `decision:${s.rule}:${s.file}`, kind: 'decision', concepts: conceptsIn(`${s.reason} ${s.file}`, concepts),
    title: `${s.rule} aceptado en ${s.file}: ${s.reason}`, detail: s.reason, files: [s.file], commit,
    origin: { spec: origin.spec, task: origin.task, role: 'gate' }
  }));
}

// Captura lo nuevo desde la última vez. Devuelve cuántas reglas y decisiones guardó.
export async function capture(root, { now = new Date() } = {}) {
  const statePath = join(root, STATE_REL);
  // Un estado ilegible no tumba la captura: se trata como «nunca se capturó» y se vuelve a leer todo.
  // Es estado de máquina (solo una marca de tiempo) y `remember` deduplica: perderlo no pierde nada.
  let state = {};
  try { state = JSON.parse((await textOf(statePath)) || '{}') || {}; } catch { state = {}; }
  const since = Date.parse(state.capturedUntil || 0) || 0;
  const context = { since, origin: await originOf(root), commit: (await headCommit(root)).slice(0, 10) };

  const rules = await ruleEntries(root, context);
  const decisions = await decisionEntries(root, context);
  for (const entry of [...rules, ...decisions]) await remember(root, entry, { now });

  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, JSON.stringify({ capturedUntil: now.toISOString() }, null, 2) + '\n', 'utf8');
  await compactIfNeeded(root);
  return { rules: rules.length, decisions: decisions.length };
}
