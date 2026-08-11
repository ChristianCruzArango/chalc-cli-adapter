// T19–T20 (R6) — R20 de la spec 007, convertido en test.
//
// Aquella pedía que las skills y `.chalc/gate.json` coincidieran en comando, ruta de reporte y
// reporter a habilitar. Era una obligación dirigida a quien edita, y por eso se rompía: una ruta
// cambiada en un sitio y no en el otro deja al asistente configurando la herramienta para que
// escriba donde el portón no mira, y la tarea bloquea en cada corrida por seguir la guía.
//
// Ahora ambas nacen de la misma fila de `catalog/tools/`, así que la contradicción solo puede venir
// de un bug en la derivación. Este archivo es donde ese bug se detiene — en el CI de chalc, no en la
// máquina de nadie.
//
// El recorrido es sobre el DIRECTORIO, nunca sobre una lista escrita aquí: un stack nuevo entra solo
// (T20). Si hubiera que añadirlo a mano, el invariante se quedaría atrás en el primer lenguaje que
// alguien agregue — que es exactamente cómo empezó el problema que la spec 011 resuelve.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { detectContext } from '../lib/detect.mjs';
import { detectGateConfig } from '../lib/gatedetect.mjs';
import { loadToolTable, resolveStack, resolveTools } from '../lib/tooltable.mjs';
import { renderMutationSkill } from '../lib/toolskill.mjs';

const stacks = await loadToolTable();

// Un literal aproximado de una expresión regular, para fabricar una señal que la active. No hace
// falta que sea exacto: solo que el `match` del stack lo encuentre.
const literalOf = (pattern) => String(pattern).replace(/\\b|\\\.|[\^$()|?*+\[\]]/g, (m) => (m === '\\.' ? '.' : ''));

// Un repo mínimo que active un stack, fabricado DESDE SU PROPIA DECLARACIÓN. Nada aquí sabe de
// ningún lenguaje concreto: por eso un stack nuevo queda cubierto sin tocar este archivo.
async function fixtureFor(stack) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-coherence-'));
  const write = async (rel, text) => {
    await mkdir(dirname(join(dir, rel)), { recursive: true });
    await writeFile(join(dir, rel), text, 'utf8');
  };

  for (const name of stack.detect?.files || []) await write(name, '');
  for (const pattern of stack.detect?.globs || []) await write(pattern.replace(/\*/g, 'demo'), '');

  // Señales: se escribe el literal del primer caso, para que la rama "resuelta" también se ejercite.
  for (const rule of [stack.test, stack.mutation]) {
    if (rule?.rule !== 'bySignal') continue;
    const hint = literalOf(rule.cases?.[0]?.match || '');
    for (const source of stack.signals?.[rule.signal] || []) await write(source, hint);
  }

  // Campos JSON que una regla `jsonField` mira.
  for (const rule of [stack.test, stack.mutation]) {
    if (rule?.rule !== 'jsonField') continue;
    const [head, ...rest] = String(rule.path).split('.');
    const value = rest.reduceRight((acc, key) => ({ [key]: acc }), 'demo');
    await write(rule.file, JSON.stringify({ [head]: value }, null, 2));
  }

  return dir;
}

// ── T19/T20: por CADA stack de la tabla ───────────────────────────────────────────────────────

for (const stack of stacks) {
  test(`R6 — ${stack.id}: la skill y gate.json dicen lo mismo`, async () => {
    const dir = await fixtureFor(stack);
    const ctx = await detectContext(dir);

    const resolved = resolveStack(stacks, ctx);
    assert.equal(resolved?.id, stack.id, `el fixture de ${stack.id} no lo activa`);

    const tools = await resolveTools(resolved, dir, ctx);
    const config = await detectGateConfig(dir);
    const skill = renderMutationSkill('{{MY_STACK}}', { stacks, stack: resolved, tools });

    // Lo que el portón espera y lo que el asistente lee tienen que ser el MISMO texto.
    for (const key of ['command', 'report', 'install', 'format']) {
      const expected = config.mutation[key];
      if (!expected) continue;
      assert.ok(skill.includes(expected), `${stack.id}: la skill no menciona el ${key} "${expected}"`);
    }

    // Y el comando de tests, que es lo primero que el asistente necesita.
    if (config.test.command) {
      assert.ok(skill.includes(config.test.command), `${stack.id}: la skill no menciona "${config.test.command}"`);
    }
  });

  test(`R6 — ${stack.id}: la skill nunca promete lo que el portón no puede verificar`, async () => {
    const dir = await fixtureFor(stack);
    const ctx = await detectContext(dir);
    const resolved = resolveStack(stacks, ctx);
    const tools = await resolveTools(resolved, dir, ctx);
    const skill = renderMutationSkill('{{MY_STACK}}', { stacks, stack: resolved, tools });

    const verifiable = ['elements', 'junit', 'pit'].includes(tools.mutation?.format);
    if (!verifiable) {
      assert.match(skill, /required.*false|no parser|could not|BLOCKER/i,
        `${stack.id}: sin parser, la skill tiene que decirlo y ofrecer la salida`);
    }
  });
}

test('T20 — la tabla no está vacía: sin stacks, los bucles de arriba no probarían nada', () => {
  assert.ok(stacks.length >= 7, `solo se cargaron ${stacks.length} stacks`);
});

test('T20 — el recorrido cubre TODOS los archivos de la tabla, no un subconjunto', async () => {
  const { readdir } = await import('node:fs/promises');
  const { TOOLS_DIR } = await import('../lib/tooltable.mjs');
  const files = (await readdir(TOOLS_DIR)).filter((f) => f.endsWith('.json'));

  assert.equal(stacks.length, files.length, 'hay archivos en la tabla que no se cargaron');
});
