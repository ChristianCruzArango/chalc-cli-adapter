// waves.mjs — el reparto de las specs en olas (spec 033, R3–R5). Responsabilidad ÚNICA: decidir qué specs pueden
// trabajarse a la vez y cuáles esperan. Razón de cambio: la regla de paralelismo.
//
// Este archivo lo emite chalc dentro de `.chalc/team/lib/`. No edites aquí: se regenera al equipar el repo.
//
// PURO. La unidad es la spec: un desarrollador por spec. Dos specs comparten ola solo si se puede DEMOSTRAR que
// no chocan —sus `Toca:` no se solapan—, y una spec espera a aquellas de las que depende.

import { overlaps } from './scope.mjs';

const nameOf = (spec) => spec.split('/').pop();
const refusal = (problem, spec) => ({ waves: [], problem, spec });

// ¿Chocan dos specs? Sí si alguna no declaró qué toca (no se puede demostrar que no) o si sus alcances se solapan.
const clash = (a, b) => !a.touches.length || !b.touches.length || a.touches.some((x) => b.touches.some((y) => overlaps(x, y)));

// Las specs en un orden que respeta las dependencias y, dentro de eso, el de la lista. null si hay un ciclo.
function ordered(specs) {
  const done = [];
  const pending = [...specs];
  while (pending.length) {
    const ready = pending.findIndex((s) => s.dependsOn.every((dep) => done.some((d) => nameOf(d.spec) === dep)));
    if (ready < 0) return { order: null, stuck: pending[0] };
    done.push(...pending.splice(ready, 1));
  }
  return { order: done, stuck: null };
}

// La primera ola, a partir de `from`, donde `spec` no choca con ninguna de las que ya están.
function freeWave(waves, spec, from) {
  let wave = from;
  while ((waves[wave] || []).some((other) => clash(spec, other))) wave += 1;
  return wave;
}

/** { waves: [[carpeta…]…], problem, spec }. specs: [{ spec, touches, dependsOn }]. Con problema, ninguna ola. */
export function wavesOf(specs) {
  const known = new Set(specs.map((s) => nameOf(s.spec)));
  const orphan = specs.find((s) => s.dependsOn.some((dep) => !known.has(dep)));
  if (orphan) return refusal('unknown-dependency', orphan.spec);
  const { order, stuck } = ordered(specs);
  if (!order) return refusal('dependency-cycle', stuck.spec);

  const waves = [];
  const waveOf = new Map();
  for (const spec of order) {
    const after = Math.max(-1, ...spec.dependsOn.map((dep) => waveOf.get(dep)));
    const wave = freeWave(waves, spec, after + 1);
    (waves[wave] ||= []).push(spec);
    waveOf.set(nameOf(spec.spec), wave);
  }
  // Dentro de cada ola, en el orden en que llegaron.
  const position = new Map(specs.map((s, index) => [s.spec, index]));
  return { waves: waves.map((wave) => wave.map((s) => s.spec).sort((a, b) => position.get(a) - position.get(b))), problem: '', spec: '' };
}
