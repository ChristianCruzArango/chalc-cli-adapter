// cli/prompts/text.mjs — textos del PROMPT del agente. TODO lo que ve el modelo va en INGLÉS (misma
// convención que lib/prompts/*.prompt.xml del core: un solo prompt, sin duplicar idiomas). El idioma del
// USUARIO solo aparece como ${LANGUAGE}: la instrucción de en qué idioma escribir los campos libres
// (thought/summary/plan/hallazgos). Los prompts grandes (protocolo, roles planner/reviewer) viven como
// .prompt.xml en esta carpeta — el formato de la casa — y aquí solo se cargan e inyectan.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inject } from '../../lib/promptkit.mjs';
import { lang } from '../../lib/i18n.mjs';

const DIR = dirname(fileURLToPath(import.meta.url));
const load = (name) => readFileSync(join(DIR, name), 'utf8').trim();

const PROTOCOL_XML = load('agent-protocol.prompt.xml');
const PLANNER_XML = load('planner.prompt.xml');
const REVIEWER_XML = load('reviewer.prompt.xml');

// Nombre del idioma de SALIDA que se inyecta como ${LANGUAGE} en los prompts.
const LANGUAGE_NAME = { es: 'español', en: 'English' };
const languageName = (key) => LANGUAGE_NAME[key] || String(key || 'English');

// Etiquetas y micro-textos que se insertan en el prompt (títulos de sección, encabezados del harness,
// resúmenes de meta-tools, pistas de corrección). En inglés: son PARA el modelo, no para el usuario.
const MODEL_TEXT = {
  hTools: '## Tools',
  hProject: '## Project',
  hTask: '## Task',
  hSteps: '## Previous steps',
  noSteps: '(no steps yet)',
  step: 'Step', action: 'action', obs: 'obs',
  lastStep: 'LAST STEP: do not run more actions; finish now with {"done":true,"summary":"..."}.',
  stepsLeft: (n) => `You have ${n} steps left. As soon as the task is done, finish with done.`,
  ctxHeader: '### project context',
  ctxStacks: 'stacks', ctxSkills: 'equipped skills', ctxMcp: 'MCP',
  ctxGit: (branch, clean) => `- git: branch ${branch}${clean ? ' (clean)' : ' (uncommitted changes)'}`,
  ctxGenerate: (cmd) => `- to GENERATE code use bash: ${cmd} — mcp__ tools do NOT generate code`,
  constitutionTitle: 'constitution', architectureTitle: 'architecture', readmeTitle: 'project README',
  rulesTitle: 'project instructions (the governing document of this repo — obey it)',
  folderNotesTitle: 'folder guides (conventions that live INSIDE the tree — follow them where you work)',
  specTemplateTitle: "spec template (the project's REQUIRED spec format — your ---SPEC--- deliverable MUST follow this structure, THEN append the ## Task N sections)",
  specReviewTitle: 'approved spec (the CONTRACT these changes must satisfy — judge against its requirements and acceptance criteria)',
  planReviewTitle: 'execution plan (what was ordered — [x] = verified done by the harness; review the changes against it)',
  convHeader: '### previous conversation',
  roleUser: 'User', roleAgent: 'Agent',
  skillsTitle: 'equipped skills',
  skillsHint: 'Apply the relevant ones; open their SKILL.md (or references/) with read WHEN you need the detail — not all upfront.',
  skillFull: (name) => `### skill: ${name}`,
  describeSummary: 'Shows the argument schema of an MCP tool before using it. args: { tool }',
  mcpArgsHint: (tool) => `invalid arguments: check the schema with {"action":{"tool":"describe","args":{"tool":"${tool}"}}} and retry with the correct args (do not repeat the same call)`,
  planTitle: '### plan approved by the user\nFollow this plan IN ORDER, step by step; finish with done when it is complete:',
  changesTitle: '### changes to review',
  fixTask: (findings) => `Fix ONLY these review findings on the recently modified files (change nothing else):\n${findings}`,
  verifyFixTask: (command, output) => `The project check \`${command}\` FAILED. Read the errors below and fix them — change ONLY what is needed to make the check pass:\n${output}`
};

// Frame para el motor: textos del modelo (inglés) + los prompts XML con ${LANGUAGE} ya inyectado según
// el idioma del usuario (override explícito → idioma configurado del CLI → español).
export function frame(language) {
  const key = language || lang || 'es';
  const LANGUAGE = languageName(key);
  return {
    ...MODEL_TEXT,
    protocol: inject(PROTOCOL_XML, { LANGUAGE }),
    plannerRole: inject(PLANNER_XML, { LANGUAGE }),
    reviewerRole: inject(REVIEWER_XML, { LANGUAGE })
  };
}
