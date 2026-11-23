// report.mjs — el informe de una feature (spec 032, R10, R11). Responsabilidad ÚNICA: contar lo que pasó con
// los hechos del registro. Razón de cambio: qué se le entrega al usuario al final.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. Lo que el usuario recibe al cierre no lo redacta un modelo: sale de aquí. Y trae siempre la sección de
// lo que NO se verificó, también cuando está vacía: un informe que solo cuenta lo bueno no sirve para decidir.

import { textOf } from './i18n.mjs';
import { reduce } from './reduce.mjs';
import { gateCell } from './render.mjs';

const clock = (iso) => String(iso || '').slice(0, 16).replace('T', ' ');

// ¿La última corrida del portón de la spec fue completa y aprobó?
const measured = (spec) => Boolean(spec.lastGate) && spec.lastGate.verdict === 'pass' && !spec.lastGate.fast;

function specSection(spec, events, r, t) {
  const rejections = events.filter((e) => e.type === 'reviewed' && e.spec === spec.spec && !e.ok);
  const gate = spec.lastGate ? `${gateCell(spec.lastGate)} · ${spec.lastGate.fast ? r.fast : r.full}` : r.noGate;
  return [
    `## ${spec.spec} — ${t.state[spec.state] || spec.state}`,
    `- ${r.attempts}: ${spec.attempt} / ${spec.maxAttempts}`,
    rejections.length ? `- ${r.rejections}:` : `- ${r.rejections}: ${r.none}`,
    ...rejections.map((e) => `  - ${e.role} (${clock(e.at)}): ${e.summary}`),
    `- ${r.lastGate}: ${gate}`,
    ...(spec.blockedBy ? [`- ${r.blocked}: ${spec.blockedBy}`] : []),
    ''
  ];
}

// Lo que el informe NO puede dar por bueno, spec por spec, y el cierre.
function unverified(feature, r, t) {
  const lines = feature.specs.flatMap((spec) => [
    spec.state !== 'integrated' && `- ${spec.spec}: ${r.notIntegrated(t.state[spec.state] || spec.state)}`,
    !measured(spec) && `- ${spec.spec}: ${r.noFullGate}`
  ].filter(Boolean));
  if (!feature.closed) lines.push(`- ${r.notClosed}`);
  return lines.length ? lines : [r.nothing];
}

/** El informe markdown de `feature` a partir de `events`. opts: { lang, now, stallMs, maxAttempts }. */
export function renderReport(events, feature, { lang, ...options }) {
  const t = textOf(lang);
  const r = t.report;
  const found = reduce(events, options).features.find((f) => f.feature === feature);
  if (!found) return `# ${r.title(feature)}\n\n${r.unknownFeature(feature)}\n`;
  return [
    `# ${r.title(feature)}`, '',
    `${t.lead} ${found.lead.agent} · ${found.closed ? t.closed : r.open} · ${r.generated} ${clock(new Date(options.now).toISOString())}`, '',
    r.source, '',
    ...found.specs.flatMap((spec) => specSection(spec, events, r, t)),
    `## ${r.unverified}`,
    ...unverified(found, r, t), ''
  ].join('\n');
}
