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

// Desde la spec 028 las aprobaciones del usuario (la spec y el cierre) no son una puerta configurable: de
// `flow` solo queda el revisor. Entre las dos aprobaciones, el equipo trabaja solo.
test('R17 — sin sección flow, el defecto es revisor obligatorio, sin interruptor de aprobaciones', async () => {
  const { config } = await loadConfig(await repoWith({ test: { command: 'npm test' } }));

  assert.equal('approvals' in config.flow, false);
  assert.equal(config.flow.review.required, true);
});

test('R17 — un repo equipado con una versión anterior de chalc no cambia de comportamiento', async () => {
  // `gate.json` viejo, sin `flow`: el revisor sigue siendo obligatorio.
  const { config } = await loadConfig(await repoWith({ mutation: { threshold: 90 } }));
  assert.equal(config.flow.review.required, true);
});

// ── lo que el usuario editó, manda ────────────────────────────────────────────────────────────

test('spec 028, R8 — un flow.approvals de una versión anterior se lee sin error y no arrastra al revisor', async () => {
  const { config, error } = await loadConfig(await repoWith({ flow: { approvals: { task: false } } }));

  assert.ok(!error);
  assert.equal(config.flow.review.required, true);
});

test('R17 — apagar la revisión se respeta', async () => {
  const { config } = await loadConfig(await repoWith({ flow: { review: { required: false } } }));

  assert.equal(config.flow.review.required, false);
});

// ── la detección escribe la sección para que el usuario la vea ────────────────────────────────

test('R17 — la config detectada trae la sección flow, para que el knob sea visible', async () => {
  const config = await detectGateConfig(await repoWith(null), { role: 'back', language: 'es' });

  assert.equal('approvals' in config.flow, false);
  assert.deepEqual(config.flow.review, { required: true });
  // `flow.roles` lo añadió la spec 009 y tiene su propio test en `role-contract.test.mjs`: aquí
  // solo importa que la sección de puertas siga entera.
  assert.ok(Array.isArray(config.flow.roles));
});

test('R17 — las puertas no son campos pendientes: tienen defecto, no hace falta completarlas', async () => {
  const config = await detectGateConfig(await repoWith(null), { role: 'back', language: 'es' });

  assert.ok(!pendingKeys(config).some((key) => key.startsWith('flow')), 'flow nunca bloquea el portón');
});
