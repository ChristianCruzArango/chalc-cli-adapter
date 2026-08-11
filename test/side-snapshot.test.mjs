// T2, T3, T10 (R1, R11, R12, R8) — leer los lados hermanos desde el advisor.
//
// Aquí el advisor pasa a leer archivos FUERA de su repo: la copia del contrato del lado dueño y el
// buzón, ambos dentro del workspace. Es lectura y está acotada, pero rompe la comodidad de que todo
// lo que mira esté bajo su propio árbol.
//
// La consecuencia es la obligación de siempre, más fuerte todavía: si el usuario movió o borró un
// lado, esa lectura falla — y no puede llevarse por delante el ciclo entero. Un canal secundario
// jamás bloquea el trabajo (R12).

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { snapshot } from '../catalog/next/lib/snapshot.mjs';

const SPEC = 'specs/003-pago';
const CONTRATO = '# Contrato\n\n## POST /pagos\n- 201 → { id }\n';

// Un workspace de la spec 005: dos lados hermanos y el buzón en la raíz, fuera de los worktrees.
async function workspace({ ownerContract = CONTRATO, mineContract = CONTRATO, sides, mail } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-ws-'));
  const front = join(root, 'front');
  const back = join(root, 'back');

  for (const [dir, contract] of [[front, mineContract], [back, ownerContract]]) {
    await mkdir(join(dir, SPEC, 'contracts'), { recursive: true });
    await mkdir(join(dir, '.chalc'), { recursive: true });
    await mkdir(join(dir, 'src'), { recursive: true });
    await writeFile(join(dir, SPEC, 'tasks.md'), '- [x] T1\n- [ ] T2\n', 'utf8');
    if (contract !== null) await writeFile(join(dir, SPEC, 'contracts', 'api.md'), contract, 'utf8');
    await writeFile(join(dir, 'src', 'a.ts'), 'export const x = 1;\n', 'utf8');
  }

  await writeFile(join(front, '.chalc', 'gate.json'), JSON.stringify({
    spec: { dir: 'specs' }, pending: [], language: 'es', role: 'front',
    flow: {
      sides: sides === null ? undefined : {
        me: 'front', owner: 'back', enabled: true, mail: '../.chalc-mail',
        peers: [{ id: 'back', path: '../back' }],
        ...sides
      }
    }
  }), 'utf8');

  if (mail) {
    for (const [name, text] of Object.entries(mail)) {
      await mkdir(join(root, '.chalc-mail', 'front', 'new'), { recursive: true });
      await writeFile(join(root, '.chalc-mail', 'front', 'new', name), text, 'utf8');
    }
  }
  return { root, front, back };
}

const take = (dir, over = {}) => snapshot(dir, over);

// ── T2: la copia del dueño ────────────────────────────────────────────────────────────────────

test('R1 — con las dos copias iguales no hay deriva', async () => {
  const { front } = await workspace();
  const s = await take(front);

  assert.equal(s.contract.differs, false);
});

test('R1 — con la copia del dueño cambiada, hay deriva y se dice cuánto', async () => {
  const { front } = await workspace({ ownerContract: CONTRATO.replace('201', '202') });
  const s = await take(front);

  assert.equal(s.contract.differs, true);
  assert.ok(s.contract.lines > 0);
});

test('R1 — el snapshot trae las dos rutas, para poder mostrar la diferencia', async () => {
  const { front } = await workspace({ ownerContract: CONTRATO.replace('201', '202') });
  const s = await take(front);

  assert.match(s.contract.minePath, /contracts[\\/]api\.md$/);
  assert.match(s.contract.ownerPath, /back[\\/]specs/);
});

// ── R11: sin lados, nada ──────────────────────────────────────────────────────────────────────

test('R11 — sin sección de lados no se compara nada ni se reporta problema', async () => {
  const { front } = await workspace({ sides: null });
  const s = await take(front);

  assert.equal(s.contract.differs, false);
  assert.deepEqual(s.problems, []);
});

test('R11 — sin contrato en este lado no hay nada que comparar', async () => {
  const { front } = await workspace({ mineContract: null });
  const s = await take(front);

  assert.equal(s.contract.differs, false);
});

// ── R12: un lado que no está no puede tumbar el ciclo ─────────────────────────────────────────

test('R12 — un lado hermano que no existe se reporta como problema, no como bloqueo', async () => {
  const { front } = await workspace({ sides: { peers: [{ id: 'back', path: '../fantasma' }] } });
  const s = await take(front, {});

  // El ciclo sigue: hay hechos suficientes para decidir.
  assert.equal(s.contract.differs, false);
  assert.ok(s.tasks.hasTasksFile, 'el resto del snapshot se leyó igual');
});

test('R12 — un buzón inaccesible no impide aconsejar', async () => {
  const { front } = await workspace({ sides: { mail: '../no-existe' } });
  const s = await take(front);

  assert.equal(s.mail.unread, 0);
  assert.ok(s.tasks.hasTasksFile);
});

// ── T10: el buzón ─────────────────────────────────────────────────────────────────────────────

test('R8 — los avisos sin leer se cuentan y se dice de quién son', async () => {
  const aviso = (from) => `from: ${from}\nto: front\ndate: 2026-08-09T14:32:11Z\n\nHola.\n`;
  const { front } = await workspace({
    mail: { '20260809T143211Z-from-back.md': aviso('back'), '20260809T150000Z-from-movil.md': aviso('movil') }
  });

  const s = await take(front);
  assert.equal(s.mail.unread, 2);
  assert.deepEqual([...s.mail.from].sort(), ['back', 'movil']);
});

test('R8 — sin avisos, cero y sin remitentes', async () => {
  const { front } = await workspace();
  const s = await take(front);

  assert.deepEqual(s.mail, { unread: 0, from: [] });
});

test('R8 — un aviso con formato raro se ignora y no invalida los demás', async () => {
  const bueno = 'from: back\nto: front\ndate: 2026-08-09T14:32:11Z\n\nHola.\n';
  const { front } = await workspace({
    mail: { '20260809T143211Z-from-back.md': bueno, 'basura.md': 'no soy un aviso' }
  });

  const s = await take(front);
  assert.equal(s.mail.unread, 1);
});

// ── el advisor sigue sin escribir ─────────────────────────────────────────────────────────────

test('R15 — leer el buzón no lo modifica: el advisor sigue siendo un observador', async () => {
  const { root, front } = await workspace({
    mail: { '20260809T143211Z-from-back.md': 'from: back\nto: front\ndate: 2026-08-09T14:32:11Z\n\nHola.\n' }
  });
  const { readdir } = await import('node:fs/promises');

  const before = (await readdir(join(root, '.chalc-mail', 'front', 'new'))).sort();
  await take(front);

  assert.deepEqual((await readdir(join(root, '.chalc-mail', 'front', 'new'))).sort(), before);
});
