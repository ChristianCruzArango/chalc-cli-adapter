// T6 (spec 017, R4) — la guarda no deja al asistente borrar fuera del proyecto.
//
// Un `rm -rf` mal resuelto es el error que no se deshace: un `$DIR` vacío convierte `rm -rf $DIR/build`
// en `rm -rf /build`, y un `cd ..` olvidado en la misma línea mueve el borrado a la carpeta de al lado.
// Dentro del proyecto el asistente borra con normalidad (dist, node_modules, temporales); lo que sale
// de él, o lo que no se puede saber adónde apunta, se bloquea.
//
// Las rutas se arman con `node:path` para que el test signifique lo mismo en Windows, donde corre CI.

import test from 'node:test';
import assert from 'node:assert/strict';
import { join, resolve } from 'node:path';
import { decide } from '../catalog/gate/lib/guard-rules.mjs';

const ROOT = resolve('/home/u/app');
// La raíz la da el hook (`CLAUDE_PROJECT_DIR`); el `cwd` del evento es dónde está la shell ahora.
// `~` no se expande: el portón no mira el HOME del usuario, así que todo `~` cuenta como no resuelto.
const PLACE = { root: ROOT };
// Una ruta dentro de un COMANDO va con '/', como la escribe una shell (Git Bash en Windows): `\` es un
// escape en bash, y `C:\tmp\x` llegaría como `C:tmpx`.
const sh = (path) => path.replace(/\\/g, '/');
const bash = (command, cwd = ROOT) => ({ tool_name: 'Bash', tool_input: { command }, cwd });
const verdict = (command, cwd) => decide(bash(command, cwd), PLACE);

test('R4: deleting outside the project is denied and names the target', () => {
  assert.deepEqual(verdict('rm -rf ../other'), { decision: 'deny', rule: 'delete-outside', data: { command: 'rm -rf ../other', target: '../other' } });
});

test('R4: the filesystem root, home and anything outside are denied', () => {
  for (const command of ['rm -rf /', 'rm -rf ~', 'rm -rf ~/', 'rm -rf ..', `rm -rf ${sh(resolve('/tmp/x'))}`, 'rmdir ../x', 'sudo rm -rf /', 'rm -rf ~/other']) {
    assert.equal(verdict(command).decision, 'deny', command);
  }
});

test('R4: a target with an unresolved variable or a substitution is denied', () => {
  for (const command of ['rm -rf $HOME', 'rm -rf "$DIR"/build', 'rm -rf ${BUILD}', 'rm -rf dist/$X', 'rm -rf $(pwd)/x', 'rm -rf `echo /`']) {
    assert.equal(verdict(command).rule, 'delete-outside', command);
  }
});

test('R4: the project root itself is not a delete inside the project', () => {
  assert.equal(verdict('rm -rf .').decision, 'deny');
  assert.equal(verdict(`rm -rf ${sh(ROOT)}`).decision, 'deny');
});

test('R4: deleting inside the project is allowed', () => {
  for (const command of ['rm -rf dist', 'rm build/a.js', 'rm -rf ./node_modules', `rm -rf ${sh(join(ROOT, 'dist'))}`, 'rm -rf *', 'rm', 'rm -rf -- dist']) {
    assert.equal(verdict(command).decision, 'allow', command);
  }
});

test('R4: find with -delete is judged by its start paths; without -delete it does not delete', () => {
  assert.equal(verdict('find .. -name x -delete').decision, 'deny');
  assert.equal(verdict(`find ${sh(resolve('/'))} -name x -delete`).decision, 'deny');
  assert.equal(verdict('find -delete', join(ROOT, 'src')).decision, 'allow');
  assert.equal(verdict('find . -name "*.tmp" -delete').decision, 'allow');
  assert.equal(verdict('find dist \\( -name a -o -name b \\) -delete').decision, 'allow');
  assert.equal(verdict('find .. "(" -name a ")" -delete').decision, 'deny');
  assert.equal(verdict('find .. -name x').decision, 'allow');
  assert.equal(verdict('find ./ -name x -delete').decision, 'allow');
  assert.equal(verdict(`find ${sh(ROOT)} -delete`).decision, 'deny');
  assert.equal(verdict('cd .. && find . -name x -delete').decision, 'deny');
});

test('R4: a cd earlier in the chain moves where the target resolves', () => {
  assert.equal(verdict('cd .. && rm -rf app').decision, 'deny');
  assert.equal(verdict(`cd ${sh(resolve('/tmp'))} && rm -rf x`).decision, 'deny');
  assert.equal(verdict('cd src && rm a.js').decision, 'allow');
  assert.equal(verdict('cd sub; cd ..; rm x').decision, 'allow');
});

test('R4: after a cd to an unknown place, every relative target counts as outside', () => {
  for (const command of ['cd $X && rm a', 'cd - && rm a', 'cd && rm a', 'cd ~/app/src && rm a']) {
    assert.equal(decide(bash(command), {}).decision, 'deny', command);
  }
});

test('R4: the shell may start in a subfolder of the project', () => {
  assert.equal(verdict('rm -rf ../lib', join(ROOT, 'src')).decision, 'allow');
  assert.equal(verdict('rm -rf ../../x', join(ROOT, 'src')).decision, 'deny');
});

test('R4: an explicit root wins over the cwd of the event; without it the cwd is the root', () => {
  assert.equal(decide(bash('rm -rf ../lib', join(ROOT, 'src')), { root: join(ROOT, 'src') }).decision, 'deny');
  assert.equal(decide(bash('rm -rf ../lib', join(ROOT, 'src')), {}).decision, 'deny');
  assert.equal(decide(bash('rm -rf lib', join(ROOT, 'src')), {}).decision, 'allow');
});

test('R4: without a known root only absolute, home, variable and .. targets are denied', () => {
  const unknown = (command) => decide({ tool_name: 'Bash', tool_input: { command } }).decision;
  assert.equal(unknown('rm -rf dist'), 'allow');
  for (const command of ['rm -rf /', 'rm -rf ~/x', 'rm -rf $X', 'rm -rf ../x']) assert.equal(unknown(command), 'deny', command);
});

test('R4: words that are not a delete are not judged', () => {
  for (const command of ['echo rm -rf /', 'git rm -r --cached ../x', 'npm run rm']) assert.equal(verdict(command).decision, 'allow', command);
});

// Los casos de abajo salen de la pasada de mutación: cada uno fija un borde que ningún caso anterior
// distinguía, y uno (`{..,x}`) era un borrado fuera del proyecto que pasaba como inofensivo.

test('R4: a brace expansion is an unresolved target', () => {
  assert.equal(verdict('rm -rf {..,x}').decision, 'deny');
  assert.equal(verdict('rm -rf dist/{a,b}').decision, 'deny');
});

test('R4: any ~ is unresolved, even one that would land inside the project', () => {
  for (const command of ['rm -rf ~u/x', 'rm -rf ~/app/dist', 'rm -rf ~']) assert.equal(verdict(command).decision, 'deny', command);
});

test('R4: an absolute target inside the project is fine even after a cd to an unknown place', () => {
  assert.equal(verdict(`cd $X && rm -rf ${sh(join(ROOT, 'dist'))}`).decision, 'allow');
});

test('R4: after a plain cd only an absolute target inside the project passes', () => {
  assert.equal(verdict('cd && rm -rf app/dist').decision, 'deny');
  assert.equal(verdict(`cd && rm -rf ${sh(join(ROOT, 'dist'))}`).decision, 'allow');
});

test('R4: every operand of rm counts, before and after --, even one that starts with -', () => {
  assert.equal(verdict('rm -rf -- ../x').decision, 'deny');
  assert.equal(verdict('rm -rf dist -- ../x').decision, 'deny');
  assert.equal(verdict('rm -rf ../x -- dist').decision, 'deny');
  assert.equal(verdict('cd .. && rm -rf -- -x').decision, 'deny');
  assert.equal(verdict('rm -f ../x-').decision, 'deny');
});

test('R4: find starts at what comes before its first expression, and only when it deletes', () => {
  assert.equal(verdict('cd .. && find . -name x').decision, 'allow');
  assert.equal(verdict('find ../my-dir -delete').decision, 'deny');
  assert.equal(verdict('find dist -name ../x -delete').decision, 'allow');
  assert.equal(verdict('find -name ../x -delete').decision, 'allow');
  assert.equal(verdict('cd .. && find -delete').decision, 'deny');
  assert.equal(verdict('echo .. -delete').decision, 'allow');
});

test('R4: only . (or ./) is the start find never deletes; another name for the root is not', () => {
  assert.equal(verdict('find ../app -delete').decision, 'deny');
  assert.equal(verdict('find ../app/. -delete').decision, 'deny');
});

test('R4: -- as the first argument, and the options before --, are read as in rm', () => {
  assert.equal(verdict('cd .. && rm -- -x').decision, 'deny');
  assert.equal(verdict(`cd .. && rm -rf -- ${sh(join(ROOT, 'dist'))}`).decision, 'allow');
});

test('R4: pushd moves where the target resolves, like cd', () => {
  assert.equal(verdict('pushd .. && rm -rf app').decision, 'deny');
  assert.equal(verdict('pushd src && rm a.js').decision, 'allow');
});
