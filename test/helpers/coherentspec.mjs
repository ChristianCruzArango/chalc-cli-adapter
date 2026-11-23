// test/helpers/coherentspec.mjs — una carpeta de spec COHERENTE y aprobada para los proyectos de prueba
// (spec 024). Responsabilidad ÚNICA: dar los archivos (hu, spec, plan, tasks y su sello) que el portón y el
// advisor exigen antes de dejar pasar a tests y código, para que cada test de otra etapa no tenga que
// escribirlos a mano. La huella y el hash salen del MISMO código que los comprueba.

import { huHash, specFingerprint } from '../../catalog/gate/lib/specprint.mjs';
import { firstOpenTask } from '../../catalog/gate/lib/specparse.mjs';
import { taskKeyOf } from '../../catalog/gate/lib/tdd.mjs';

const baseOf = (dir) => dir.split('/').pop();

/** Textos de una spec coherente con los requisitos `ids` (uno por fragmento de la HU). */
export function coherentTexts(ids = ['R1']) {
  const fragment = (i) => `criterio ${i + 1} de la historia`;
  return {
    'hu.md': ['# HU: demo', '', 'Fuente: historia.md', '', '## Texto original', '', ...ids.map((_, i) => `El sistema cumple el ${fragment(i)}.`),
      '', '## Fragmentos trazables', '', ...ids.map((_, i) => `- **HU-${i + 1}** — ${fragment(i)}`)].join('\n') + '\n',
    'spec.md': ['# Spec: demo', '', ...ids.map((id, i) => `- **${id}** (HU-${i + 1}) — WHEN algo THE SYSTEM SHALL otra cosa.`)].join('\n') + '\n',
    'plan.md': `# Plan\n\nCubre ${ids.join(', ')}.\n`,
    'tasks.md': ['# Tasks', '', ...ids.map((id, i) => `- [ ] **T${i + 1}** (${id}) — test e implementación`)].join('\n') + '\n'
  };
}

/** El sello (objeto) que aprueba `texts` para la carpeta `dir`. */
export const sealFor = (dir, texts, date = '2026-01-01T00:00:00.000Z') => ({
  dir, hu: huHash(texts['hu.md']), fingerprint: specFingerprint(texts), date, approvedBy: 'user'
});

/** Mapa `ruta → contenido` de una spec coherente en `dir`; con `sealed`, incluye su sello vigente. */
// `ticked`: todas las tareas ya marcadas. Sin tarea en curso, las comprobaciones de Test-First de la spec 030 no
// aplican: es lo que quieren los tests de OTRAS etapas del portón, que no van de eso.
export function coherentSpec(dir, { ids = ['R1'], sealed = true, red = true, ticked = false, texts: given = coherentTexts(ids) } = {}) {
  const texts = ticked ? { ...given, 'tasks.md': given['tasks.md'].replace(/\[ \]/g, '[x]') } : given;
  const files = Object.fromEntries(Object.entries(texts).map(([name, text]) => [`${dir}/${name}`, text]));
  if (sealed) files[`.chalc/seals/${baseOf(dir)}.spec.json`] = JSON.stringify(sealFor(dir, texts), null, 2);
  // El rojo de la tarea en curso ya registrado (spec 030), sin tests sellados: lo que prueban los tests de otras
  // etapas va después de él.
  const open = firstOpenTask(texts['tasks.md']);
  if (red && open) files['.chalc/tdd.jsonl'] = JSON.stringify({ task: taskKeyOf(dir, open), kind: 'red', date: '2026-01-01T00:00:00.000Z', tests: {} }) + '\n';
  return files;
}
