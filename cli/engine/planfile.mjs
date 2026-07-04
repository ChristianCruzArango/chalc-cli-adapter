// cli/engine/planfile.mjs — órdenes de trabajo PERSISTIDAS: el plan aprobado vive en .chalc/plan.md
// como un documento LEGIBLE para el usuario: quién es el líder, el estado, el checklist, y la orden
// EXACTA que recibe el junior por cada tarea (transparencia total del contrato líder→junior).
// Diseño con dos reglas duras:
//   1) El planner (líder) se llama UNA sola vez: sus órdenes quedan escritas en disco. Un run caído
//      se retoma desde la primera tarea pendiente SIN re-planear (cero llamadas extra al modelo).
//   2) El MODELO nunca marca ni borra tareas — el HARNESS marca [x] cuando el paso pasó sus candados
//      deterministas (un modelo local declara "done" sin hacer nada; la evidencia decide, no él).
// Se marca en vez de borrar: el checklist completado queda como bitácora auditable del run.

import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { planItems, stepTask, stepIsSpecWork } from './plan.mjs';
import { folderSlug } from '../../lib/specfolder.mjs';

// Ruta relativa (para mensajes al usuario) y absoluta del checklist dentro del proyecto.
export const PLAN_REL = '.chalc/plan.md';
export const planPath = (projectPath) => join(projectPath, '.chalc', 'plan.md');

// Spec del plan: el documento que el LÍDER redacta junto al plan (una sección "## Task N" por tarea).
// Cada orden al desarrollador viaja con SU sección — contexto pequeño pero bien documentado, tarea
// por tarea. El desarrollador jamás lo escribe: solo lo consume.
// DÓNDE vive: en la carpeta specs/ del PROYECTO si el proyecto maneja esa convención (SDD) — ahí es
// donde el usuario espera sus especificaciones — con .chalc/spec.md como fallback si no hay specs/.

// Sello invisible que marca un spec redactado por el LÍDER de chalc-cli: distingue nuestros archivos
// de los spec del usuario (spec-ia, manuales). SOLO se sobreescribe lo que lleva el sello — un spec
// ajeno jamás se pisa (anti-destrucción).
export const SPEC_STAMP = '<!-- chalc:plan-spec -->';

// Fallback cuando el proyecto NO tiene carpeta specs/: el spec vive junto al plan en .chalc.
export const SPEC_REL = '.chalc/spec.md';
export const specPath = (projectPath) => join(projectPath, '.chalc', 'spec.md');

// ¿Podemos escribir este archivo? Sí si no existe o si lo escribimos NOSOTROS (lleva el sello).
function canClaim(file) {
  if (!existsSync(file)) return true;
  try { return readFileSync(file, 'utf8').includes(SPEC_STAMP); } catch { return false; }
}

// Slug corto del objetivo para la carpeta specs/NNN-slug (sin acentos, máximo 5 palabras).
export function goalSlug(goal) {
  const s = String(goal || '').trim().toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return s.split('-').filter(Boolean).slice(0, 5).join('-') || 'plan';
}

// Resuelve DÓNDE guardar el spec del líder. Con carpeta specs/ en el proyecto: reúsa la carpeta del
// mismo slug (idempotente: re-planear la misma meta no crea NNN+1 duplicados) o crea la siguiente
// NNN-slug; dentro, spec.md — y si ya hay un spec.md AJENO (del usuario o de spec-ia), spec-plan.md
// al lado (jamás se pisa lo que no es nuestro). Sin specs/: fallback .chalc/spec.md.
export function specTarget(projectPath, goal) {
  const specsDir = join(projectPath, 'specs');
  if (existsSync(specsDir)) {
    const slug = goalSlug(goal);
    let dirs = [];
    try { dirs = readdirSync(specsDir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { /* ilegible: fallback */ }
    let name = dirs.find((n) => folderSlug(n) === slug);
    if (!name) {
      const max = dirs.reduce((n, d) => { const m = d.match(/^(\d{1,4})-/); return m ? Math.max(n, parseInt(m[1], 10)) : n; }, 0);
      name = `${String(max + 1).padStart(3, '0')}-${slug}`;
    }
    for (const base of ['spec.md', 'spec-plan.md']) {
      const file = join(specsDir, name, base);
      if (canClaim(file)) return { rel: `specs/${name}/${base}`, file };
    }
  }
  return { rel: SPEC_REL, file: specPath(projectPath) };
}

// Spec enlazado por el plan vigente: { rel, text } ('' ambos si no hay). Sigue el enlace `> Spec:` de
// plan.md — la única fuente de verdad de QUÉ spec gobierna ESTE plan (viva donde viva el archivo).
export function specInfo(projectPath) {
  const none = { rel: '', text: '' };
  const plan = projectPath && planPath(projectPath);
  if (!plan || !existsSync(plan)) return none;
  const rel = (readFileSync(plan, 'utf8').match(/^> Spec:\s*(\S+)/m) || [])[1];
  if (!rel) return none;
  try {
    const text = readFileSync(join(projectPath, rel), 'utf8').trim();
    return text ? { rel, text } : none;
  } catch { return none; }
}

// Texto del spec del plan vigente ('' si no hay): executePlan lo carga para armar cada orden,
// también al RETOMAR (el enlace quedó persistido en plan.md).
export function loadSpec(projectPath) {
  return specInfo(projectPath).text;
}

const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

// Escribe el plan aprobado como documento de órdenes de trabajo. Un plan por proyecto: aprobar uno
// nuevo reemplaza al anterior (el usuario ya decidió ejecutar ESTE). Devuelve la ruta, o null sin ítems.
// opts.leader: etiqueta del modelo que planeó (para que el documento diga QUIÉN dio las órdenes).
// opts.spec: el SPEC que el líder redactó junto al plan — se persiste donde diga specTarget (la
// carpeta specs/ del proyecto, o .chalc de fallback), el plan lo ENLAZA (`> Spec:`), y cada orden
// embebe SU sección. Un plan nuevo reemplaza el enlace; el fallback .chalc/spec.md huérfano se borra
// (los archivos bajo specs/ del proyecto son entregables del usuario: JAMÁS se borran).
export function savePlan(projectPath, goal, plan, opts = {}) {
  const items = planItems(plan);
  if (!projectPath || !items.length) return null;
  const file = planPath(projectPath);
  mkdirSync(dirname(file), { recursive: true });
  const spec = String(opts.spec || '').trim();
  let specRel = '';
  if (spec) {
    const target = specTarget(projectPath, String(goal).trim());
    mkdirSync(dirname(target.file), { recursive: true });
    writeFileSync(target.file, [
      SPEC_STAMP,
      `# Spec: ${String(goal).trim()}`,
      '',
      `> Redactado por el líder: ${opts.leader || '(modelo base)'} · ${stamp()}`,
      `> El desarrollador recibe SOLO la sección de su tarea en cada turno. Él nunca escribe este documento.`,
      '',
      spec,
      ''
    ].join('\n'), 'utf8');
    specRel = target.rel;
    if (target.rel !== SPEC_REL) rmSync(specPath(projectPath), { force: true });   // sin residuos del fallback
  } else {
    rmSync(specPath(projectPath), { force: true });   // SOLO nuestro fallback; specs/ del proyecto no se toca
  }
  const lines = [
    `# Plan: ${String(goal).trim()}`,
    '',
    `> Líder: ${opts.leader || '(modelo base)'} · ${stamp()}`,
    `> Estado: 0/${items.length} completadas`,
    ...(specRel ? [`> Spec: ${specRel} — redactado por el líder; cada tarea viaja con su sección`] : []),
    '',
    '## Checklist',
    '',
    ...items.map((it) => `- [ ] ${it}`),
    '',
    '## Órdenes literales al junior (una por tarea)',
    '',
    'Esto es EXACTAMENTE lo que recibe el agente ejecutor en cada turno (en inglés, el idioma de los modelos).',
    'Además de su orden viajan: el plan completo, las skills relevantes a SU tarea, las best practices',
    'del framework, el árbol del proyecto y sus herramientas (read/list/grep/write/edit/bash/MCP).',
    'Las tareas de ESPECIFICACIÓN las redacta el agente LÍDER (el mismo que planeó): el desarrollador',
    'solo recibe órdenes y jamás escribe los documentos que gobiernan su propio trabajo.',
    '',
    ...items.flatMap((it, i) => [
      `### Tarea ${i + 1}${stepIsSpecWork(it) ? ' — la redacta el agente LÍDER (documento de especificación)' : ' — la ejecuta el agente DESARROLLADOR'}`,
      '',
      ...stepTask(String(goal).trim(), items, i, spec).split('\n').map((l) => '    ' + l),
      ''
    ]),
    '_El harness marca [x] cada tarea SOLO cuando sus candados confirman el cambio real;_',
    '_el modelo nunca marca su propio trabajo. Retomable con `/plan` (sin argumento)._',
    ''
  ];
  writeFileSync(file, lines.join('\n'), 'utf8');
  return file;
}

// Lee el checklist guardado. null si no existe o no tiene tareas parseables — el llamador decide
// (p. ej. /plan sin argumento solo ofrece retomar cuando pending > 0).
export function loadPlan(projectPath) {
  const file = projectPath && planPath(projectPath);
  if (!file || !existsSync(file)) return null;
  const text = readFileSync(file, 'utf8');
  const goal = (text.match(/^#\s*Plan:\s*(.+)$/m) || [])[1]?.trim() || '';
  const items = [...text.matchAll(/^- \[([ xX])\]\s+(.+)$/gm)].map((m) => ({ done: m[1].toLowerCase() === 'x', text: m[2].trim() }));
  if (!goal || !items.length) return null;
  return { goal, items, pending: items.filter((i) => !i.done).length };
}

// Marca la tarea `index` (0-based, en orden del archivo) como hecha y actualiza la línea de estado.
// Lo llama SOLO el orquestador cuando el paso terminó done Y pasó el enforcement de mutación —
// nunca a pedido del modelo. false si no hay archivo o la tarea ya estaba marcada (idempotente).
export function markStepDone(projectPath, index) {
  const file = projectPath && planPath(projectPath);
  if (!file || !existsSync(file)) return false;
  const text = readFileSync(file, 'utf8');
  let n = -1;
  let out = text.replace(/^- \[[ xX]\]/gm, (mark) => { n++; return n === index ? '- [x]' : mark; });
  if (out === text) return false;
  const done = (out.match(/^- \[x\]/gm) || []).length;
  const total = (out.match(/^- \[[ xX]\]/gm) || []).length;
  out = out.replace(/^> Estado: .*$/m, `> Estado: ${done}/${total} completadas`);
  writeFileSync(file, out, 'utf8');
  return true;
}
