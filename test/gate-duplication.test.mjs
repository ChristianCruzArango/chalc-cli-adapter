// T1–T7 (R1–R4) — qué es duplicación y qué solo lo parece.
//
// Esta etapa vive o muere por los falsos positivos. En TypeScript, cinco `import` seguidos de un `}`
// aparecen idénticos en medio repo; si contaran, el primer informe traería cientos de hallazgos
// falsos y el linter dejaría de leerse — que es peor que no tenerlo, porque además tapa los buenos.
//
// Por eso la mitad de este archivo son casos que NO deben disparar. La spec 007 fijó la línea:
// «señales medibles y de alta confianza». La duplicación literal cae de ese lado; la semántica —dos
// funciones que hacen lo mismo con otros nombres— es del revisor, y normalizar identificadores para
// cazarla nos pondría del lado malo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { findDuplication, significantLines } from '../catalog/gate/lib/duplication.mjs';

// Un bloque de 8 líneas de las que 7 son SIGNIFICATIVAS: el `}` suelto lo descarta R3. El umbral
// `minLines` se mide siempre en líneas significativas, no en líneas del archivo — es lo coherente con
// que el ruido de gramática no cuente para nada.
const BLOQUE = [
  'const total = items.reduce((a, b) => a + b.monto, 0);',
  'if (total <= 0) {',
  '  throw new PagoInvalido("el monto debe ser positivo");',
  '}',
  'const comision = total * TASA;',
  'const neto = total - comision;',
  'logger.info("cobro calculado", { total, comision });',
  'return { total, comision, neto };'
];

const file = (name, lines) => ({ file: name, text: lines.join('\n') });

const dup = (files, over = {}) => findDuplication(files, { minLines: 6, ...over });

// ── T1: qué llega normalizado ─────────────────────────────────────────────────────────────────

test('R2 — se conserva el número de línea ORIGINAL de cada línea significativa', () => {
  const out = significantLines('// nota\n\nconst a = 1;\n\n  const b = 2;\n');

  assert.deepEqual(out.map((l) => l.line), [3, 5]);
  assert.deepEqual(out.map((l) => l.code), ['const a = 1;', 'const b = 2;']);
});

test('R2 — la sangría y los espacios finales no distinguen dos líneas', () => {
  const [a] = significantLines('    const x = 1;   ');
  const [b] = significantLines('const x = 1;');

  assert.equal(a.code, b.code);
});

test('R2 — los comentarios no cuentan, ni de línea ni de bloque', () => {
  const out = significantLines('const a = 1; // cobra\n/* bloque\n   entero */\nconst b = 2;');

  assert.deepEqual(out.map((l) => l.code), ['const a = 1;', 'const b = 2;']);
});

// ── T2: lo que la gramática repite ────────────────────────────────────────────────────────────

test('R3 — imports, cierres sueltos, else y decoradores no son líneas significativas', () => {
  const ruido = [
    "import { Injectable } from '@nestjs/common';",
    "import { Repository } from 'typeorm';",
    'export * from "./modelos";',
    '}',
    '  }',
    '});',
    '] ;',
    'else {',
    '@Injectable()',
    "'use strict';"
  ].join('\n');

  assert.deepEqual(significantLines(ruido), [], `no debería contar ninguna: ${JSON.stringify(significantLines(ruido))}`);
});

test('R3 — una línea con código de verdad sí cuenta, aunque empiece parecido', () => {
  const out = significantLines('import_total = 5;\nelseValor = 3;\nreturn { a };');

  assert.equal(out.length, 3);
});

// ── T3/T6: encontrar el bloque ────────────────────────────────────────────────────────────────

test('R1 — un bloque repetido en dos archivos se reporta con las dos posiciones', () => {
  const found = dup([
    file('src/pago.ts', ['const cabecera = 1;', ...BLOQUE]),
    file('src/cobro.ts', ['function otra() {', ...BLOQUE])
  ]);

  assert.equal(found.length, 1);
  const [d] = found;
  assert.deepEqual([d.a.file, d.b.file].sort(), ['src/cobro.ts', 'src/pago.ts']);
  assert.equal(d.lines, 7, 'siete significativas: el `}` suelto no cuenta');
});

test('R1 — la línea reportada es la del inicio del bloque en cada archivo', () => {
  const [d] = dup([
    file('src/a.ts', ['x();', 'y();', ...BLOQUE]),
    file('src/b.ts', [...BLOQUE])
  ]);

  const a = [d.a, d.b].find((x) => x.file === 'src/a.ts');
  const b = [d.a, d.b].find((x) => x.file === 'src/b.ts');
  assert.equal(a.line, 3, 'en a.ts el bloque empieza en la 3');
  assert.equal(b.line, 1, 'en b.ts empieza en la 1');
});

test('R2 — el mismo bloque con otra sangría y otros comentarios sigue siendo el mismo', () => {
  const disfrazado = BLOQUE.map((l, i) => (i % 2 ? `    ${l}   // apunte` : `\t${l}`));

  assert.equal(dup([file('src/a.ts', BLOQUE), file('src/b.ts', disfrazado)]).length, 1);
});

test('R1 — duplicación dentro del MISMO archivo también cuenta', () => {
  const found = dup([file('src/a.ts', [...BLOQUE, 'const separador = 0;', ...BLOQUE])]);

  assert.equal(found.length, 1);
  assert.equal(found[0].a.file, 'src/a.ts');
  assert.equal(found[0].b.file, 'src/a.ts');
});

// ── T4: un hallazgo por bloque, no uno por ventana ────────────────────────────────────────────

test('R4 — un bloque largo produce UN hallazgo con su extensión real', () => {
  const largo = Array.from({ length: 20 }, (_, i) => `const v${i} = calcular(${i});`);
  const found = dup([file('src/a.ts', largo), file('src/b.ts', largo)]);

  assert.equal(found.length, 1, 'no puede emitir una fila por cada ventana solapada');
  assert.equal(found[0].lines, 20);
});

test('R4 — dos bloques duplicados distintos son dos hallazgos', () => {
  const otro = Array.from({ length: 7 }, (_, i) => `registrar(evento${i});`);
  const found = dup([
    file('src/a.ts', [...BLOQUE, 'const corte = 1;', ...otro]),
    file('src/b.ts', [...BLOQUE, 'const distinto = 2;', ...otro])
  ]);

  assert.equal(found.length, 2);
});

// ── T5: más de dos copias ─────────────────────────────────────────────────────────────────────

test('R1 — con tres copias se reporta el bloque sin repetir el mismo par', () => {
  const found = dup([file('src/a.ts', BLOQUE), file('src/b.ts', BLOQUE), file('src/c.ts', BLOQUE)]);

  const pares = found.map((d) => [d.a.file, d.b.file].sort().join('|'));
  assert.equal(new Set(pares).size, pares.length, `hay pares repetidos: ${pares}`);
  assert.ok(found.length >= 1 && found.length <= 3);
});

// ── T7: lo que NO debe disparar ───────────────────────────────────────────────────────────────

test('R3 — cinco imports iguales en dos archivos no son duplicación', () => {
  const cabecera = [
    "import { Component } from '@angular/core';",
    "import { CommonModule } from '@angular/common';",
    "import { FormsModule } from '@angular/forms';",
    "import { Router } from '@angular/router';",
    "import { Store } from '@ngrx/store';",
    '}'
  ];

  assert.deepEqual(dup([file('src/a.ts', cabecera), file('src/b.ts', cabecera)]), []);
});

test('R1 — un bloque de una línea significativa menos que el mínimo no dispara', () => {
  // `BLOQUE.slice(0, 6)` son 6 líneas de archivo pero solo 5 significativas: el `}` de la 4 no cuenta.
  const cinco = BLOQUE.slice(0, 6);
  const seis = BLOQUE.slice(0, 7);

  assert.deepEqual(dup([file('src/a.ts', cinco), file('src/b.ts', cinco)]), [], 'cinco significativas: no');
  assert.equal(dup([file('src/a.ts', seis), file('src/b.ts', seis)]).length, 1, 'seis significativas: sí');
});

test('R2 — dos bloques que difieren en el TEXTO de sus literales NO son el mismo bloque', () => {
  // Corregido tras correr la etapa sobre un repo real. Vaciar las cadenas hacía idénticos los marcos
  // `es` y `en` de cualquier tabla bilingüe —misma estructura, distinto texto— y la etapa reportaba
  // cada uno como duplicación. En un repo con tablas de mensajes en paralelo eso es ruido constante,
  // y un linter que se equivoca se apaga. Cazar la copia-con-mensajes-cambiados no lo compensa.
  const conOtroMensaje = BLOQUE.map((l) => l.replace('el monto debe ser positivo', 'monto inválido'));

  assert.deepEqual(dup([file('src/a.ts', BLOQUE), file('src/b.ts', conOtroMensaje)]), []);
});

test('R2 — dos tablas bilingües con la misma forma y distinto texto no son duplicación', () => {
  const tabla = (idioma, textos) => [
    `const ${idioma} = {`,
    `  titulo: '${textos[0]}',`,
    `  rama: '${textos[1]}',`,
    `  rol: '${textos[2]}',`,
    `  spec: '${textos[3]}',`,
    `  fecha: '${textos[4]}',`,
    `  estado: '${textos[5]}'`,
    '};'
  ];

  const es = tabla('ES', ['Portón', 'Rama', 'Repo', 'Spec', 'Fecha', 'Estado']);
  const en = tabla('EN', ['Gate', 'Branch', 'Repo', 'Spec', 'Date', 'Status']);

  assert.deepEqual(dup([file('src/i18n.ts', [...es, ...en])]), []);
});

test('R1 — dos DTOs con los mismos campos no son un bloque duplicado de código', () => {
  // Declarar los mismos campos en dos tipos distintos es normal y no se arregla extrayendo nada.
  const dto = (nombre) => [
    `export interface ${nombre} {`,
    '  id: string;',
    '  nombre: string;',
    '  creadoEn: Date;',
    '  activo: boolean;',
    '}'
  ];

  assert.deepEqual(dup([file('src/a.ts', dto('Usuario')), file('src/b.ts', dto('Cuenta'))]), [],
    'la primera línea difiere, así que el bloque no llega al mínimo');
});

test('R1 — dos archivos sin nada en común no producen hallazgos', () => {
  assert.deepEqual(dup([file('src/a.ts', BLOQUE), file('src/b.ts', ['const z = 9;', 'hacerOtraCosa();'])]), []);
});

test('R7 — subir el mínimo apaga los bloques cortos', () => {
  assert.equal(dup([file('src/a.ts', BLOQUE), file('src/b.ts', BLOQUE)]).length, 1);
  assert.deepEqual(dup([file('src/a.ts', BLOQUE), file('src/b.ts', BLOQUE)], { minLines: 12 }), []);
});

test('R1 — sin archivos, sin hallazgos y sin excepción', () => {
  assert.deepEqual(dup([]), []);
  assert.deepEqual(dup([file('src/a.ts', [])]), []);
});

// ── huecos que destapó la pasada de mutación ──────────────────────────────────────────────────

test('R1 — una línea repetida muchas veces seguidas NO es un bloque copiado', () => {
  // Ocho líneas idénticas consecutivas producen ventanas que se solapan entre sí. Sin descartar el
  // solape, el detector se reportaría a sí mismo: no hay dos copias, hay una línea repetida.
  const repetida = Array.from({ length: 8 }, () => 'acumulador += 1;');

  assert.deepEqual(dup([file('src/a.ts', repetida)]), []);
});

test('R1 — una línea repetida no se convierte en bloque por repetirse muchas veces', () => {
  // Escrito primero al revés («doce sí deberían contar, porque las ventanas 0 y 6 no se solapan»), y
  // corregido al ver el resultado: eso no es un bloque copiado, es UNA línea repetida, y se arregla
  // con un bucle, no extrayendo una abstracción. Reportarlo como «12 líneas idénticas a a.ts:1»
  // mandaría al lector a las mismas líneas que está mirando.
  for (const veces of [8, 12, 30]) {
    const repetida = Array.from({ length: veces }, () => 'acumulador += 1;');
    assert.deepEqual(dup([file('src/a.ts', repetida)]), [], `${veces} repeticiones no son un bloque`);
  }
});

test('R1 — pero dos bloques DISTINTOS repetidos sí, aunque estén pegados', () => {
  const bloque = ['const a = leer();', 'const b = a * 2;', 'validar(b);', 'guardar(b);', 'notificar(b);', 'return b;'];

  assert.equal(dup([file('src/a.ts', [...bloque, ...bloque])]).length, 1);
});

test('R2 — la línea reportada es la del ARCHIVO, no el índice entre las significativas', () => {
  // Con comentarios y blancos delante, el índice interno y el número de línea se separan. Reportar
  // el índice mandaría al lector a una línea que no tiene nada que ver.
  const conRuido = ['// cabecera', '', '/* bloque', '   de notas */', '', ...BLOQUE];
  const [d] = dup([file('src/a.ts', conRuido), file('src/b.ts', BLOQUE)]);

  const a = [d.a, d.b].find((x) => x.file === 'src/a.ts');
  assert.equal(a.line, 6, 'el bloque empieza en la línea 6 del archivo, no en la 1');
});

// ── ruido de gramática de otros stacks ────────────────────────────────────────────────────────
//
// El `import` de TS ya no contaba. El `using` de C# y el `from … import` de Python sí, y son lo
// mismo: cabeceras que se repiten idénticas en cada archivo hermano porque el lenguaje obliga, no
// porque nadie copiara nada. En una suite de pruebas del mismo servicio salían como bloques
// duplicados de once líneas, y no hay forma de "arreglarlos".

test('significantLines ignores a C# using block', async () => {
  const código = significantLines([
    'using System.Net.Http;',
    'using FluentAssertions;',
    'using Moq;',
    'var total = 1;'
  ].join('\n'));

  assert.deepEqual(código.map((l) => l.code), ['var total = 1;']);
});

// `using (var x = …)` NO es una cabecera: es un bloque con cuerpo, y ahí sí puede haber copia.
test('significantLines keeps a C# using resource block', async () => {
  const código = significantLines('using (var cliente = new HttpClient())\n');

  assert.deepEqual(código.map((l) => l.code), ['using (var cliente = new HttpClient())']);
});

test('significantLines ignores a Python from-import block', async () => {
  const código = significantLines([
    'from decimal import Decimal',
    'from carrito.total import calcular',
    'total = 1'
  ].join('\n'));

  assert.deepEqual(código.map((l) => l.code), ['total = 1']);
});

test('significantLines ignores a package declaration', async () => {
  const código = significantLines('package com.xm.sicep.carrito;\nint total = 1;');

  assert.deepEqual(código.map((l) => l.code), ['int total = 1;']);
});
