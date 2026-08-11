// T12 (R17) — las puertas de aprobación, en `.chalc/gate.json`.
//
// Van en el archivo del portón y no en uno propio porque describen el MISMO ciclo de trabajo, el
// usuario ya conoce ese archivo, y la fusión que exige R3 es exactamente la que la spec 007 ya
// resolvió en R16 — un segundo archivo obligaría a duplicarla. El coste asumido es que `gate.json`
// pasa a describir cómo medir y cómo trabajar; se acota dándole sección propia.
//
// Los defaults preservan el comportamiento de hoy: revisor obligatorio y OK del usuario al cerrar
// cada tarea. Cambiar eso en silencio al actualizar chalc sería peor que no ofrecer la opción.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadConfig } from '../catalog/gate/lib/config.mjs';
import { detectGateConfig, pendingKeys } from '../lib/gatedetect.mjs';

async function repoWith(gateJson) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-flow-'));
  await mkdir(join(root, '.chalc'), { recursive: true });
  if (gateJson !== null) await writeFile(join(root, '.chalc', 'gate.json'), JSON.stringify(gateJson));
  return root;
}

// ── los defaults conservan el comportamiento actual ───────────────────────────────────────────

test('R17 — sin sección flow, el defecto es revisor obligatorio y OK por tarea', async () => {
  const { config } = await loadConfig(await repoWith({ test: { command: 'npm test' } }));

  assert.equal(config.flow.approvals.task, true);
  assert.equal(config.flow.approvals.feature, true);
  assert.equal(config.flow.review.required, true);
});

test('R17 — un repo equipado con una versión anterior de chalc no cambia de comportamiento', async () => {
  // Es el caso que más importa: `gate.json` viejo, sin `flow`. Si el defecto fuera "sin OK", una
  // actualización de chalc dejaría al asistente encadenando tareas sin que nadie las apruebe.
  const { config } = await loadConfig(await repoWith({ mutation: { threshold: 90 } }));
  assert.equal(config.flow.approvals.task, true);
});

// ── lo que el usuario editó, manda ────────────────────────────────────────────────────────────

test('R17 — apagar la puerta de tarea se respeta', async () => {
  const { config } = await loadConfig(await repoWith({ flow: { approvals: { task: false } } }));

  assert.equal(config.flow.approvals.task, false);
  assert.equal(config.flow.approvals.feature, true, 'lo no tocado conserva su defecto');
  assert.equal(config.flow.review.required, true);
});

test('R17 — apagar la revisión se respeta y no arrastra a las aprobaciones', async () => {
  const { config } = await loadConfig(await repoWith({ flow: { review: { required: false } } }));

  assert.equal(config.flow.review.required, false);
  assert.equal(config.flow.approvals.task, true);
});

// ── la detección escribe la sección para que el usuario la vea ────────────────────────────────

test('R17 — la config detectada trae la sección flow, para que el knob sea visible', async () => {
  const config = await detectGateConfig(await repoWith(null), { role: 'back', language: 'es' });

  assert.deepEqual(config.flow.approvals, { task: true, feature: true });
  assert.deepEqual(config.flow.review, { required: true });
  // `flow.roles` lo añadió la spec 009 y tiene su propio test en `role-contract.test.mjs`: aquí
  // solo importa que la sección de puertas siga entera.
  assert.ok(Array.isArray(config.flow.roles));
});

test('R17 — las puertas no son campos pendientes: tienen defecto, no hace falta completarlas', async () => {
  const config = await detectGateConfig(await repoWith(null), { role: 'back', language: 'es' });

  assert.ok(!pendingKeys(config).some((key) => key.startsWith('flow')), 'flow nunca bloquea el portón');
});
