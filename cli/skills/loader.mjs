// cli/skills/loader.mjs — carga las skills EQUIPADAS del proyecto y las convierte en secciones del harness.
// Para modelos locales: un índice compacto (siempre, una línea por skill) + el SKILL.md COMPLETO solo de las
// relevantes a la tarea (opcional; el budgeter decide si cabe). Los references/ quedan en disco y el agente
// los abre con la tool `read` bajo demanda — el "CCR de skills". Las obligatorias (clean-code, SOLID…) entran
// siempre. Lee de la carpeta equipada real (project.paths.skillsDir), no del catálogo global.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MANDATORY_SKILLS } from '../../lib/targetkit.mjs';
import { frame } from '../prompts/text.mjs';

// Lee name + description del frontmatter de un SKILL.md equipado. Best-effort: usa el id si falta el frontmatter.
async function readSkillMeta(skillsDir, id) {
  const path = join(skillsDir, id, 'SKILL.md');
  let name = id;
  let description = '';
  try {
    const fm = (await readFile(path, 'utf8')).match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (fm) {
      const n = fm[1].match(/^name:\s*([^\r\n]+)/m); if (n) name = n[1].trim();
      const d = fm[1].match(/^description:\s*([^\r\n]+)/m); if (d) description = d[1].trim();
    }
  } catch { /* skill sin SKILL.md legible: queda con id como name */ }
  return { id, name, description, path };
}

// Metadatos de todas las skills equipadas del proyecto. [] si no está equipado.
export async function loadSkillMetas(project) {
  if (!project?.equipped || !project.paths?.skillsDir) return [];
  return Promise.all((project.detected?.skills || []).map((id) => readSkillMeta(project.paths.skillsDir, id)));
}

// Sinónimos tarea→skill: las tareas llegan en el idioma del usuario (español) pero los ids/descripciones
// de las skills están en inglés — sin este puente "formulario" jamás seleccionaría angular-forms.
const TERM_SYNONYMS = new Map([
  ['formulario', 'forms'], ['formularios', 'forms'],
  ['señal', 'signal'], ['señales', 'signals'],
  ['prueba', 'testing'], ['pruebas', 'testing'], ['test', 'testing'], ['tests', 'testing'],
  ['ruta', 'routing'], ['rutas', 'routing'], ['navegación', 'routing'],
  ['componente', 'component'], ['componentes', 'component'],
  ['servicio', 'service'], ['servicios', 'service'],
  ['plantilla', 'template'], ['plantillas', 'template'],
  ['estilo', 'styles'], ['estilos', 'styles'], ['diseño', 'design'],
  ['inyección', 'di'], ['peticiones', 'http'], ['api', 'http'],
  ['directiva', 'directives'], ['directivas', 'directives'],
  ['migración', 'migration'], ['accesibilidad', 'accessibility']
]);

// Puntúa una skill: los términos ESPECÍFICOS de la tarea pesan 10; el stack pesa 1 (es un desempate,
// no un criterio — con solo "angular" las 11 skills angular-* empatarían y ganaría el alfabeto).
function score(meta, taskTerms, stackTerms) {
  const hay = `${meta.id} ${meta.name} ${meta.description}`.toLowerCase();
  const hits = (ts) => ts.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0);
  return hits(taskTerms) * 10 + hits(stackTerms);
}

// Términos de una tarea, expandidos con el puente de sinónimos. Compartido por la selección de skills
// y el enrutador de contexto por paso (relevantBlocks).
// \p{L}\p{N} y no [a-z0-9]: las tareas llegan en español y "diseño"/"señales" no deben partirse en la ñ.
export function expandTerms(text) {
  const split = String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2);
  return [...new Set(split.flatMap((t) => TERM_SYNONYMS.has(t) ? [t, TERM_SYNONYMS.get(t)] : [t]))];
}

// Enrutador de contexto: de un markdown con bloques `## …`, conserva los bloques relevantes a la tarea
// (más el preámbulo previo al primer `##`). SIN PÉRDIDA ante la duda: si ningún bloque puntúa o el texto
// no tiene bloques, se devuelve COMPLETO — recortar de más es peor que no recortar.
export function relevantBlocks(markdown, task) {
  const text = String(markdown);
  const terms = expandTerms(task);
  if (!terms.length) return text;
  const parts = text.split(/^(?=## )/m);
  if (parts.length < 2) return text;
  const kept = parts.filter((block, i) => {
    if (i === 0) return true;   // preámbulo: siempre (título/reglas generales del documento)
    const hay = block.toLowerCase();
    return terms.some((t) => hay.includes(t));
  });
  return kept.length > 1 ? kept.join('') : text;   // nada puntuó → completo (sin pérdida)
}

// Selección: obligatorias SIEMPRE + hasta `max` de las más relevantes a la tarea. Determinista.
export function selectRelevant(metas, { task = '', stacks = [], max = 3 } = {}) {
  const taskTerms = expandTerms(task);
  const stackTerms = [...new Set(stacks.map((s) => String(s).toLowerCase()))];
  const mandatory = metas.filter((m) => MANDATORY_SKILLS.includes(m.id));
  const rest = metas
    .filter((m) => !MANDATORY_SKILLS.includes(m.id))
    .map((m) => ({ m, s: score(m, taskTerms, stackTerms) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.m.id.localeCompare(b.m.id))
    .slice(0, max)
    .map((x) => x.m);
  // Relevantes PRIMERO: el budgeter incluye opcionales en orden, y ante presupuesto justo deben
  // sobrevivir las skills que la tarea necesita, no las genéricas obligatorias (que ya van en el índice).
  return [...rest, ...mandatory];
}

// Construye las secciones de skills para el harness:
//  - índice (requerido, compacto): todas las skills equipadas, una línea cada una + pista para abrir el detalle.
//  - contenido completo (opcional): el SKILL.md de las seleccionadas; el budgeter incluye las que quepan.
export async function buildSkillSections(metas, { task, stacks = [], language, max = 3 } = {}) {
  if (!metas.length) return [];
  const f = frame(language);
  const index = {
    key: 'skills',
    required: true,
    text: `### ${f.skillsTitle}\n${metas.map((m) => `- ${m.name}: ${m.description}`).join('\n')}\n${f.skillsHint}`
  };
  const full = [];
  for (const m of selectRelevant(metas, { task, stacks, max })) {
    try {
      const body = (await readFile(m.path, 'utf8')).trim();
      if (body) full.push({ key: `skill:${m.id}`, required: false, text: `${f.skillFull(m.name)}\n${body}` });
    } catch { /* SKILL.md ilegible: se omite el contenido completo (el índice ya lo nombra) */ }
  }
  return [index, ...full];
}
