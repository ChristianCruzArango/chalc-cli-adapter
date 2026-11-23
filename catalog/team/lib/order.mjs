// order.mjs — la orden que recibe un rol al despacharlo (spec 034, R5). Responsabilidad ÚNICA: redactar ese
// texto. Razón de cambio: qué se le entrega a un rol.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. La orden no depende de qué agente la lea: nombra archivos y comandos del repo. No se puede probar que
// un modelo leyó las reglas; sí que se le entregaron, y eso es lo que queda escrito aquí.

import { textOf } from './i18n.mjs';

const list = (items, none) => (items.length ? items.map((item) => `- \`${item}\``) : [`- ${none}`]);

// Cómo informa cada tipo de rol: el que desarrolla entrega; el que revisa deja su veredicto en la bitácora.
function reportLines(o, d) {
  const lines = [`- ${o.signal}: \`node .chalc/team.mjs event signal spec=${d.spec}\``, `- ${o.block}: \`node .chalc/team.mjs block --spec ${d.spec} "<${o.reason}>"\``];
  if (d.kind === 'developer') lines.push(`- ${o.deliver}: \`node .chalc/team.mjs deliver --spec ${d.spec}\``);
  if (d.kind === 'reviewer') lines.push(`- ${o.verdict(d.head)}`);
  return lines;
}

// Lo que el proyecto ya aprendió y aplica aquí (spec 036, R5). Sin nada, la sección no aparece.
function lessonLines(o, lessons) {
  if (!lessons.length) return [];
  return [`## ${o.lessons}`, ...lessons.map((l) => `- [${l.id}] ${l.title}${l.promoted ? ` (${o.teamRule})` : ''}`), `${o.lessonDetail}: \`node .chalc/memory.mjs get <id>\``, ''];
}

/** El texto de la orden. d: { lang, role, kind, spec, dir, launcher, tier, attempt, maxAttempts, head, rules, skills, finding, lessons }. */
export function orderText(d) {
  const o = textOf(d.lang).order;
  return [
    `# ${o.title}: ${d.role} · ${d.spec}`, '',
    `- ${o.instructions}: \`.chalc/roles/${d.role}.md\``,
    `- ${o.workdir}: ${d.dir}`,
    `- ${o.runsWith}: ${d.launcher} · ${d.tier}`,
    `- ${o.attempt}: ${d.attempt}/${d.maxAttempts}`,
    ...(d.kind === 'reviewer' ? [`- ${o.commit}: ${d.head}`] : []),
    ...(d.gallery ? [`- ${o.gallery}: ${d.gallery}`] : []), '',
    `## ${o.rules}`, ...list(d.rules, o.noRules), '',
    `## ${o.skills}`, ...list(d.skills, o.noSkills), '',
    `## ${o.spec}`, ...list(['hu.md', 'spec.md', 'plan.md', 'tasks.md'].map((name) => `${d.spec}/${name}`), ''), '',
    ...(d.finding ? [`## ${o.finding}`, d.finding, ''] : []),
    ...lessonLines(o, d.lessons || []),
    `## ${o.report}`, ...reportLines(o, d), ''
  ].join('\n');
}
