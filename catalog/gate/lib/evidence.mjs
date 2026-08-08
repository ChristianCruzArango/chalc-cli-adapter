// evidence.mjs — `.chalc/gate.md`, el informe de la corrida (R9). Responsabilidad ÚNICA: convertir
// los resultados de las etapas en un documento que un humano pueda auditar. Razón de cambio: qué
// lleva el informe y cómo se presenta.
//
// Este archivo lo emite chalc dentro de `.chalc/gate/lib/`. No edites aquí: ajusta `.chalc/gate.json`.
//
// Este archivo es lo que hace verificable al portón. Un asistente puede decir "corrí las pruebas y
// el score fue 92"; lo que no puede es fabricar un informe con la fecha, la rama, los comandos, sus
// códigos de salida reales y la lista de sobrevivientes — y que además coincida con lo que el
// usuario ve al correr el portón él mismo.

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { frameOf, messageOf } from './i18n.mjs';

export const EVIDENCE_REL = '.chalc/gate.md';

const pad = (n) => String(n).padStart(2, '0');

// Fecha local en formato estable. Sin librerías y sin sorpresas de zona horaria: lo que el usuario
// ve es la hora de su máquina, que es cuando corrió.
const stamp = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;

// Duración legible sin perder la magnitud: la etapa de mutación tarda minutos y eso debe verse.
const duration = (ms) => (typeof ms !== 'number' ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);

// Una barra dentro de una celda partiría la tabla en dos columnas fantasma.
const cell = (value) => String(value ?? '').replace(/\|/g, '\\|');

const row = (cells) => `| ${cells.map(cell).join(' | ')} |`;

const table = (headers, rows) => [row(headers), row(headers.map(() => '---')), ...rows.map(row)].join('\n');

// Estado de una etapa, en palabras del marco. El motivo de una omisión importa tanto como la
// omisión: no es lo mismo saltarse la mutación por `--fast` que porque el stack no la admite.
function statusOf(stage, frame) {
  if (stage.blocked) return frame.status.blocked;
  if (stage.skipped) {
    if (stage.reason === 'fast') return frame.status.skippedFast;
    if (stage.reason === 'tests-failed') return frame.status.skippedDependency;
    return frame.status.notApplicable;
  }
  return stage.ok ? frame.status.passed : frame.status.failed;
}

// El veredicto de la corrida. Un BLOQUEO pesa más que un fallo: "no pude comprobarlo" y "lo comprobé
// y está mal" se arreglan de formas distintas, y quien lea el informe necesita saber cuál de las dos
// tiene delante. Lo exporta este módulo para que el código de salida del portón y el titular del
// informe salgan del MISMO cálculo y no puedan contradecirse.
export function verdictOf(stages) {
  if (stages.some((s) => s.blocked)) return 'blocked';
  if (stages.some((s) => !s.skipped && !s.ok)) return 'fail';
  return 'pass';
}

// Sección de mutación: solo si la etapa llegó a medir algo.
function mutationSection(stages, frame) {
  const stage = stages.find((s) => s.stage === 'mutation' && typeof s.score === 'number');
  if (!stage) return [];

  const survivors = stage.survivors || [];
  const head = [
    `**${frame.mutation.score} ${stage.score}%** (${frame.mutation.threshold} ${stage.threshold}%)`,
    typeof stage.killed === 'number' ? ` · ${stage.killed} ${frame.mutation.killed}` : '',
    ` · ${survivors.length} ${frame.mutation.survivors}`
  ].join('');

  const section = [`## ${frame.mutation.title}`, '', head];
  if (survivors.length) {
    section.push('', table(
      [frame.mutation.file, frame.mutation.line, frame.mutation.mutator, frame.mutation.state],
      survivors.map((s) => [s.file, s.line, s.mutator, s.status])
    ));
  }
  return [...section, ''];
}

// Todos los hallazgos de la corrida, ya redactados en el idioma del spec.
function findingsSection(stages, frame, lang) {
  const findings = stages.flatMap((s) => s.findings || []);
  const section = [`## ${frame.findings.title}`, ''];

  if (!findings.length) return [...section, frame.findings.none, ''];

  return [...section, table(
    [frame.findings.file, frame.findings.line, frame.findings.rule, frame.findings.detail],
    findings.map((f) => [f.file || '—', f.line || '—', f.rule, messageOf(f.rule, f.data, lang)])
  ), ''];
}

// Arma el informe. `stages` son los resultados tal como los devuelven las etapas; `meta` trae la
// fecha, la rama, el rol del repo y la spec. Devuelve markdown.
export function renderEvidence({ stages, meta, lang = 'en' }) {
  const frame = frameOf(lang);
  const verdict = verdictOf(stages);

  const lines = [
    `# ${frame.title} — ${stamp(meta.date)}`,
    '',
    `- ${frame.branch}: \`${meta.branch || '—'}\``,
    `- ${frame.role}: ${meta.role || '—'}`,
    `- ${frame.spec}: ${meta.spec || '—'}`,
    '',
    `## ${frame.verdict[verdict]}`,
    ''
  ];

  // El aviso de `--fast` va arriba: quien lea el informe tiene que saber ANTES que el verde de esta
  // corrida no cierra la tarea (R11).
  if (stages.some((s) => s.skipped && s.reason === 'fast')) lines.push(frame.fast, '');

  lines.push(`## ${frame.stages.title}`, '', table(
    [frame.stages.name, frame.stages.result, frame.stages.command, frame.stages.code, frame.stages.duration],
    stages.map((s) => [
      frame.stages[s.stage] || s.stage,
      statusOf(s, frame),
      s.command ? `\`${s.command}\`` : '—',
      s.code === null || s.code === undefined ? '—' : s.code,
      duration(s.ms)
    ])
  ), '');

  lines.push(...mutationSection(stages, frame), ...findingsSection(stages, frame, lang));
  return lines.join('\n');
}

// Deja el informe en `.chalc/gate.md` y devuelve su ruta relativa.
export async function writeEvidence(root, markdown) {
  await mkdir(join(root, '.chalc'), { recursive: true });
  await writeFile(join(root, EVIDENCE_REL), markdown, 'utf8');
  return EVIDENCE_REL;
}
