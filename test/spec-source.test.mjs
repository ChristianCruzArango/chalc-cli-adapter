// Spec 024 (coherencia), T9b — `chalc spec <fuente>` trae la HU sin usar ningún modelo (R27, R28): crea la
// siguiente carpeta y deja en `hu.md` el texto tal cual llegó, con su línea de origen y sin credenciales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tempDir } from './helpers/tmpdir.mjs';
import { hasStorySource, renderHu, sourceLabel, titleOf } from '../lib/hufile.mjs';
import { parseHu } from '../catalog/gate/lib/huids.mjs';
import { coherenceProblems } from '../catalog/gate/lib/coherence.mjs';
import { RULES } from '../catalog/gate/lib/rules.mjs';

const BIN = fileURLToPath(new URL('../bin/chalc.mjs', import.meta.url));
const TEMPLATE = (scaffold) => readFile(new URL(`../catalog/methods/sdd/${scaffold}/specs/_template/hu.md`, import.meta.url), 'utf8');
const STORY = '# Pago con tarjeta\n\nComo cliente quiero pagar con tarjeta.\n\n## Criterios de aceptación\nEl sistema rechaza tarjetas vencidas.\nCuesta $1 y usa el patrón $& tal cual.';
const SOURCE = 'https://dev.azure.com/org/proj/_workitems/edit/42';

for (const [scaffold, label] of [['scaffold-lite', 'Fuente'], ['scaffold-lite-en', 'Source'], ['scaffold-full', 'Fuente'], ['scaffold-full-en', 'Source']]) {
  test(`R27 (${scaffold}): renderHu rellena la plantilla con el origen y el texto literal`, async () => {
    const hu = renderHu({ template: await TEMPLATE(scaffold), text: STORY, source: SOURCE, title: 'Pago con tarjeta' });
    assert.ok(hu.includes(`${label}: ${SOURCE}`));
    assert.ok(hu.includes(STORY), 'el texto va tal cual, sin tocar ni un carácter');
    assert.match(hu.split('\n')[0], /Pago con tarjeta$/);
    assert.equal(/<(pega|paste)[^>]*>/.test(hu), false, 'el marcador del texto ya no está');
    const parsed = parseHu(hu);
    assert.equal(parsed.source, SOURCE);
    assert.ok(parsed.body.includes('El sistema rechaza tarjetas vencidas.'));
    assert.deepEqual(parsed.fragments.map((f) => f.id), ['HU-1'], 'los fragmentos los declara después el especificador');
  });
}

test('R27: una plantilla sin marcadores no pierde ni el origen ni el texto', () => {
  const hu = renderHu({ template: '# Historia\n\nnotas propias\n', text: STORY, source: 'historia.docx' });
  assert.ok(hu.includes('notas propias'));
  assert.equal(parseHu(hu).source, 'historia.docx');
  assert.ok(hu.includes(STORY));
  const empty = renderHu({ template: '', text: 'solo esto', source: 'a.md' });
  assert.equal(parseHu(empty).source, 'a.md');
  assert.ok(empty.includes('solo esto'));
});

test('R27: el texto se normaliza solo en el fin de línea y los espacios finales', () => {
  const hu = renderHu({ template: 'Fuente: <x>\n\n<pega aquí>\n', text: 'uno\r\ndos\r\n\r\n', source: 's' });
  assert.equal(hu, 'Fuente: s\n\nuno\ndos\n');
});

test('R27: una HU con contenido y origen ya no dispara «vacía» ni «sin fuente»', async () => {
  const hu = renderHu({ template: await TEMPLATE('scaffold-lite'), text: STORY, source: SOURCE });
  const rules = coherenceProblems({ dir: 'specs/001-x', problem: '', files: { 'hu.md': hu, 'spec.md': null, 'plan.md': null, 'tasks.md': null } }).map((p) => p.rule);
  assert.equal(rules.includes(RULES.huEmpty), false);
  assert.equal(rules.includes(RULES.huNoSource), false);
});

test('R27, R28: el origen que se anota es la URL o el nombre del archivo, nunca una credencial', () => {
  assert.equal(sourceLabel({ azure: SOURCE, pat: 'secreto' }), SOURCE);
  assert.equal(sourceLabel({ jira: 'https://acme.atlassian.net/browse/ABC-7', token: 'secreto', email: 'a@b.c' }), 'https://acme.atlassian.net/browse/ABC-7');
  assert.equal(sourceLabel({ url: 'https://usuario:clave@docs.example.com/hu?id=3' }), 'https://docs.example.com/hu?id=3');
  assert.equal(sourceLabel({ doc: join('/Users', 'alguien', 'privado', 'historia.docx') }), 'historia.docx');
  assert.equal(sourceLabel({}), '');
});

test('R27: hay fuente si viene --azure, --jira, --url o --doc; el título sale de la primera línea', () => {
  for (const key of ['azure', 'jira', 'url', 'doc']) assert.equal(hasStorySource({ [key]: 'x' }), true, key);
  assert.equal(hasStorySource({ name: 'pagos', pat: 'x' }), false);
  assert.equal(titleOf(STORY), 'Pago con tarjeta');
  assert.equal(titleOf('\n\n  ## Título con   espacios  \nresto'), 'Título con espacios');
  assert.equal(titleOf('x'.repeat(200)).length, 60);
  assert.equal(titleOf(''), '');
});

// ── el comando real ───────────────────────────────────────────────────────────────────────────────

const run = (args, cwd, env = {}) => spawnSync(process.execPath, [BIN, 'spec', ...args], {
  cwd, encoding: 'utf8', input: '', timeout: 60000, env: { ...process.env, CHALC_LANG: 'es', ...env }
});
async function projectWithStory(t) {
  const dir = await tempDir(t, 'chalc-024-spec-');
  await writeFile(join(dir, 'historia.md'), STORY);
  return dir;
}
const specFolders = (dir) => (existsSync(join(dir, 'specs')) ? readdirSync(join(dir, 'specs')).filter((n) => /^\d+-/.test(n)) : []);

test('R27: `chalc spec --doc` crea la carpeta y deja la HU literal en hu.md, con su origen', async (t) => {
  const dir = await projectWithStory(t);
  const r = run(['--name', 'pagos', '--doc', 'historia.md'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(specFolders(dir), ['001-pagos']);
  const hu = readFileSync(join(dir, 'specs', '001-pagos', 'hu.md'), 'utf8');
  assert.ok(hu.includes('Fuente: historia.md'));
  assert.ok(hu.includes(STORY));
  for (const name of ['spec.md', 'plan.md', 'tasks.md']) assert.ok(existsSync(join(dir, 'specs', '001-pagos', name)), name);
  assert.match(r.stdout, /hu\.md/);
});

test('R27: sin --name, la carpeta toma el nombre del título de la HU', async (t) => {
  const dir = await projectWithStory(t);
  const r = run(['--doc', 'historia.md'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(specFolders(dir), ['001-pago-con-tarjeta']);
});

test('R27: si la fuente no se puede leer, no queda ninguna carpeta a medias', async (t) => {
  const dir = await projectWithStory(t);
  const r = run(['--name', 'pagos', '--doc', 'no-existe.md'], dir);
  assert.notEqual(r.status, 0);
  assert.deepEqual(specFolders(dir), []);
});

test('R27: sin fuente, `chalc spec <nombre>` sigue creando la carpeta con la plantilla intacta', async (t) => {
  const dir = await tempDir(t, 'chalc-024-spec-');
  const r = run(['pagos'], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const hu = readFileSync(join(dir, 'specs', '001-pagos', 'hu.md'), 'utf8');
  assert.match(hu, /Fuente: </);
});

// Bordes de los marcadores (R27): solo cuenta la línea que ES el marcador, no una que lo lleva dentro.
test('R27: «Fuente:» y el hueco del texto solo casan como línea completa', () => {
  const inline = renderHu({ template: 'ver Fuente: aquí\n', text: 'cuerpo', source: 's' });
  assert.equal(inline, 'ver Fuente: aquí\n\nFuente: s\n\ncuerpo\n', 'una mención a media línea no es la línea de origen');
  assert.equal(renderHu({ template: 'Fuentes: varias\n', text: 'c', source: 's' }), 'Fuentes: varias\n\nFuente: s\n\nc\n');
  assert.equal(renderHu({ template: 'Source : <x> y más\n\n<hueco>\n', text: 'c', source: 's' }), 'Source: s\n\nc\n', 'se reemplaza la línea entera');
  assert.equal(renderHu({ template: 'Fuente: s0\n\nmira <esto> ya\n', text: 'c', source: 's' }), 'Fuente: s\n\nmira <esto> ya\n\nc\n', 'un marcador con texto delante no es el hueco');
  assert.equal(renderHu({ template: 'Fuente: s0\n\n<esto> sigue\n', text: 'c', source: 's' }), 'Fuente: s\n\n<esto> sigue\n\nc\n', 'ni con texto detrás');
});

test('R27: el título solo se escribe en un encabezado con hueco, y solo si hay título', () => {
  assert.equal(renderHu({ template: '# HU: <título>\nFuente: <x>\n\n<texto>\n', text: 'c', source: 's', title: 'Pago' }), '# HU: Pago\nFuente: s\n\nc\n');
  assert.equal(renderHu({ template: '# HU: <título>\nFuente: <x>\n\n<texto>\n', text: 'c', source: 's' }), '# HU: <título>\nFuente: s\n\nc\n');
  assert.equal(renderHu({ template: 'nota # a <b>\nFuente: <x>\n\n<texto>\n', text: 'c', source: 's', title: 'Pago' }), 'nota # a <b>\nFuente: s\n\nc\n', 'una almohadilla a media línea no es encabezado');
  assert.equal(renderHu({ template: '\n\nnotas\n', text: 'c', source: 's' }), 'notas\n\nFuente: s\n\nc\n');
  assert.equal(renderHu({ text: 'c', source: 's' }), 'Fuente: s\n\nc\n');
  assert.equal(renderHu({ template: null, text: null, source: 's' }), 'Fuente: s\n\n\n');
});

test('R27, R28: solo se quita la credencial que va delante del host; el título no pierde almohadillas internas', () => {
  assert.equal(sourceLabel({ url: 'http://u:p@h.example/x' }), 'http://h.example/x');
  assert.equal(sourceLabel({ url: 'ver https://u:p@h.example/x' }), 'ver https://u:p@h.example/x');
  assert.equal(titleOf('Pago # 3 con tarjeta'), 'Pago # 3 con tarjeta');
});

// ── bordes del comando (R27; specs 038 y 041) ─────────────────────────────────────────────────────

test('R27: la carpeta nueva no trae design.md ni probes.json: solo nacen en una spec que los necesita', async (t) => {
  const dir = await tempDir(t, 'chalc-024-spec-');
  assert.equal(run(['pagos'], dir).status, 0);
  const template = readdirSync(join(dir, 'specs', '_template'));
  assert.ok(template.includes('design.md') && template.includes('probes.json'), 'la plantilla sí los ofrece');
  const created = readdirSync(join(dir, 'specs', '001-pagos'));
  assert.deepEqual(created.filter((name) => ['design.md', 'probes.json'].includes(name)), []);
  assert.deepEqual(created.sort(), template.filter((name) => !['design.md', 'probes.json'].includes(name)).sort());
});

test('R27: una fuente vacía se rechaza nombrándola, y no queda ninguna carpeta', async (t) => {
  const dir = await tempDir(t, 'chalc-024-spec-');
  await writeFile(join(dir, 'vacia.md'), '  \n\n');
  const r = run(['--name', 'pagos', '--doc', 'vacia.md'], dir);
  assert.notEqual(r.status, 0);
  assert.ok((r.stdout + r.stderr).includes('vacia.md'), r.stdout + r.stderr);
  assert.deepEqual(specFolders(dir), []);
});

test('R27: el nombre son todas las palabras; si la última es una carpeta que existe, es el proyecto', async (t) => {
  const dir = await tempDir(t, 'chalc-024-spec-');
  const other = await tempDir(t, 'chalc-024-spec-');
  assert.equal(run(['pago', 'con', 'tarjeta'], dir).status, 0);
  assert.deepEqual(specFolders(dir), ['001-pago-con-tarjeta']);
  const r = run(['cobro', 'rapido', other], dir);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(specFolders(other), ['001-cobro-rapido']);
  assert.deepEqual(specFolders(dir), ['001-pago-con-tarjeta'], 'la otra carpeta no se toca');
  assert.ok(r.stdout.includes('chalc spec'));
});

test('R27: la HU escrita conserva el resto de la plantilla y lleva el título de la HU', async (t) => {
  const dir = await projectWithStory(t);
  assert.equal(run(['uno'], dir).status, 0);
  const blank = readFileSync(join(dir, 'specs', '001-uno', 'hu.md'), 'utf8');
  assert.equal(run(['--name', 'dos', '--doc', 'historia.md'], dir).status, 0);
  const hu = readFileSync(join(dir, 'specs', '002-dos', 'hu.md'), 'utf8');
  assert.equal(hu, renderHu({ template: blank, text: STORY, source: 'historia.md', title: 'Pago con tarjeta' }));
  assert.notEqual(hu, renderHu({ template: '', text: STORY, source: 'historia.md', title: 'Pago con tarjeta' }));
});
