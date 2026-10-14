// T5 (spec 020, R5, R6, R7) — la página del tablero.
//
// Autocontenida (sin CDN ni recursos de fuera: corre en local y sin red), en el idioma del proyecto, y se
// refresca sola cada 2 s pidiendo `/state.json`. Lo que muestra sale de archivos del repo —hallazgos,
// nombres de tareas, comandos—, así que NUNCA se inserta como HTML: un hallazgo que diga `<script>` se lee
// como texto, no se ejecuta.

import test from 'node:test';
import assert from 'node:assert/strict';
import { LABELS, pageHtml, REFRESH_MS } from '../catalog/live/lib/page.mjs';
import { agoText, durationText, tokensText } from '../catalog/live/lib/format.mjs';

const ACTIONS = ['blocked_config', 'sync_contract', 'read_mail', 'run_gate', 'fix_gate', 'call_role', 'fix_review', 'tick_task', 'work_task', 'done', 'ask_human'];
const keysOf = (obj, prefix = '') => Object.entries(obj).flatMap(([k, v]) => (v && typeof v === 'object' ? keysOf(v, `${prefix}${k}.`) : [`${prefix}${k}`])).sort();

test('R7: the labels have exact key parity between es and en', () => {
  assert.deepEqual(keysOf(LABELS.es), keysOf(LABELS.en));
});

test('R5: every action the advisor can give has a readable name, in both languages', () => {
  for (const lang of ['es', 'en']) for (const action of ACTIONS) assert.ok(LABELS[lang].actions[action], `${lang}: ${action}`);
});

test('R5: the page has a section for each part, in the language of the project', () => {
  for (const lang of ['es', 'en']) {
    const html = pageHtml(lang);
    assert.match(html, new RegExp(`<html lang="${lang}">`));
    for (const id of ['headline', 'flow', 'gate', 'charts', 'missing', 'tasks', 'notes', 'activity']) assert.ok(html.includes(`id="${id}"`), `${lang}: ${id}`);
    assert.ok(html.includes(LABELS[lang].sections.missing), lang);
  }
  assert.match(pageHtml('fr'), /<html lang="en">/);
});

test('R6: it refreshes itself from /state.json every 2 seconds', () => {
  assert.equal(REFRESH_MS, 2000);
  const html = pageHtml('es');
  assert.ok(html.includes("fetch('/state.json'"));
  assert.ok(html.includes(String(REFRESH_MS)));
});

test('R5: it needs nothing from outside and never inserts repo text as HTML', () => {
  for (const lang of ['es', 'en']) {
    const html = pageHtml(lang);
    assert.doesNotMatch(html, /https?:\/\/|src="\/\/|<link /i, lang);
    assert.ok(!html.includes('innerHTML'), lang);
    assert.ok(!html.includes('insertAdjacentHTML'), lang);
    assert.ok(html.includes('textContent'), lang);
  }
});

test('R5: the labels the page needs travel inside it, for the browser', () => {
  const html = pageHtml('es');
  assert.ok(html.includes(JSON.stringify(LABELS.es.actions.fix_review)));
});

test('R21: full screen: a side bar with specs, sections and agent; a wide main area', () => {
  const html = pageHtml('es');
  for (const id of ['headline', 'flow', 'gate', 'tasks', 'notes', 'activity']) assert.ok(html.includes(`<section id="${id}" class="wide">`), id);
  for (const id of ['charts', 'missing']) assert.ok(html.includes(`<section id="${id}"></section>`), id);
  assert.match(html, /<aside id="side">[\s\S]*id="agent"[\s\S]*id="specs"[\s\S]*<nav id="nav">[\s\S]*id="updated"[\s\S]*<\/aside>/);
  for (const id of ['headline', 'gate', 'tasks', 'notes', 'activity']) assert.ok(html.includes(`href="#${id}"`), `nav: ${id}`);
  assert.doesNotMatch(html, /max-width:1440px/);
  assert.ok(html.includes('</section><section'), 'sections follow each other with nothing in between');
});

// ── iteración 2 (R10–R13) ─────────────────────────────────────────────────────────────────────

test('R13: every label the browser script uses exists, in both languages', () => {
  const html = pageHtml('es');
  const used = new Set([...html.matchAll(/\bL\.(\w+)\.(\w+)/g)].map((m) => `${m[1]}.${m[2]}`));
  assert.ok(used.size > 20, `found ${used.size}`);
  for (const lang of ['es', 'en']) for (const key of used) {
    const [group, name] = key.split('.');
    assert.ok(LABELS[lang][group] && typeof LABELS[lang][group][name] === 'string', `${lang}: ${key}`);
  }
});

test('R10, R11: tasks and gate stages open with a click, and stay open across refreshes', () => {
  const html = pageHtml('es');
  assert.ok(html.includes("el('details'"), 'details');
  assert.ok(html.includes("'toggle'"), 'toggle');
  assert.ok(html.includes('opened'), 'remembers what is open');
});

test('R13, R19: the header carries a compact agent chip, with its explanation as a tooltip', () => {
  for (const lang of ['es', 'en']) {
    const html = pageHtml(lang);
    assert.ok(html.includes('<div id="agent" class="chip"></div>'), lang);
    assert.ok(html.includes(JSON.stringify(LABELS[lang].agent.waitingHint)), lang);
  }
  assert.ok(pageHtml('es').includes("chip.title = v.harness.live ? L.agent[a.state + 'Hint'] : noLive(v);"), 'the hint goes in the tooltip');
});

test('R17, R18, R20, R21: headline, SDD rail, gate stamp with stages and a detail panel, bars, specs and margin notes', () => {
  const html = pageHtml('es');
  for (const fn of ['function headline(', 'function charts(', 'function gate(', 'function flow(', 'function specs(', 'function notes(']) assert.ok(html.includes(fn), fn);
  for (const cls of ["'rail'", "'stamp ", "'stage-lane'", "'stage-panel ", "'bar-row'", "'margin-note "]) assert.ok(html.includes(cls), cls);
  assert.ok(html.includes('selectedStage'), 'the chosen stage is remembered across refreshes');
});

test('R12: the format helpers travel inside the page, for the browser', () => {
  const html = pageHtml('en');
  for (const fn of [agoText, durationText, tokensText]) assert.ok(html.includes(fn.toString()), fn.name);
});

test('R12: a duration reads in hours, minutes and seconds, in the words of each language', () => {
  const es = LABELS.es.words;
  const en = LABELS.en.words;
  assert.equal(durationText(0, es), '—');
  assert.equal(durationText(-5, es), '—');
  assert.equal(durationText(NaN, es), '—');
  assert.equal(durationText(800, es), '1 s');
  assert.equal(durationText(45_000, es), '45 s');
  assert.equal(durationText(270_000, es), '4 min 30 s');
  assert.equal(durationText(3_600_000 + 5 * 60_000 + 9_000, en), '1 h 5 min');
  assert.equal(durationText(2 * 60_000, en), '2 min');
});

test('R12: tokens read short and in the format of the language', () => {
  assert.equal(tokensText(0, 'es'), '0');
  assert.equal(tokensText(950, 'en'), '950');
  assert.equal(tokensText(12_345, 'en'), '12.3K');
  assert.equal(tokensText(1_250_000, 'en'), '1.3M');
  assert.equal(tokensText(undefined, 'en'), '0');
  assert.match(tokensText(12_345, 'es'), /^12,3/);
});

test('R13: «how long ago» reads in the words of each language', () => {
  const now = Date.parse('2026-10-13T10:10:00Z');
  assert.equal(agoText('2026-10-13T10:07:00Z', now, LABELS.es.words), 'hace 3 min');
  assert.equal(agoText('2026-10-13T10:07:00Z', now, LABELS.en.words), '3 min ago');
  assert.equal(agoText('2026-10-13T10:09:58Z', now, LABELS.en.words), LABELS.en.words.justNow);
  assert.equal(agoText('', now, LABELS.en.words), '');
  assert.equal(agoText('roto', now, LABELS.en.words), '');
});

test('R7, R13: the page carries its title and its language for the browser, and its script parses', () => {
  for (const lang of ['es', 'en']) {
    const html = pageHtml(lang);
    assert.ok(html.includes(`<title>${LABELS[lang].title}</title>`), lang);
    assert.ok(html.includes(`<h1>${LABELS[lang].title}</h1>`), lang);
    assert.ok(html.includes(`const LANG = ${JSON.stringify(lang)};`), lang);
    const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
    assert.doesNotThrow(() => new Function(script), lang);
  }
});

test('R13: «just now» lasts under ten seconds', () => {
  const now = Date.parse('2026-10-13T10:10:00Z');
  assert.equal(agoText('2026-10-13T10:09:50Z', now, LABELS.en.words), '10 s ago');
});

// Encontrado al probar el dashboard contra un estado real: `replaceChildren(null)` pinta «null» en el DOM.
test('R13: the script never hands a null to replaceChildren', () => {
  const html = pageHtml('es');
  for (const call of html.match(/replaceChildren\([^;]*;/g) || []) assert.ok(/filter\(Boolean\)/.test(call), call);
});

test('R21: counts read in singular or plural, in both languages', () => {
  const html = pageHtml('es');
  assert.ok(html.includes('const count = (n, one, many) =>'));
  for (const lang of ['es', 'en']) for (const key of ['requirementOne', 'taskOne']) assert.ok(LABELS[lang].words[key], `${lang}: ${key}`);
});
