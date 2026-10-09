// Hand-off del orquestador full-stack de `chalc feature`: el mensaje único que coordina los repos
// (2 o 3, si hay móvil) alrededor del contrato, y su variante para los workspaces con worktrees.

import { advisorCycleMulti, nextPathOf } from '../gatehandoff.mjs';
import { SIDE } from '../sides.mjs';
import { contentLang } from '../contentlang.mjs';

// El hand-off sigue el idioma del SPEC, no el del CLI: español si el spec lo es (o, sin spec, si la
// CLI lo está); en cualquier otro caso, inglés. Lo usan también los hand-offs de spec-ia.
// Mismo criterio que el resto del contenido del proyecto: un único normalizador (lib/contentlang.mjs).
export const handoffLang = (specLang) => contentLang(specLang);

// Las piezas cortas del hand-off que dependen del idioma.
const WORDS = {
  es: {
    repos: (n) => (n === 3 ? 'TRES' : 'DOS'),
    mobile: 'MÓVIL',
    branchAll: () => 'chalc ya la creó en todos los repos',
    branchNone: (b) => `créala en cada repo: git checkout -b ${b}`,
    branchSome: (b) => `chalc la creó donde el árbol estaba limpio; donde falte, créala: git checkout -b ${b}`,
    cleanup: '🧹 Limpieza: no muevas esta carpeta de workspace (cada worktree guarda la ruta absoluta hacia su repo). Cuando el PR de un lado se mergee, quita su worktree DESDE el repo original: `git worktree remove <ruta>` — chalc nunca lo hace por ti.'
  },
  en: {
    repos: (n) => (n === 3 ? 'THREE' : 'TWO'),
    mobile: 'MOBILE',
    branchAll: () => 'chalc already created it in every repo',
    branchNone: (b) => `create it in each repo: git checkout -b ${b}`,
    branchSome: (b) => `chalc created it where the tree was clean; create it where missing: git checkout -b ${b}`,
    cleanup: '🧹 Cleanup: do not move this workspace folder (each worktree stores the absolute path to its repo). When a side\'s PR merges, remove its worktree FROM the original repo: `git worktree remove <path>` — chalc never does it for you.'
  }
};

function branchNoteFor(words, created, branch) {
  if (created.every(Boolean)) return words.branchAll();
  return created.every((x) => !x) ? words.branchNone(branch) : words.branchSome(branch);
}

function handoffEn({ backPath, backRel, frontPath, frontRel, mobilePath, mobileRel, branch, hasMobile, branchNote, count, cycle }) {
  const repos = [
    `- BACKEND (exposes the API):  \`${backPath}\`  → spec: \`${backRel}/\``,
    `- FRONTEND (consumes the API): \`${frontPath}\`  → spec: \`${frontRel}/\``,
    ...(hasMobile ? [`- MOBILE (consumes the API): \`${mobilePath}\`  → spec: \`${mobileRel}/\``] : [])
  ];
  const steps = [
    `Start with the BACKEND (it owns the contract). Read \`${backRel}/contracts/api.md\`, \`specs/constitution.md\` and \`${backRel}/spec.md\` (R1, R2… in EARS). Follow \`${backRel}/plan.md\` and execute \`${backRel}/tasks.md\` ONE task at a time. Implement EXACTLY the contract's endpoints.`,
    `Then the FRONTEND. Same with \`${frontRel}/\`, but CONSUMING the contract (same routes/shapes); don't reimplement backend logic.`,
    ...(hasMobile ? [`Then the MOBILE app. Same with \`${mobileRel}/\`, consuming the SAME contract (same routes/shapes); don't reimplement backend logic nor duplicate the frontend's.`] : []),
    `R# are SHARED: the same R# is satisfied on ${hasMobile ? 'backend, frontend and/or mobile' : 'backend and/or frontend'} — keep cross-repo traceability.`,
    `Per task, strict TDD: failing test (Red) → minimum code (Green) → refactor. Never code without a failing test first.`,
    `Before each task, state which R# and which repo; when done, stop and wait for my OK.`,
    `Branch \`${branch}\` in each repo (${branchNote}).`,
    `If something is [NEEDS CLARIFICATION] in the contract or a spec, ask me first. The spec is the source of truth: if scope changes, update spec and contract first.`,
    cycle
  ];
  return [
    `You are the ORCHESTRATOR of this full-stack feature. You coordinate ${count} repos around a single API contract, with Spec-Driven Development and strict TDD.`,
    ``,
    `📜 Contract (source of truth, identical in every spec): \`contracts/api.md\`. Every endpoint, request/response and error comes from there — invent nothing outside it.`,
    ``,
    `Repos:`,
    ...repos,
    ``,
    `How to orchestrate:`,
    ...steps.map((s, i) => `${i + 1}. ${s}`)
  ].join('\n');
}

function handoffEs({ backPath, backRel, frontPath, frontRel, mobilePath, mobileRel, branch, hasMobile, branchNote, count, cycle }) {
  const repos = [
    `- BACKEND (expone la API):  \`${backPath}\`  → spec: \`${backRel}/\``,
    `- FRONTEND (consume la API): \`${frontPath}\`  → spec: \`${frontRel}/\``,
    ...(hasMobile ? [`- MÓVIL (consume la API): \`${mobilePath}\`  → spec: \`${mobileRel}/\``] : [])
  ];
  const steps = [
    `Empieza por el BACKEND (es dueño del contrato). Lee \`${backRel}/contracts/api.md\`, \`specs/constitution.md\` y \`${backRel}/spec.md\` (R1, R2… en EARS). Sigue \`${backRel}/plan.md\` y ejecuta \`${backRel}/tasks.md\` UNA tarea a la vez. Implementa EXACTAMENTE los endpoints del contrato.`,
    `Sigue con el FRONTEND. Igual con \`${frontRel}/\`, pero CONSUMIENDO el contrato (mismas rutas/shapes); no reimplementes la lógica del back.`,
    ...(hasMobile ? [`Luego el MÓVIL. Igual con \`${mobileRel}/\`, consumiendo el MISMO contrato (mismas rutas/shapes); no reimplementes la lógica del back ni dupliques la del front.`] : []),
    `Los R# son COMPARTIDOS: el mismo R# se cumple en ${hasMobile ? 'back, front y/o móvil' : 'back y/o front'} — mantén la trazabilidad cruzada.`,
    `Por tarea, TDD estricto: test que falla (Red) → mínimo código (Green) → refactor. Nunca código sin un test que falle primero.`,
    `Antes de cada tarea di qué R# y en qué repo; al terminar, párate y espera mi OK.`,
    `Rama \`${branch}\` en cada repo (${branchNote}).`,
    `Si algo está [NEEDS CLARIFICATION] en el contrato o una spec, pregúntame antes. La spec es la fuente de verdad: si cambia el alcance, actualiza spec y contrato primero.`,
    cycle
  ];
  return [
    `Eres el ORQUESTADOR de esta feature full-stack. Coordinas ${count} repos alrededor de un único contrato de API, con Spec-Driven Development y TDD estricto.`,
    ``,
    `📜 Contrato (fuente de verdad, idéntico en todas las specs): \`contracts/api.md\`. Todo endpoint, request/response y error sale de ahí — no inventes nada fuera del contrato.`,
    ``,
    `Repos:`,
    ...repos,
    ``,
    `Cómo orquestar:`,
    ...steps.map((s, i) => `${i + 1}. ${s}`)
  ].join('\n');
}

// Hand-off ÚNICO para el orquestador full-stack: un solo mensaje que coordina los repos (2 o 3, si hay
// móvil) alrededor del contrato. No es un mensaje por repo: es la instrucción del orquestador. Sigue el
// idioma del spec. Los pasos se numeran al final para que el del móvil (opcional) no rompa la secuencia.
export function featureHandoff({ backPath, backRel, frontPath, frontRel, mobilePath = '', mobileRel = '', branch, backBranchCreated, frontBranchCreated, mobileBranchCreated = false, specLang }) {
  const language = handoffLang(specLang);
  const words = WORDS[language];
  const hasMobile = !!mobilePath;
  const branchNote = branchNoteFor(words, [backBranchCreated, frontBranchCreated, ...(hasMobile ? [mobileBranchCreated] : [])], branch);
  const count = words.repos(hasMobile ? 3 : 2);
  // El ciclo de cierre, con el advisor de CADA lado: el del back mide el contrato que expone y el
  // del front el que consume, así que cerrar uno no dice nada del otro (spec 008, R19).
  const cycle = advisorCycleMulti({
    en: language === 'en',
    repos: [
      { label: 'BACKEND', nextPath: nextPathOf(backPath) },
      { label: 'FRONTEND', nextPath: nextPathOf(frontPath) },
      ...(hasMobile ? [{ label: words.mobile, nextPath: nextPathOf(mobilePath) }] : [])
    ]
  }).join('\n');
  const ctx = { backPath, backRel, frontPath, frontRel, mobilePath, mobileRel, branch, hasMobile, branchNote, count, cycle };
  return (language === 'en' ? handoffEn : handoffEs)(ctx);
}

// Hand-off del WORKSPACE (spec 005, R11): el mismo orquestador, pero la sesión se abre en la
// raíz del workspace y los lados son subcarpetas — todo va en rutas RELATIVAS (back/, front/,
// movil/). Reusa featureHandoff (DRY) y anexa la instrucción de limpieza de worktrees.
export function featureWorkspaceHandoff({ id, branch, specLang, hasMobile = false }) {
  const specRel = (side) => `${side}/specs/${id}`;
  const body = featureHandoff({
    backPath: SIDE.BACK, backRel: specRel(SIDE.BACK),
    frontPath: SIDE.FRONT, frontRel: specRel(SIDE.FRONT),
    mobilePath: hasMobile ? SIDE.MOBILE : '', mobileRel: hasMobile ? specRel(SIDE.MOBILE) : '',
    branch, backBranchCreated: true, frontBranchCreated: true, mobileBranchCreated: hasMobile, specLang
  });
  return body + '\n\n' + WORDS[handoffLang(specLang)].cleanup;
}

