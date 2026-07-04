import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFsTools, resolveInRoot } from '../cli/tools/fs.mjs';
import { createShellTool } from '../cli/tools/shell.mjs';
import { createTools } from '../cli/tools/registry.mjs';

async function makeRoot(files = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-cli-tools-'));
  for (const [rel, content] of Object.entries(files)) {
    const full = join(dir, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, content);
  }
  return dir;
}

test('resolveInRoot confina rutas y rechaza el path traversal', () => {
  const root = join(tmpdir(), 'x');
  assert.equal(resolveInRoot(root, 'a/b.js'), join(root, 'a', 'b.js'));
  assert.throws(() => resolveInRoot(root, '../secreto'), /outside the project/);
  assert.throws(() => resolveInRoot(root, 'a/../../secreto'), /outside the project/);
});

test('resolveInRoot rechaza el escape por symlink/junction que apunta fuera del proyecto', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'chalc-cli-symroot-'));
  const outside = await mkdtemp(join(tmpdir(), 'chalc-cli-symout-'));
  try {
    await writeFile(join(outside, 'secreto.txt'), 'secreto');
    try {
      // junction en Windows (no requiere privilegios); symlink de directorio en POSIX
      await symlink(outside, join(root, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
    } catch {
      t.skip('el SO no permite crear symlinks/junctions aquí');
      return;
    }
    assert.throws(() => resolveInRoot(root, 'link/secreto.txt'), /symlink/);
    // y la tool rechaza (el loop convierte ese throw en observación de error), sin leer el archivo externo
    const { read } = createFsTools({ root });
    await assert.rejects(() => read.run({ path: 'link/secreto.txt' }), /symlink/);
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('read devuelve el contenido; error legible si no existe; directorio se auto-lista', async () => {
  const root = await makeRoot({ 'a.js': 'hola' });
  try {
    const { read } = createFsTools({ root });
    assert.equal((await read.run({ path: 'a.js' })).content, 'hola');
    assert.match((await read.run({ path: 'nope.js' })).error, /does not exist/);
    const dir = await read.run({ path: '.' });
    assert.match(dir.note, /directory/);   // ya no es error: se auto-delega a list
    assert.ok(Array.isArray(dir.entries));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('read rechaza rutas fuera del proyecto (el throw lo captura el loop)', async () => {
  const root = await makeRoot({ 'a.js': 'x' });
  try {
    const { read } = createFsTools({ root });
    await assert.rejects(() => read.run({ path: '../../etc/passwd' }), /outside the project/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('list omite directorios ruidosos (node_modules, .git)', async () => {
  const root = await makeRoot({ 'src/a.js': 'x', 'node_modules/dep/i.js': 'x', 'README.md': 'x' });
  try {
    const { list } = createFsTools({ root });
    const names = (await list.run({})).entries.map((e) => e.name).sort();
    assert.deepEqual(names, ['README.md', 'src']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('grep encuentra coincidencias con archivo, línea y texto', async () => {
  const root = await makeRoot({ 'src/a.js': 'const x = 1;\nTODO: arreglar\n', 'src/b.js': 'sin nada' });
  try {
    const { grep } = createFsTools({ root });
    const r = await grep.run({ pattern: 'TODO' });
    assert.equal(r.matches.length, 1);
    assert.equal(r.matches[0].line, 2);
    assert.match(r.matches[0].file, /a\.js$/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('grep reporta regex inválida sin lanzar', async () => {
  const root = await makeRoot({ 'a.js': 'x' });
  try {
    assert.match((await createFsTools({ root }).grep.run({ pattern: '(' })).error, /invalid regex/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('write crea el archivo solo con aprobación', async () => {
  const root = await makeRoot();
  try {
    const denied = createFsTools({ root, approve: async () => false });
    assert.match((await denied.write.run({ path: 'x.txt', content: 'hola' })).error, /not approved/);
    const allowed = createFsTools({ root, approve: async () => true });
    assert.equal((await allowed.write.run({ path: 'sub/x.txt', content: 'hola' })).ok, true);
    assert.equal(await readFile(join(root, 'sub', 'x.txt'), 'utf8'), 'hola');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('write con append:true agrega al final sin sobrescribir (escritura por partes)', async () => {
  const root = await makeRoot();
  try {
    const { write } = createFsTools({ root, approve: async () => true });
    assert.equal((await write.run({ path: 'largo.md', content: 'parte 1\n' })).ok, true);
    const r2 = await write.run({ path: 'largo.md', content: 'parte 2\n', append: true });
    assert.equal(r2.ok, true);
    assert.equal(r2.appended, true);
    const r3 = await write.run({ path: 'largo.md', content: 'parte 3\n', append: 'true' });   // string "true" también vale
    assert.equal(r3.appended, true);
    assert.equal(await readFile(join(root, 'largo.md'), 'utf8'), 'parte 1\nparte 2\nparte 3\n');
    // append sobre archivo inexistente lo crea (no falla a mitad de una escritura por partes)
    assert.equal((await write.run({ path: 'nuevo.md', content: 'x', append: true })).ok, true);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('write exige path y tolera sinónimos de argumentos (file/filename, text/body)', async () => {
  const root = await makeRoot();
  try {
    const t = createFsTools({ root, approve: async () => true });
    assert.match((await t.write.run({ content: 'x' })).error, /missing "path"/);   // sin ruta: error claro, no "undefined"
    assert.equal((await t.write.run({ file: 'a.txt', text: 'hola' })).ok, true);  // acepta file + text
    assert.equal(await readFile(join(root, 'a.txt'), 'utf8'), 'hola');
    assert.equal((await t.read.run({ filename: 'a.txt' })).content, 'hola');       // read acepta filename
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('edit reemplaza una coincidencia única y exige unicidad', async () => {
  const root = await makeRoot({ 'a.js': 'let a = 1;\nlet b = 1;\n' });
  try {
    const { edit } = createFsTools({ root, approve: async () => true });
    assert.match((await edit.run({ path: 'a.js', old: 'let ', new: 'const ' })).error, /appears 2 times/);
    assert.match((await edit.run({ path: 'a.js', old: 'nope', new: 'x' })).error, /was not found/);
    assert.equal((await edit.run({ path: 'a.js', old: 'let a = 1;', new: 'const a = 2;' })).ok, true);
    assert.match(await readFile(join(root, 'a.js'), 'utf8'), /const a = 2;/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bash aplica allowlist, prohíbe metacaracteres y exige aprobación', async () => {
  const root = await makeRoot();
  try {
    const { bash } = createShellTool({ root, allow: ['node'], approve: async () => true });
    assert.match((await bash.run({ command: 'git status' })).error, /not allowed: git/);
    assert.match((await bash.run({ command: 'node -e "x" ; rm -rf /' })).error, /metacharacters/);
    const denied = createShellTool({ root, allow: ['node'], approve: async () => false });
    assert.match((await denied.bash.run({ command: 'node -v' })).error, /not approved/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bash ejecuta un comando permitido y captura la salida', async () => {
  const root = await makeRoot({ 'suma.mjs': 'process.stdout.write(String(2+3));' });
  try {
    const { bash } = createShellTool({ root, allow: ['node'], approve: async () => true });
    const r = await bash.run({ command: 'node suma.mjs' });
    assert.equal(r.code, 0);
    assert.equal(r.stdout, '5');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bash bloquea flags de evaluación inline (node -e, python -c, git -c)', async () => {
  const root = await makeRoot();
  try {
    const { bash } = createShellTool({ root, allow: ['node', 'python', 'git'], approve: async () => true });
    assert.match((await bash.run({ command: 'node -e "malicia()"' })).error, /flag not allowed for node: -e/);
    assert.match((await bash.run({ command: 'node --eval x' })).error, /flag not allowed/);
    assert.match((await bash.run({ command: 'python -c "import os"' })).error, /flag not allowed for python: -c/);
    assert.match((await bash.run({ command: 'git -c core.fsmonitor=calc status' })).error, /flag not allowed for git: -c/);
    // el uso normal de los mismos comandos sigue permitido (no bloquea de más)
    assert.equal((await bash.run({ command: 'node --version' })).code, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bash aplica timeout y lo reporta como timedOut sin colgar el turno', async () => {
  const root = await makeRoot({ 'espera.mjs': 'setInterval(function(){}, 1000);' });
  try {
    const { bash } = createShellTool({ root, allow: ['node'], approve: async () => true, timeoutMs: 500 });
    const r = await bash.run({ command: 'node espera.mjs' });
    assert.equal(r.timedOut, true);
    assert.notEqual(r.code, 0);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('bash corre en entorno NO interactivo (CI=true) para que los CLIs no se cuelguen preguntando', async () => {
  const root = await makeRoot({ 'env.mjs': 'process.stdout.write(String(process.env.CI) + " " + String(process.env.NG_CLI_ANALYTICS));' });
  try {
    const { bash } = createShellTool({ root, allow: ['node'], approve: async () => true });
    const r = await bash.run({ command: 'node env.mjs' });
    assert.equal(r.stdout, 'true false');
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('createTools exige root y ensambla fs + shell', async () => {
  assert.throws(() => createTools({}), /requiere root/);
  const root = await makeRoot();
  try {
    const tools = createTools({ root, allow: [] });
    assert.deepEqual(Object.keys(tools).sort(), ['bash', 'edit', 'grep', 'list', 'read', 'write']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ——— Referencias locales fantasma: el write/edit avisa cuando el código apunta a archivos inexistentes ———

test('write de un componente con templateUrl/styleUrls inexistentes lleva hint con las referencias', async () => {
  const root = await makeRoot({});
  try {
    const { write } = createFsTools({ root });
    const r = await write.run({
      path: 'src/app/user-list.component.ts',
      content: "@Component({ templateUrl: './user-list.component.html', styleUrls: ['./user-list.component.css'] }) export class X {}"
    });
    assert.equal(r.ok, true);                                   // el write NO se bloquea: solo se avisa
    assert.match(r.hint, /do NOT exist/);
    assert.match(r.hint, /user-list\.component\.html/);
    assert.match(r.hint, /user-list\.component\.css/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('write sin referencias rotas NO lleva hint (imports relativos resueltos como TS)', async () => {
  const root = await makeRoot({
    'src/app/user.model.ts': 'export interface User {}',
    'src/app/user.component.html': '<p></p>'
  });
  try {
    const { write } = createFsTools({ root });
    const r = await write.run({
      path: 'src/app/user.component.ts',
      content: "import { User } from './user.model';\n@Component({ templateUrl: './user.component.html' }) export class X {}"
    });
    assert.equal(r.ok, true);
    assert.equal(r.hint, undefined);                            // './user.model' resolvió a user.model.ts
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('write con lazy route import() hacia un módulo inexistente lleva hint (el caso users.module)', async () => {
  const root = await makeRoot({});
  try {
    const { write } = createFsTools({ root });
    const r = await write.run({
      path: 'src/app/app.routes.ts',
      content: "export const routes = [{ path: 'users', loadChildren: () => import('./features/users/users.module').then(m => m.UsersModule) }];"
    });
    assert.match(r.hint, /users\.module/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('edit que introduce una referencia rota también avisa; los no-código no se analizan', async () => {
  const root = await makeRoot({ 'src/a.ts': "const x = 1;\n", 'notas.md': "ver './algo.css'" });
  try {
    const { write, edit } = createFsTools({ root });
    const r = await edit.run({ path: 'src/a.ts', old: 'const x = 1;', new: "import { b } from './b';\nconst x = 1;" });
    assert.equal(r.ok, true);
    assert.match(r.hint, /\.\/b/);
    const md = await write.run({ path: 'notas.md', content: "referencia falsa './nada.css'" });
    assert.equal(md.hint, undefined);                           // .md no es código: sin análisis
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('read sobre un directorio se auto-delega a list (los modelos chicos lo piden en bucle)', async () => {
  const root = await makeRoot({ 'src/app/a.ts': 'x', 'src/app/sub/b.ts': 'y' });
  try {
    const { read } = createFsTools({ root });
    const r = await read.run({ path: 'src/app' });
    assert.equal(r.error, undefined);
    assert.match(r.note, /directory/);
    assert.deepEqual(r.entries.map((e) => e.name).sort(), ['a.ts', 'sub']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('write de código truncado (llaves sin balancear) avisa en el hint; el CSS con llaves válidas no', async () => {
  const root = await makeRoot({});
  try {
    const { write } = createFsTools({ root });
    const cut = await write.run({ path: 'src/a.component.ts', content: 'export class A {\n  metodo() {\n    return 1;\n  }\n' });   // falta la } de la clase
    assert.equal(cut.ok, true);
    assert.match(cut.hint, /INCOMPLETE/);
    assert.match(cut.hint, /1 unclosed/);
    const full = await write.run({ path: 'src/b.ts', content: 'export class B {\n  metodo() { return 1; }\n}\n' });
    assert.equal(full.hint, undefined);
    const css = await write.run({ path: 'src/a.css', content: 'table { width: 100% }' });   // .css no es CODE_EXT: sin análisis
    assert.equal(css.hint, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('append que completa el archivo apaga el aviso de truncamiento', async () => {
  const root = await makeRoot({});
  try {
    const { write } = createFsTools({ root });
    await write.run({ path: 'src/c.ts', content: 'export class C {\n' });
    const done = await write.run({ path: 'src/c.ts', content: '}\n', append: true });
    assert.equal(done.hint, undefined);   // el archivo COMPLETO quedó balanceado
  } finally { await rm(root, { recursive: true, force: true }); }
});

// ——— Guardián de ubicación: el path de un write no miente aunque el modelo olvide la arquitectura ———
test('placementNote avisa fuera del Folder map y calla donde no gobierna', async () => {
  const { placementNote } = await import('../cli/tools/fs.mjs');
  const roots = ['src/app/core', 'src/app/shared', 'src/app/features'];
  // el caso real: src/app/users en vez de src/app/features/users
  assert.match(placementNote('src/app/users/users.ts', roots), /OUTSIDE the architecture folder map/);
  assert.equal(placementNote('src/app/features/users/users.ts', roots), null);   // root mapeado: correcto
  assert.equal(placementNote('src/app/app.routes.ts', roots), null);             // directo en la base: permitido
  assert.equal(placementNote('src/main.ts', roots), null);                       // fuera del árbol: sin opinión
  assert.equal(placementNote('docs/notas.ts', roots), null);
  assert.equal(placementNote('src/app/users/x.ts', []), null);                   // sin mapa: sin guardián
});

test('write fuera del Folder map lleva el aviso en el hint', async () => {
  const root = await makeRoot({});
  try {
    const { write } = createFsTools({ root, layoutRoots: ['src/app/features', 'src/app/core'] });
    const bad = await write.run({ path: 'src/app/users/users.ts', content: 'export class Users {}\n' });
    assert.equal(bad.ok, true);
    assert.match(bad.hint, /OUTSIDE the architecture folder map/);
    const good = await write.run({ path: 'src/app/features/users/users.ts', content: 'export class Users {}\n' });
    assert.equal(good.hint, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('candado anti-borrado: write vacío sobre archivo con contenido se RECHAZA; encogimiento drástico avisa', async () => {
  const dir = await makeRoot({ 'src/comp.ts': 'export class Comp { /* 500 bytes de lógica */ '.padEnd(500, 'x') + '}' });
  try {
    const tools = createFsTools({ root: dir });
    // write con content vacío (el campo olvidado / salida truncada) sobre archivo existente → error, disco intacto
    const r1 = await tools.write.run({ path: 'src/comp.ts', content: '' });
    assert.match(r1.error, /EMPTY content .* would DESTROY/);
    assert.equal((await readFile(join(dir, 'src/comp.ts'), 'utf8')).length > 400, true);
    // write vacío sobre archivo NUEVO sí se permite (crear un placeholder vacío es legítimo)
    const r2 = await tools.write.run({ path: 'src/nuevo.ts', content: '' });
    assert.equal(r2.ok, true);
    // encogimiento drástico (<25% del tamaño anterior) → se ejecuta pero con aviso SHRANK
    const r3 = await tools.write.run({ path: 'src/comp.ts', content: 'export class Comp {}' });
    assert.equal(r3.ok, true);
    assert.match(r3.hint, /SHRANK .* from \d+ to \d+ bytes/);
    // un write de tamaño razonable no lleva el aviso
    const r4 = await tools.write.run({ path: 'src/comp.ts', content: 'y'.repeat(450) });
    assert.ok(!r4.hint || !/SHRANK/.test(r4.hint));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
