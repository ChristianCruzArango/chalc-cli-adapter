// T8, T9, T12 (R6, R7, R9, R10) — enviar un aviso al otro lado, y marcarlo leído.
//
// Es la mitad del canal que NO se puede derivar: "estoy bloqueado esperando el endpoint de pagos" no
// está en ningún archivo. Hoy el usuario hace de mensajero entre dos terminales.
//
// La validación es estricta a propósito, igual que en la bitácora de los roles: quien escribe es un
// modelo de lenguaje, y cuanto más estrecho el contrato, más detectable el incumplimiento. Un aviso
// a medias —sin destinatario válido, o de tres párrafos— es peor que ninguno: el otro lado lo lee,
// no entiende qué se le pide y deja de mirar el buzón.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { markRead, send } from '../catalog/mail/lib/mailbox.mjs';
import { unreadMail } from '../catalog/next/lib/mail.mjs';

const PEERS = [{ id: 'front', path: '../front' }, { id: 'movil', path: '../movil' }];
const AT = '2026-08-09T14:32:11Z';

const box = () => mkdtemp(join(tmpdir(), 'chalc-mail-'));

const enviar = (dir, over = {}) => send({ dir, from: 'back', to: 'front', message: 'Endpoint de pagos listo.', peers: PEERS, now: AT, ...over });

// ── T8: enviar ────────────────────────────────────────────────────────────────────────────────

test('R6 — un aviso válido se escribe en la bandeja del destinatario', async () => {
  const dir = await box();
  const result = await enviar(dir);

  assert.ok(result.ok, result.error);
  assert.ok(existsSync(result.path));
  assert.match(result.path, /front[\\/]new[\\/]/, 'va a la bandeja de quien lo recibe');
});

test('R10 — el aviso registra remitente, destinatario y fecha', async () => {
  const dir = await box();
  const { path } = await enviar(dir);
  const text = await readFile(path, 'utf8');

  assert.match(text, /^from: back$/m);
  assert.match(text, /^to: front$/m);
  assert.match(text, new RegExp(`^date: ${AT}$`, 'm'));
  assert.match(text, /Endpoint de pagos listo\./);
});

test('R8 — el advisor lo ve inmediatamente: no hay entrega que esperar', async () => {
  // Sin demonio: quien escribe deja el aviso directamente donde el otro lo lee.
  const dir = await box();
  await enviar(dir);

  assert.deepEqual(await unreadMail(dir, 'front'), { unread: 1, from: ['back'] });
});

test('R6 — dos avisos del mismo remitente no se pisan', async () => {
  const dir = await box();
  await enviar(dir, { message: 'Primero.' });
  await enviar(dir, { message: 'Segundo.', now: '2026-08-09T14:32:12Z' });

  assert.equal((await unreadMail(dir, 'front')).unread, 2);
});

// ── T8: la validación ─────────────────────────────────────────────────────────────────────────

test('R7 — un destinatario que no existe se rechaza, y se dice cuáles hay', async () => {
  const dir = await box();
  const result = await enviar(dir, { to: 'fantasma' });

  assert.equal(result.ok, false);
  assert.match(result.error, /fantasma/);
  assert.match(result.error, /front/, 'el error debe listar los lados reales');
});

test('R7 — enviarse un aviso a uno mismo se rechaza', async () => {
  const result = await enviar(await box(), { to: 'back' });
  assert.equal(result.ok, false);
});

test('R7 — un mensaje vacío se rechaza', async () => {
  for (const message of ['', '   ', '\n']) {
    assert.equal((await enviar(await box(), { message })).ok, false, `no debería aceptarse: ${JSON.stringify(message)}`);
  }
});

test('R7 — un mensaje de más de una línea se rechaza', async () => {
  const result = await enviar(await box(), { message: 'Primera línea.\nSegunda línea.' });

  assert.equal(result.ok, false);
  assert.match(result.error, /una línea|one line/i);
});

test('R7 — un mensaje demasiado largo se rechaza diciendo el límite', async () => {
  const result = await enviar(await box(), { message: 'x'.repeat(300) });

  assert.equal(result.ok, false);
  assert.match(result.error, /\d+/, 'el error dice cuántos caracteres caben');
});

test('R7 — un aviso rechazado NO deja nada escrito', async () => {
  const dir = await box();
  await enviar(dir, { to: 'fantasma' });

  assert.equal((await unreadMail(dir, 'front')).unread, 0);
  assert.ok(!existsSync(join(dir, 'fantasma')), 'ni siquiera la carpeta del destinatario inventado');
});

// ── T9: marcar leído ──────────────────────────────────────────────────────────────────────────

test('R6 — marcar leído vacía la bandeja de entrada', async () => {
  const dir = await box();
  await enviar(dir);

  assert.equal(await markRead(dir, 'front'), 1);
  assert.deepEqual(await unreadMail(dir, 'front'), { unread: 0, from: [] });
});

test('R10 — los leídos se conservan, no se borran', async () => {
  const dir = await box();
  await enviar(dir);
  await markRead(dir, 'front');

  const leidos = await readdir(join(dir, 'front', 'read'));
  assert.equal(leidos.length, 1, 'el aviso sigue ahí, en otra carpeta');
});

test('R6 — marcar leído sin avisos no falla', async () => {
  assert.equal(await markRead(await box(), 'front'), 0);
});

test('R6 — marcar leído solo toca la bandeja de ESTE lado', async () => {
  const dir = await box();
  await enviar(dir, { to: 'front' });
  await enviar(dir, { to: 'movil' });

  await markRead(dir, 'front');

  assert.equal((await unreadMail(dir, 'movil')).unread, 1, 'el buzón del móvil no se toca');
});

// ── T12: fuera de los worktrees ───────────────────────────────────────────────────────────────

test('R9 — el buzón no escribe nada dentro de ningún worktree', async () => {
  // El buzón cuelga de la raíz del workspace; los lados son hermanos suyos. Un aviso dentro de
  // `.chalc/` de un lado aparecería en su `git status` y acabaría commiteado.
  const workspace = await mkdtemp(join(tmpdir(), 'chalc-ws-mail-'));
  const front = join(workspace, 'front');
  await mkdir(front, { recursive: true });
  await writeFile(join(front, 'marca.txt'), 'intacto', 'utf8');

  await send({ dir: join(workspace, '.chalc-mail'), from: 'back', to: 'front', message: 'Hola.', peers: PEERS, now: AT });

  assert.deepEqual(await readdir(front), ['marca.txt'], 'el worktree del front quedó intacto');
});

test('R7 — enviarse un aviso a uno mismo se rechaza aunque uno figure entre los lados', async () => {
  // El caso anterior lo tapaba la validación de destinatario: `back` no estaba en `peers`. Aquí sí
  // está, así que lo único que puede rechazarlo es la comprobación de que no eres tú.
  const peers = [{ id: 'back', path: '../back' }, { id: 'front', path: '../front' }];
  const result = await send({ dir: await box(), from: 'back', to: 'back', message: 'Hola.', peers, now: AT });

  assert.equal(result.ok, false);
  assert.match(result.error, /ti mismo|yourself/i);
});
