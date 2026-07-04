// cli/engine/reviewfile.mjs — bitácora PERSISTIDA del ciclo de calidad: .chalc/review.md registra,
// en orden real, lo que el revisor encontró, la orden de corrección LITERAL que recibió el junior,
// lo que el junior respondió y cómo cerró el portón de verificación (build). Es el hermano del
// plan.md: aquel muestra las órdenes del líder; este muestra el pulso revisor→junior→compilador.
// Lo escribe SOLO el orquestador con datos observados (veredictos, comandos, resultados) — nunca
// a pedido del modelo. Un run nuevo con revisión reemplaza la bitácora anterior.

import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from 'node:fs';
import { join, dirname } from 'node:path';

export const REVIEW_REL = '.chalc/review.md';
export const reviewPath = (projectPath) => join(projectPath, '.chalc', 'review.md');

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');
const indent = (text) => String(text || '').trim().split('\n').map((l) => '    ' + l).join('\n');

// Abre la bitácora de UNA revisión (reemplaza la anterior). opts.reviewer: etiqueta del modelo revisor.
export function startReview(projectPath, task, opts = {}) {
  if (!projectPath) return null;
  const file = reviewPath(projectPath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, [
    `# Revisión: ${String(task).trim()}`,
    '',
    `> Revisor: ${opts.reviewer || '(modelo base)'} · ${stamp()}`,
    ''
  ].join('\n'), 'utf8');
  return file;
}

const append = (projectPath, lines) => {
  const file = projectPath && reviewPath(projectPath);
  if (!file || !existsSync(file)) return false;
  appendFileSync(file, lines.join('\n') + '\n', 'utf8');
  return true;
};

// Veredicto de una ronda del revisor: OK o los hallazgos tal como los reportó.
export function logRound(projectPath, round, { ok, findings } = {}) {
  return append(projectPath, ok
    ? [`## Ronda ${round} — OK ✔`, '']
    : [`## Ronda ${round} — HALLAZGOS`, '', String(findings || '').trim(), '']);
}

// La orden de corrección LITERAL que viaja al junior (fixTask/verifyFixTask) y, al terminar, su resultado.
export function logFixOrder(projectPath, order) {
  return append(projectPath, ['### Orden de corrección al junior', '', indent(order), '']);
}
export function logFixResult(projectPath, { done, summary, error } = {}) {
  return append(projectPath, ['### Resultado del junior', '', done ? `✔ ${String(summary || '').trim()}` : `✗ ${String(error || 'sin resultado').trim()}`, '']);
}

// Portón de verificación: el comando real del stack y su veredicto (con cola de salida si falló).
export function logVerify(projectPath, round, { ok, command, output, timedOut } = {}) {
  const lines = [`## Verificación ronda ${round} — ${ok ? 'OK ✔' : `FALLÓ${timedOut ? ' (timeout)' : ''}`} (\`${command}\`)`, ''];
  if (!ok && output) lines.push(indent(String(output).split('\n').slice(-12).join('\n')), '');
  return append(projectPath, lines);
}

// Lectura simple (para tests y para saber si hay bitácora previa).
export function loadReview(projectPath) {
  const file = projectPath && reviewPath(projectPath);
  if (!file || !existsSync(file)) return null;
  return readFileSync(file, 'utf8');
}
