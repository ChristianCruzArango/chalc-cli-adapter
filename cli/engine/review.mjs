// cli/engine/review.mjs — F2 del orquestador multi-rol: modo REVIEW (revisar lo que el coder escribió).
// El reviewer es el MISMO runAgent con tools de SOLO LECTURA (reusa readOnlyTools del planner) y dos
// secciones extra: su rol y los CAMBIOS a revisar (git diff acotado; para archivos nuevos sin diff, el
// contenido). Entregable: done.summary = "OK" o una lista numerada corta de problemas REALES.
// Acotado por diseño: el orquestador (código) decide si hay ronda de corrección — nunca el modelo solo.

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runAgent } from './loop.mjs';
import { createRenderPrompt } from './harness.mjs';
import { frame } from '../prompts/text.mjs';
import { readOnlyTools } from './plan.mjs';

// Tope del material a revisar: la sección "cambios" es requerida (entra SIEMPRE al prompt), así que se
// acota aquí (~2k tokens) para no desbordar la ventana del modelo local.
const MAX_CHANGES = 8 * 1024;

// git diff HEAD de las rutas tocadas. '' si no hay repo / git falla (se cae al contenido de archivos).
function gitDiff(root, paths) {
  return new Promise((resolve) => {
    execFile('git', ['diff', 'HEAD', '--', ...paths], { cwd: root, maxBuffer: 4 * 1024 * 1024, windowsHide: true },
      (err, stdout) => resolve(err ? '' : String(stdout)));
  });
}

// Material a revisar para `paths` (rutas relativas al proyecto): diff de git donde exista; para archivos
// NUEVOS (sin diff: untracked o repo inexistente), el contenido completo. Siempre acotado a MAX_CHANGES.
export async function collectChanges(root, paths = []) {
  const unique = [...new Set(paths.filter(Boolean).map((p) => String(p).replace(/\\/g, '/')))];
  if (!unique.length) return '';
  let material = await gitDiff(root, unique);
  const covered = new Set([...material.matchAll(/^diff --git a\/(.+?) b\//gm)].map((m) => m[1]));
  for (const p of unique) {
    if (covered.has(p)) continue;
    try {
      material += `\n=== ${p} (archivo completo) ===\n${await readFile(join(root, p), 'utf8')}`;
    } catch { /* borrado o ilegible: se omite */ }
  }
  material = material.trim();
  return material.length > MAX_CHANGES ? material.slice(0, MAX_CHANGES) + '\n[…truncado]' : material;
}

// ¿El veredicto es "sin problemas"? El rol pide exactamente "OK", pero se tolera puntuación/adornos cortos.
const isOk = (summary) => /^ok\b[.!]?$/i.test(String(summary).trim());

// Corre el reviewer sobre `changes`. Devuelve { ok, findings, steps, interrupted?, error? }.
// ok=true con findings='' significa aprobado; error/interrupted → ni aprobado ni hallazgos (no se corrige a ciegas).
export async function runReviewer({ chatImpl, tools = {}, projectSections = [], task, changes, budgetTokens, language, maxSteps = 6, onStep, shouldStop, ccr } = {}) {
  if (!changes || !String(changes).trim()) return { ok: true, findings: '', steps: [], empty: true };
  const f = frame(language);
  const roTools = readOnlyTools(tools);
  const sections = [
    ...projectSections,
    { key: 'rol:reviewer', text: f.reviewerRole, required: true },
    { key: 'cambios', text: `${f.changesTitle}\n${changes}`, required: true }
  ];
  const renderPrompt = createRenderPrompt({ task, tools: roTools, projectSections: sections, budgetTokens, language });
  const r = await runAgent({ chatImpl, tools: roTools, renderPrompt, ccr, maxSteps, onStep, shouldStop });
  if (!r.done) return { ok: false, findings: '', steps: r.steps, interrupted: r.interrupted, error: r.error };
  const summary = String(r.summary || '').trim();
  return { ok: isOk(summary), findings: isOk(summary) ? '' : summary, steps: r.steps };
}

// Rutas tocadas con éxito por write/edit en los pasos de un turno (para saber QUÉ revisar).
// Usa observation.path (lo devuelven las fs tools) — sobrevive a la compactación CCR por ser corto.
export function touchedPaths(result) {
  const paths = [];
  for (const r of result?.steps || []) {
    const tool = r.action?.tool;
    if ((tool === 'write' || tool === 'edit') && r.observation?.ok && r.observation?.path) {
      paths.push(String(r.observation.path));
    }
  }
  return [...new Set(paths)];
}
