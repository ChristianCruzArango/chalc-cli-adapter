// T25 (R6) — el alcance de la revisión.
//
// Acotar a lo cambiado es lo que hace usable al portón. Pero un repo sin git no puede convertirse en
// "no hay nada que revisar": eso sería un aprobado silencioso, que es exactamente lo que esta spec
// viene a quitar. Sin git se revisa el árbol de fuentes.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { changedFiles } from '../catalog/gate/lib/changed.mjs';

async function project(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-gate-changed-'));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    await mkdir(dirname(abs), { recursive: true });
    await writeFile(abs, content, 'utf8');
  }
  return dir;
}

// Un repo git de verdad: hace falta para ejercitar la ruta de `git status`, que es distinta del
// recorrido de respaldo y tiene sus propias reglas de exclusión.
const init = (dir) => new Promise((resolve) => {
  spawn('git', ['init', '-q', '.'], { cwd: dir, stdio: 'ignore' }).on('close', resolve).on('error', resolve);
});

// Encontrado corriendo el advisor de la spec 008 en un repo de verdad: `git status --porcelain`
// lista lo NO trackeado, y `.chalc/` lo está — así que la evidencia que el portón acaba de escribir
// aparecía como "archivo cambiado", y siempre con fecha posterior a sí misma. El advisor concluía
// que había trabajo sin medir después de cada corrida y pedía `run_gate` para siempre.
//
// La ruta sin git ya saltaba `.chalc` en SKIP_DIRS; la de git no. Es la misma regla: la carpeta de
// artefactos de chalc no es código del usuario, y medirla contra sí misma no significa nada.
test('changedFiles never reports chalc own artifacts as changed source', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    '.chalc/gate.md': '# evidencia\n',
    '.chalc/gate.state.json': '{"verdict":"pass"}\n',
    '.chalc/next/lib/decide.mjs': 'export const decide = () => 1;\n'
  });
  await init(dir);

  const files = await changedFiles(dir);

  assert.ok(files.includes('src/precio.ts'), 'el fuente del usuario sí entra');
  assert.deepEqual(files.filter((f) => f.startsWith('.chalc/')), [], 'nada de .chalc/ puede entrar');
});

// Encontrado recorriendo el ciclo del advisor en un repo real: marcar un checkbox en `tasks.md`
// convertía la spec en "archivo cambiado" e invalidaba la evidencia del portón — o sea, cerrar una
// tarea deshacía la medida que acababa de cerrarla.
//
// El recorrido SIN git ya filtraba por extensión de fuente; el de git devolvía todo. Con las dos
// rutas alineadas, documentación y specs dejan de contar como trabajo por medir.
test('changedFiles only reports source files, in git repos too', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    'specs/001-demo/tasks.md': '- [x] T1\n',
    'README.md': '# demo\n'
  });
  await init(dir);

  const files = await changedFiles(dir);

  assert.ok(files.includes('src/precio.ts'), 'el fuente del usuario sí entra');
  assert.ok(!files.includes('specs/001-demo/tasks.md'), 'marcar una tarea no es trabajo por medir');
  assert.ok(!files.includes('README.md'), 'la documentación tampoco');
});

// La spec 013 (R4b) cambió este comportamiento, y el test que había decía lo contrario: sin git,
// `changedFiles` devolvía el árbol de fuentes ENTERO. La intención era buena —devolver [] habría
// sido un aprobado silencioso—, pero el efecto era peor que el problema: el portón dejaba de medir
// una tarea y pasaba a medir el proyecto, con la deuda de años dentro, y el informe se volvía
// inservible. Revisar de más no es un grado de revisar: es otra cosa.
//
// Ahora la respuesta es "no sé". Quien decide qué hacer con ella es el portón, que bloquea la
// corrida y lo dice — ni aprueba, ni inventa un alcance.
//
// El recorrido del árbol no desaparece: lo sigue usando la etapa de duplicación para responder "esto
// ya existía", y sus reglas de exclusión se prueban ahora sobre `sourceFiles`, que es de quien son.
test('changedFiles reports nothing to review when it cannot tell what the task changed', async () => {
  const dir = await project({
    'src/precio.ts': 'export const p = 1;\n',
    'lib/pagina.dart': 'class X {}\n'
  });

  assert.deepEqual(await changedFiles(dir), []);
});
