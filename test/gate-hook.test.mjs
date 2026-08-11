// T30 (R19) — el hook de cierre de turno se DOCUMENTA, no se instala.
//
// Un hook se ejecuta solo, y `.claude/settings.json` va commiteado: activarlo desde chalc se lo
// impondría a todo el que clone el repo, que no pidió nada. Así que chalc deja el bloque listo para
// pegar y explica qué hace; quien lo quiera, lo pega. Estos tests fijan la parte que importa: que
// chalc NO toque ningún archivo de configuración.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import * as claude from '../targets/claude.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CATALOG = join(ROOT, 'catalog');

const HOOK_DOC = join('.chalc', 'gate-hook.md');

async function equip(dir, specLang = 'español') {
  await claude.apply({ projectPath: dir, CATALOG, skills: [], mcps: [], methods: [], stacks: [], specLang, dryRun: false });
}

const project = () => mkdtemp(join(tmpdir(), 'chalc-hook-'));

async function file(dir, rel, content) {
  const abs = join(dir, rel);
  await mkdir(dirname(abs), { recursive: true });
  await writeFile(abs, content, 'utf8');
  return abs;
}

// ── lo que sí hace ────────────────────────────────────────────────────────────────────────────

test('the claude target leaves the hook documented inside .chalc', async () => {
  const dir = await project();

  await equip(dir);

  assert.ok(existsSync(join(dir, HOOK_DOC)), 'falta el hook documentado');
});

test('the documented hook runs only the fast stages, never mutation', async () => {
  const dir = await project();

  await equip(dir);
  const doc = await readFile(join(dir, HOOK_DOC), 'utf8');

  assert.match(doc, /node \.chalc\/gate\.mjs --fast/);
  assert.doesNotMatch(doc, /"command":\s*"[^"]*stryker/, 'un hook no puede lanzar la mutación: dura minutos');
  assert.match(doc, /Stop/, 'el hook se engancha al fin de turno');
});

// Si no dice por qué no está instalado, el usuario asume que se le olvidó a chalc y lo instala sin
// pensar en el resto del equipo. La explicación es parte del entregable.
test('the document explains why chalc does not install it', async () => {
  const dir = await project();

  await equip(dir);
  const doc = await readFile(join(dir, HOOK_DOC), 'utf8');

  assert.match(doc, /settings\.local\.json/, 'debe ofrecer la opción personal, no solo la del equipo');
  assert.match(doc, /--fast/);
});

test('the document is written in the language of the spec', async () => {
  const es = await project();
  const en = await project();

  await equip(es, 'español');
  await equip(en, 'english');

  // Sin atarse al número: la spec 013 añadió un segundo hook —el anotador de rutas escritas— y la
  // frase pasó a plural. Lo que el test fija es el IDIOMA, no cuántos hooks haya hoy.
  assert.match(await readFile(join(es, HOOK_DOC), 'utf8'), /chalc no l[oa]s? instala/i);
  assert.match(await readFile(join(en, HOOK_DOC), 'utf8'), /chalc does not install (?:it|them)/i);
});

// ── lo que NO hace ────────────────────────────────────────────────────────────────────────────

test('equipping never creates a settings file', async () => {
  const dir = await project();

  await equip(dir);

  for (const rel of ['.claude/settings.json', '.claude/settings.local.json']) {
    assert.ok(!existsSync(join(dir, rel)), `chalc no puede crear ${rel}`);
  }
});

test('equipping leaves an existing settings file byte for byte', async () => {
  const dir = await project();
  const before = '{\n  "hooks": {\n    "Stop": [ { "hooks": [ { "type": "command", "command": "mio.sh" } ] } ]\n  }\n}\n';
  await file(dir, '.claude/settings.json', before);
  await file(dir, '.claude/settings.local.json', '{ "model": "opus" }\n');

  await equip(dir);

  assert.equal(await readFile(join(dir, '.claude', 'settings.json'), 'utf8'), before);
  assert.equal(await readFile(join(dir, '.claude', 'settings.local.json'), 'utf8'), '{ "model": "opus" }\n');
});

// Todo lo del portón cuelga de `.chalc/`: fuera del repo equipado no se toca nada, y dentro tampoco
// se toca la configuración del asistente.
test('the hook document lives under .chalc, like everything else the gate emits', async () => {
  const dir = await project();

  await equip(dir);

  assert.ok(HOOK_DOC.startsWith('.chalc'));
  assert.ok(!existsSync(join(dir, '.claude', 'gate-hook.md')));
});

// Invariante que vale para todo el portón, no solo para el hook: nada de lo que chalc emite puede
// escribir fuera del repo equipado. `~/.claude/`, `~/.codex/` y compañía son de su dueño.
test('nothing the gate emits can reach outside the equipped repo', async () => {
  const gate = join(ROOT, 'catalog', 'gate');
  const files = [];

  const walk = async (rel) => {
    for (const entry of await readdir(join(gate, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (child.endsWith('.mjs')) files.push(child);
    }
  };
  await walk('');

  for (const rel of files) {
    const source = await readFile(join(gate, rel), 'utf8');
    assert.doesNotMatch(source, /homedir\s*\(|USERPROFILE|process\.env\.HOME\b/,
      `${rel} mira el HOME del usuario: el portón vive dentro del repo`);
  }
});
