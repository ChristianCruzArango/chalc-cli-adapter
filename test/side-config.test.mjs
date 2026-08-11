// T15–T17 (R2, R11, R13) — quién sabe que hay lados, y quién no.
//
// `flow.sides` no lo puede detectar el portón: mirando UN repo no hay forma de saber que es el front
// de un workspace. Lo sabe el único que reparte, `chalc feature` en modo worktree, y por eso es el
// punto donde se olvidaría. De ahí el test del flujo completo y no solo de las piezas.
//
// Y el defecto es apagado. El caso más común es el mono-repo, que no tiene con quién coordinarse: si
// la sección viniera encendida por defecto, cada repo equipado empezaría a buscar hermanos que no
// existen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../catalog/gate/lib/config.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';
import { sidesFor } from '../lib/sides.mjs';

// ── T15: la forma y el defecto ────────────────────────────────────────────────────────────────

test('R11 — la config detectada trae la sección apagada: el caso común es el mono-repo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-sides-'));
  const config = await detectGateConfig(dir, { role: '', language: 'es' });

  assert.equal(config.flow.sides.enabled, false);
  assert.deepEqual(config.flow.sides.peers, []);
});

test('R11 — un gate.json sin la sección se lee como apagada, no como rota', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-sides-old-'));
  await mkdir(join(dir, '.chalc'), { recursive: true });
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({ test: { command: 'npm test' } }), 'utf8');

  const { config } = await loadConfig(dir);
  assert.equal(config.flow.sides.enabled, false);
});

test('R13 — lo que el usuario ajustó en la sección se conserva', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-sides-merge-'));
  await mkdir(join(dir, '.chalc'), { recursive: true });
  await writeFile(join(dir, '.chalc', 'gate.json'), JSON.stringify({
    flow: { sides: { me: 'web', owner: 'api', enabled: false } }
  }), 'utf8');

  const { config } = await loadConfig(dir);
  assert.equal(config.flow.sides.me, 'web');
  assert.equal(config.flow.sides.enabled, false, 'apagarlo a mano se respeta');
});

// ── T16: quién compone la sección ─────────────────────────────────────────────────────────────

test('R2 — con varios lados, cada uno recibe su propia vista del workspace', () => {
  const sides = ['back', 'front', 'movil'];

  const front = sidesFor('front', sides);
  assert.equal(front.me, 'front');
  assert.equal(front.owner, 'back', 'el dueño es el primero declarado, no el nombre `back`');
  assert.equal(front.enabled, true);
  assert.deepEqual(front.peers, [{ id: 'back', path: '../back' }, { id: 'movil', path: '../movil' }]);
  assert.equal(front.mail, '../.chalc-mail');
});

test('R2 — el dueño no se lista a sí mismo entre sus pares', () => {
  const back = sidesFor('back', ['back', 'front']);

  assert.equal(back.owner, 'back');
  assert.deepEqual(back.peers, [{ id: 'front', path: '../front' }]);
});

test('R2 — el dueño sale del orden declarado, no de llamarse `back`', () => {
  const web = sidesFor('web', ['api', 'web']);

  assert.equal(web.owner, 'api');
  assert.deepEqual(web.peers, [{ id: 'api', path: '../api' }]);
});

test('R11 — con un solo lado no hay coordinación posible', () => {
  assert.equal(sidesFor('back', ['back']).enabled, false);
});

test('R11 — sin lados, apagado', () => {
  assert.equal(sidesFor('', []).enabled, false);
});

test('R9 — el buzón apunta FUERA de los worktrees, a la raíz del workspace', () => {
  // Dentro de `.chalc/` de un lado aparecería en su `git status` y acabaría commiteado.
  const front = sidesFor('front', ['back', 'front']);

  assert.ok(front.mail.startsWith('../'), `el buzón no puede vivir dentro del worktree: ${front.mail}`);
  assert.ok(!front.mail.includes('.chalc/'), 'ni dentro de la carpeta que el portón gestiona');
});
