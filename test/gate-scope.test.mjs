// T4 (spec 013, R10/R12) — la política de precedencia del alcance.
//
// Aquí es donde la regla se vuelve código: cuando hay registro de lo que la tarea escribió, el
// alcance ES el registro. El diff no sabe de tareas —ve un árbol con cambios y no distingue los
// míos de los que ya estaban a medias por otra cosa—, así que degrada a respaldo.
//
// La función es pura: recibe las dos listas y devuelve el alcance. Quien las obtiene es `taskScope`
// (T6). Separarlo permite probar la política rama por rama sin repos de git ni fixtures.

import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveScope } from '../catalog/gate/lib/scope.mjs';

// EL caso que abrió la spec: el árbol arrastra trabajo en curso de otra cosa. Antes eso tenía dos
// desenlaces, los dos malos — revisarlo todo, o no revisar "porque el diff es casi todo trabajo
// ajeno". Ahora tiene uno: se acota, se declara lo que se dejó fuera, y la revisión ocurre.
test('the registry wins over the diff, and the noise is declared', () => {
  const scope = resolveScope({
    registry: ['src/pago.service.ts', 'src/pago.model.ts'],
    diff: ['src/pago.service.ts', 'src/pago.model.ts', 'src/otra-tarea-a-medias.ts', 'src/experimento.ts']
  });

  assert.deepEqual(scope.files, ['src/pago.model.ts', 'src/pago.service.ts']);
  assert.equal(scope.source, 'registry');
  assert.deepEqual(scope.excluded, ['src/experimento.ts', 'src/otra-tarea-a-medias.ts']);
});

// Un archivo escrito y luego deshecho no es trabajo de esta tarea: su contenido es el de la línea
// base. Revisarlo devolvería deuda vieja con nombre de hallazgo nuevo, que es justo lo que el
// alcance por tarea evita. Se saca, pero se dice — nada sale del alcance en silencio.
test('what was written and then undone leaves the scope, and says so', () => {
  const scope = resolveScope({
    registry: ['src/pago.service.ts', 'src/probando.ts'],
    diff: ['src/pago.service.ts']
  });

  assert.deepEqual(scope.files, ['src/pago.service.ts']);
  assert.deepEqual(scope.reverted, ['src/probando.ts']);
});

// Sin diff no hay con qué contrastar, y el registro se respeta entero. Recortarlo aquí sería recortar
// a ciegas: el riesgo de dejar trabajo sin revisar pesa más que el de revisar un archivo intacto.
test('with no diff to compare against, the registry stands whole', () => {
  const scope = resolveScope({ registry: ['src/pago.service.ts', 'src/probando.ts'], diff: null });

  assert.deepEqual(scope.files, ['src/pago.service.ts', 'src/probando.ts']);
  assert.equal(scope.source, 'registry');
  assert.deepEqual(scope.excluded, []);
  assert.deepEqual(scope.reverted, []);
});

// El registro lo escriben hooks y tools que anotan TODO lo que tocan, incluida la evidencia del
// propio portón y el checkbox de tasks.md. El filtro de "qué es fuente del usuario" es el mismo que
// aplica el diff: si no fuera el mismo, el alcance dependería de por dónde llegó el archivo.
test('the registry is filtered to user source, like the diff is', () => {
  const scope = resolveScope({
    registry: ['src/pago.service.ts', '.chalc/gate.md', 'README.md', 'specs/001-demo/tasks.md'],
    diff: ['src/pago.service.ts']
  });

  assert.deepEqual(scope.files, ['src/pago.service.ts']);
  assert.deepEqual(scope.reverted, [], 'lo que no es fuente no cuenta como deshecho');
});

test('noise that is not user source is not declared as excluded either', () => {
  const scope = resolveScope({
    registry: ['src/pago.service.ts'],
    diff: ['src/pago.service.ts', '.chalc/gate.md', 'src/otra-tarea.ts']
  });

  assert.deepEqual(scope.excluded, ['src/otra-tarea.ts']);
});

test('the scope is deduplicated, normalised and sorted', () => {
  const scope = resolveScope({
    registry: ['src\\pago.service.ts', 'src/pago.service.ts', 'src/a.ts'],
    diff: null
  });

  assert.deepEqual(scope.files, ['src/a.ts', 'src/pago.service.ts']);
});

// Sin registro no hay nada que preferir: manda el diff, y el alcance dice de dónde salió para que la
// evidencia pueda declararlo (R7).
test('with no registry the diff takes over', () => {
  const scope = resolveScope({ registry: [], diff: ['src/pago.service.ts'] });

  assert.deepEqual(scope.files, ['src/pago.service.ts']);
  assert.notEqual(scope.source, 'registry');
  assert.deepEqual(scope.excluded, [], 'sin registro no hay nada que se haya dejado fuera');
});

// T5 (spec 013, R4/R4b) — los respaldos, y la diferencia que lo decide todo.
//
// `[]` es "no cambió nada" y `null` es "no sé". Con el mismo aspecto en pantalla, tienen desenlaces
// opuestos: uno se puede informar, el otro obliga a bloquear. Confundirlos es lo que hacía que un
// proyecto sin git se revisara ENTERO — el portón cambiaba de pregunta sin decírselo a nadie.
test('nothing changed is not the same as cannot tell', () => {
  const nothingChanged = resolveScope({ registry: [], diff: [] });
  const cannotTell = resolveScope({ registry: [], diff: null });

  assert.deepEqual(nothingChanged.files, []);
  assert.equal(nothingChanged.undetermined, false, 'un repo sin cambios se sabe: no cambió nada');

  assert.deepEqual(cannotTell.files, []);
  assert.equal(cannotTell.undetermined, true, 'sin git y sin registro no se puede fijar el alcance');
  assert.equal(cannotTell.source, 'none');
});

// R4: sin línea base se mide contra la base de rama. Sigue siendo "archivos modificados" —de más,
// pero modificados—, nunca el proyecto entero. Quién resolvió el diff lo dice el llamador, y el
// alcance lo arrastra para que la evidencia pueda declararlo (R7).
test('the scope carries where the diff was measured from', () => {
  assert.equal(resolveScope({ registry: [], diff: ['src/a.ts'], diffSource: 'branch' }).source, 'branch');
  assert.equal(resolveScope({ registry: [], diff: ['src/a.ts'] }).source, 'baseline', 'por defecto, la línea base');
});

// Con registro no hace falta git para saber qué se tocó: el alcance está determinado aunque el diff
// no se haya podido calcular. Es justo el caso de un proyecto sin repo pero con harness.
test('a registry determines the scope even with no diff at all', () => {
  const scope = resolveScope({ registry: ['src/a.ts'], diff: null });

  assert.equal(scope.undetermined, false);
});

// Todo lo de la tarea deshecho: el alcance queda vacío, pero se SABE que está vacío. No es un "no
// sé", así que no bloquea — lo informa T8 como corrida sin nada que revisar.
test('an empty scope that is known is not an undetermined one', () => {
  const scope = resolveScope({ registry: ['src/probando.ts'], diff: [] });

  assert.deepEqual(scope.files, []);
  assert.equal(scope.undetermined, false);
  assert.deepEqual(scope.reverted, ['src/probando.ts']);
});

// "No hay registro" y "el registro quedó vacío tras filtrar" son lo mismo para el alcance: en ninguno
// de los dos casos hay una lista de archivos escritos utilizable, así que manda el diff. Tratarlos
// distinto daría un alcance vacío —que R13 prohíbe confundir con aprobado— por haber anotado un
// README.
test('a registry with nothing usable in it behaves as no registry at all', () => {
  const scope = resolveScope({ registry: ['README.md'], diff: ['src/pago.service.ts'] });

  assert.deepEqual(scope.files, ['src/pago.service.ts']);
  assert.notEqual(scope.source, 'registry');
});
