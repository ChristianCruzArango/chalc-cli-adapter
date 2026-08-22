// lib/debate/judge.mjs — el dictamen OPCIONAL sobre lo que quedó en disputa (spec 014, R22).
// Responsabilidad ÚNICA: mitigar el sesgo de posición al pedir un veredicto. Razón de cambio: cómo
// se arbitra.
//
// Un juez LLM elige la opción que le presentan primero en torno al 68 % de las veces, y pedirle que
// ignore el orden apenas baja ese sesgo. La mitigación que sí funciona es estructural: preguntar dos
// veces con las posturas intercambiadas. Si al invertirlas cambia de opinión, no estaba juzgando el
// argumento sino la posición — y eso, dicho honestamente, es un empate.
//
// Por eso el debate NO trae juez por defecto (D5): sin veredicto no hay sesgo que mitigar, y quien
// decide entre dos posturas legítimas es el dueño de la idea.

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { languageName } from '../i18n.mjs';
import { inject, parseSections } from '../promptkit.mjs';
import { JUDGE_SECTIONS, judgeFormatBlock } from './sections.mjs';

const TEMPLATE = join(dirname(fileURLToPath(import.meta.url)), '..', 'prompts', 'debate-judge.prompt.xml');

// La postura de un lado: su último argumento. Sin etiquetas de rol ni de modelo — el juez no debe
// saber quién propuso y quién rebatió, o juzgaría al papel en vez de al argumento.
function positionOf(state, id) {
  const ultimo = [...(state.turns || [])].reverse().find((t) => t.by === id);
  return ultimo ? (ultimo.postura || ultimo.raw || '') : '';
}

// "1", "2" o empate. Lo ilegible es empate: inventar un ganador es justo lo que no queremos.
function verdictOf(text) {
  const t = String(text || '').toLowerCase();
  if (/\b(empate|tie|draw|tied)\b/.test(t)) return 'empate';
  const m = t.match(/\b([12])\b/);
  return m ? m[1] : '';
}

function userBlock(open, primera, segunda) {
  return [
    `<open_disagreements>\n${open.map((d) => `D${d.n}: ${d.texto}`).join('\n')}\n</open_disagreements>`,
    `<position_1>\n${primera}\n</position_1>`,
    `<position_2>\n${segunda}\n</position_2>`
  ].join('\n\n');
}

/**
 * Dictamen sobre los desacuerdos abiertos. Devuelve `null` si no hay ninguno: sin disputa no hay nada
 * que arbitrar, y no se gasta la llamada.
 *
 * `ask({ kind: 'judge', system, user, state })` → texto. Quién responde lo decide el comando: si hay
 * un modelo de juez configurado, ese; si no, uno de los dos participantes — y entonces el informe
 * dice que juez y parte son el mismo, porque el lector tiene derecho a saberlo.
 */
export async function judge({ state, ask, lang }) {
  const open = state?.desacuerdosAbiertos || [];
  if (!open.length) return null;

  const system = inject(await readFile(TEMPLATE, 'utf8'), {
    LANGUAGE: languageName(lang),
    JUDGE_FORMAT: judgeFormatBlock()
  });

  const posA = positionOf(state, 'a');
  const posB = positionOf(state, 'b');
  // Las dos pasadas: A primero y A segundo. El mapa traduce "1"/"2" al lado real de cada pasada.
  const ordenes = [
    { user: userBlock(open, posA, posB), map: { 1: 'a', 2: 'b' } },
    { user: userBlock(open, posB, posA), map: { 1: 'b', 2: 'a' } }
  ];

  const pasadas = [];
  for (const { user, map } of ordenes) {
    const raw = await ask({ kind: 'judge', system, user, state });
    const s = parseSections(raw, JUDGE_SECTIONS);
    const v = verdictOf(s.VEREDICTO);
    pasadas.push({ ganador: map[v] || '', porque: s.PORQUE, raw });
  }

  const [p1, p2] = pasadas;
  const empate = !p1.ganador || !p2.ganador || p1.ganador !== p2.ganador;
  return { ganador: empate ? '' : p1.ganador, empate, pasadas, porque: pasadas.map((p) => p.porque).filter(Boolean) };
}
