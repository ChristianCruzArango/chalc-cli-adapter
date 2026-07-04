import test from 'node:test';
import assert from 'node:assert/strict';
import { c, stripAnsi, box, banner, contextBox, stepLine, resultLine, summarizeObservation, mutationReport } from '../cli/ui/render.mjs';
import { createSpinner } from '../cli/ui/spinner.mjs';
import { createScreen, wrapAnsi, matchSlash, wheelDelta } from '../cli/ui/screen.mjs';

// En los tests stdout no es TTY → sin color: la salida es texto plano y determinista.

test('box: todas las líneas quedan alineadas al mismo ancho', () => {
  const lines = box(['corto', 'una línea bastante más larga']).split('\n');
  const widths = new Set(lines.map((l) => stripAnsi(l).length));
  assert.equal(widths.size, 1, 'bordes y cuerpo con el mismo ancho');
  assert.ok(lines[0].startsWith('╭') && lines.at(-1).startsWith('╰'));
});

test('banner colapsa las skills a un CONTEO (no vuelca los 19 nombres)', () => {
  const project = {
    equipped: true, stacks: ['angular'],
    detected: { skills: Array.from({ length: 19 }, (_, i) => `s${i}`), mcpServers: ['angular-cli'] },
    git: { isRepo: true, branch: 'develop', clean: true }
  };
  const out = banner({ model: 'qwen', provider: 'ollama', projectPath: '/p', project });
  assert.match(out, /19 skills/);
  assert.doesNotMatch(out, /s0, s1, s2/);        // no el volcado
  assert.match(out, /MCP: angular-cli/);
  assert.match(out, /git develop/);
  assert.match(out, /Angular/);                  // el stack se muestra con su marca, no en minúscula
  assert.doesNotMatch(out, /angular ·/);
});

test('contextBox muestra la ventana (tokens/num_ctx) y formatea miles con k', () => {
  const out = contextBox({ model: 'qwen', provider: 'ollama', inputTokens: 3120, numCtx: 16384, steps: 3 });
  assert.match(out, /contexto/);
  assert.match(out, /3\.1k\/16\.4k/);
  assert.match(out, /pasos/);
});

test('stepLine y resultLine reflejan error/éxito', () => {
  assert.match(stepLine({ action: { tool: 'read' }, observation: { error: 'no existe' } }), /no existe/);
  assert.match(stepLine({ action: { tool: 'read' }, observation: { content: 'x' } }), /read/);
  assert.match(resultLine({ done: true, summary: 'listo' }), /✔ listo/);
  assert.match(resultLine({ done: false, error: 'falló' }), /✗ falló/);
});

test('summarizeObservation humaniza cada tool (nunca JSON crudo con escapes)', () => {
  assert.equal(summarizeObservation({ tool: 'write' }, { path: 'a.ts', bytes: 261, ok: true }).text, 'a.ts escrito (261 bytes)');
  assert.equal(summarizeObservation({ tool: 'write' }, { path: 'a.ts', bytes: 10, appended: true, ok: true }).text, 'a.ts ampliado (10 bytes)');
  assert.equal(summarizeObservation({ tool: 'read' }, { path: 'a.ts', content: 'x\ny\nz' }).text, 'a.ts leído (3 líneas)');
  assert.equal(summarizeObservation({ tool: 'list' }, { path: 'src', entries: [1, 2] }).text, '2 entradas en src');
  assert.equal(summarizeObservation({ tool: 'grep' }, { matches: [1, 2, 3] }).text, '3 coincidencia(s)');
  assert.match(summarizeObservation({ tool: 'bash' }, { code: 0, stdout: 'v20.1.0\n' }).text, /exit 0 · v20\.1\.0/);
  const to = summarizeObservation({ tool: 'bash' }, { code: -1, timedOut: true });
  assert.equal(to.error, true);
  assert.match(to.text, /timeout/);
  assert.match(summarizeObservation({ tool: 'x' }, { repeated: true, note: '...' }).text, /repetida/);
  const err = summarizeObservation({ tool: 'write' }, { error: 'no aprobada' });
  assert.equal(err.error, true);
});

test('mutationReport reporta SOLO lo confirmado por observaciones (detector de alucinación)', () => {
  // Turno donde el modelo dijo done pero nada tuvo éxito → mutated:false (dispara la advertencia)
  const nada = mutationReport([
    { action: { tool: 'mcp__x__list_projects' }, observation: { text: 'ok' } },          // lectura MCP: no muta
    { action: { tool: 'bash' }, observation: { command: 'ng g', error: 'metacaracteres' } },
    { action: { tool: 'write' }, observation: { path: 'a.ts', error: 'no aprobada' } }
  ]);
  assert.equal(nada.mutated, false);
  assert.deepEqual(nada.files, []);

  // Turno con trabajo real → lista los archivos y comandos confirmados
  const real = mutationReport([
    { action: { tool: 'write' }, observation: { path: 'src/u.ts', bytes: 10, ok: true } },
    { action: { tool: 'bash' }, observation: { command: 'ng g c users', code: 0, stdout: 'CREATE …' } },
    { action: { tool: 'mcp__x__generate' }, observation: { text: 'hecho' } }
  ]);
  assert.equal(real.mutated, true);
  assert.deepEqual(real.files, ['src/u.ts']);
  assert.equal(real.commands, 1);
  assert.equal(real.mcpMutations, 1);
});

test('summarizeObservation muestra el comando/ruta que causó un error (no solo el mensaje)', () => {
  const s = summarizeObservation({ tool: 'bash' }, { command: 'ng g c users && ng serve', error: 'metacaracteres de shell no permitidos' });
  assert.match(s.text, /ng g c users && ng serve/);
  assert.match(s.text, /metacaracteres/);
  const p = summarizeObservation({ tool: 'read' }, { path: 'nope.ts', error: 'no existe' });
  assert.match(p.text, /nope\.ts → no existe/);
});

test('summarizeObservation extrae el preview legible de un placeholder CCR (MCP)', () => {
  const ccr = '[CCR ref=c1 type="text" chars=1935 preview="You are an expert in TypeScript, Angular"]';
  const s = summarizeObservation({ tool: 'mcp__x__get_doc' }, { text: ccr });
  assert.match(s.text, /You are an expert in TypeScript/);
  assert.doesNotMatch(s.text, /CCR ref=/);   // sin el envoltorio feo
  assert.doesNotMatch(s.text, /\\"/);        // sin escapes
});

test('createScreen expone la API de la TUI (open/print/setOnLine/close/thinking)', () => {
  const s = createScreen({ header: ['chalc cli'] });
  for (const m of ['open', 'print', 'setOnLine', 'close', 'startThinking', 'stopThinking']) {
    assert.equal(typeof s[m], 'function', `falta ${m}`);
  }
});

test('las auto-correcciones del loop se muestran humanas y tenues (sin jerga del protocolo)', () => {
  // herramienta desconocida: el texto largo es para el MODELO; el usuario ve una línea entendible
  const unk = summarizeObservation({ tool: 'write' }, { error: 'unknown tool: write. You are in a READ-ONLY role: do NOT execute changes; explore with read/list/grep and deliver your result with {"done":true,"summary":"..."}' });
  assert.equal(unk.correction, true);
  assert.match(unk.text, /no existe aquí \(write\)/);
  assert.doesNotMatch(unk.text, /READ-ONLY|done|summary/);   // nada de jerga del protocolo

  // error de argumentos MCP (trae hint): también se humaniza
  const args = summarizeObservation({ tool: 'mcp__ng__search_documentation' }, { error: 'MCP error -32602: Invalid arguments', hint: 'usa describe…' });
  assert.equal(args.correction, true);
  assert.match(args.text, /argumentos incorrectos/);

  // stepLine: sin nombre de tool en azul ni rojo de error — solo la línea tenue con ⟳
  const line = stepLine({ action: { tool: 'write' }, observation: { error: 'unknown tool: write. …' } });
  assert.match(line, /⟳/);
  assert.doesNotMatch(line, /→/);

  // un error REAL (no corrección) se sigue mostrando como error
  const real = summarizeObservation({ tool: 'read' }, { error: 'no existe', path: 'x.ts' });
  assert.equal(real.error, true);
});

test('matchSlash sugiere comandos al teclear "/" y filtra por prefijo', () => {
  const cmds = [{ cmd: '/plan', desc: 'p' }, { cmd: '/review', desc: 'r' }, { cmd: '/model', desc: 'm' }];
  assert.equal(matchSlash(cmds, 'hola').length, 0);            // texto normal: sin sugerencias
  assert.equal(matchSlash(cmds, '/').length, 3);               // "/" solo: todas
  assert.deepEqual(matchSlash(cmds, '/p').map((c) => c.cmd), ['/plan']);
  assert.deepEqual(matchSlash(cmds, '/plan crea x').map((c) => c.cmd), ['/plan']);   // con argumentos sigue
  assert.equal(matchSlash(cmds, '/zz').length, 0);             // comando inexistente: nada que sugerir
});

test('wheelDelta: la rueda del mouse controla el modo lectura; clicks y texto normal no', () => {
  assert.equal(wheelDelta('\x1b[<64;10;5M'), 3);                       // rueda arriba → hacia el inicio
  assert.equal(wheelDelta('\x1b[<65;10;5M'), -3);                      // rueda abajo → hacia el final
  assert.equal(wheelDelta('\x1b[<64;1;1M\x1b[<64;1;1M'), 6);           // dos muescas en un mismo chunk
  assert.equal(wheelDelta('\x1b[<0;10;5M'), 0);                        // click: chunk de mouse, sin scroll
  assert.equal(wheelDelta('\x1b[<0;10;5m'), 0);                        // soltar el botón: igual, se ignora
  assert.equal(wheelDelta('hola'), null);                              // texto normal: sigue al editor
  assert.equal(wheelDelta('\x1b[5~'), null);                           // PgUp: no es mouse, sigue su vía
});

test('wrapAnsi envuelve al ancho visible sin contar los códigos de color', () => {
  assert.deepEqual(wrapAnsi('corta', 10), ['corta']);
  assert.deepEqual(wrapAnsi('1234567890AB', 10), ['1234567890', 'AB']);
  // 10 chars visibles + códigos ANSI: sigue siendo UNA fila (los escapes no cuentan)
  const colored = '\x1b[36m1234567890\x1b[0m';
  assert.deepEqual(wrapAnsi(colored, 10), [colored]);
  // un error JSON largo (el caso real del scroll) se parte en varias filas sin perder contenido
  const rows = wrapAnsi('x'.repeat(35), 10);
  assert.equal(rows.length, 4);
  assert.equal(rows.join(''), 'x'.repeat(35));
});

test('createSpinner es no-op seguro fuera de TTY (start/stop no lanzan ni escriben)', () => {
  const writes = [];
  const fakeStream = { isTTY: false, write: (s) => writes.push(s) };
  const sp = createSpinner(fakeStream);
  assert.doesNotThrow(() => { sp.start('x'); sp.update('y'); sp.stop(); });
  assert.equal(writes.length, 0);   // sin TTY no pinta nada (salida por pipe limpia)
});
