// T3 (spec 017, R1–R4, base) — partir un comando de shell en comandos simples, sin ejecutar nada.
//
// La guarda del asistente recibe el comando ENTERO que Claude Code va a lanzar por Bash, y ahí sí hay
// cadenas (`a && b`), tuberías y sustituciones: un `git push` escondido detrás de un `&&` es tan push
// como uno suelto. El tokenizador de la shell propia de chalc (`commandTokens`) no lo necesitaba —esa
// shell rechaza los metacaracteres— y por eso no los parte. Aquí se comparte su lectura de palabras y
// comillas, y se añade el corte por separadores.

import test from 'node:test';
import assert from 'node:assert/strict';
import { commandTokens, gitSubcommand, simpleCommands, programOf, shellJoin, shellScript } from '../catalog/gate/lib/shellwords.mjs';
import { readFileSync } from 'node:fs';

// T12 (spec 022, R19, C8) — la shell y la política importan el tokenizador del origen, sin cadena de re-exports.
test('R1: the chalc shell and the guard read words with the very same tokenizer', () => {
  for (const f of ['cli/tools/shell.mjs', 'cli/tools/shellpolicy.mjs']) {
    const src = readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
    assert.match(src, /import \{[^}]*\bcommandTokens\b[^}]*\} from '\.\.\/\.\.\/catalog\/gate\/lib\/shellwords\.mjs'/, f);
    assert.doesNotMatch(src, /export \{ commandTokens \}/, f);
  }
});

test('R1: words and quotes keep their meaning', () => {
  assert.deepEqual(commandTokens(`git commit -m "uno dos" 'tres'`), ['git', 'commit', '-m', 'uno dos', 'tres']);
  assert.throws(() => commandTokens('echo "abierta'), /unterminated quote/);
});

test('R1: the git subcommand skips global options and their values', () => {
  assert.equal(gitSubcommand(['-C', 'dir', 'push', 'origin']).name, 'push');
  assert.deepEqual(gitSubcommand(['-C', 'dir', 'push', 'origin']).rest, ['origin']);
  assert.equal(gitSubcommand(['-c', 'k=v', '--git-dir', 'x', 'commit']).name, 'commit');
  assert.equal(gitSubcommand(['--no-pager', 'push']).name, 'push');
  assert.deepEqual(gitSubcommand(['--version']), { name: '', rest: [] });
  assert.deepEqual(gitSubcommand([]), { name: '', rest: [] });
});

test('R1: a chain is cut into its simple commands', () => {
  assert.deepEqual(simpleCommands('git add . && git commit -m x'), [['git', 'add', '.'], ['git', 'commit', '-m', 'x']]);
  assert.deepEqual(simpleCommands('a; b || c | d & e'), [['a'], ['b'], ['c'], ['d'], ['e']]);
  assert.deepEqual(simpleCommands('a\nb\r\nc'), [['a'], ['b'], ['c']]);
});

test('R1: separators inside quotes are part of the word', () => {
  assert.deepEqual(simpleCommands(`git commit -m "a && b; c | d"`), [['git', 'commit', '-m', 'a && b; c | d']]);
  assert.deepEqual(simpleCommands(`echo 'x;y'`), [['echo', 'x;y']]);
});

test('R1: a command inside a substitution or a subshell is a command too', () => {
  assert.deepEqual(simpleCommands('echo $(git push)'), [['git', 'push'], ['echo', '$(…)']]);
  assert.deepEqual(simpleCommands('echo `git push`'), [['git', 'push'], ['echo', '$(…)']]);
  assert.deepEqual(simpleCommands('(cd x && git push)'), [['cd', 'x'], ['git', 'push']]);
  assert.deepEqual(simpleCommands('{ git push; }'), [['git', 'push']]);
});

test('R3: a redirection target is still a word of its command', () => {
  assert.deepEqual(simpleCommands('cat<.env'), [['cat', '.env']]);
  assert.deepEqual(simpleCommands('echo x > out.txt 2>&1'), [['echo', 'x', 'out.txt', '2', '1']]);
  assert.deepEqual(simpleCommands('make &>log.txt'), [['make', 'log.txt']]);
  assert.deepEqual(simpleCommands('read x <&3'), [['read', 'x', '3']]);
});

test('R5: an unterminated quote does not throw: the rest is one word', () => {
  assert.deepEqual(simpleCommands('git push "origin'), [['git', 'push', 'origin']]);
});

test('R5: nothing to read gives no commands', () => {
  assert.deepEqual(simpleCommands(''), []);
  assert.deepEqual(simpleCommands(undefined), []);
  assert.deepEqual(simpleCommands(' ;; && '), []);
});

test('R1: the program skips variable assignments and wrappers', () => {
  assert.deepEqual(programOf(['GIT_TRACE=1', 'git', 'push']), ['git', 'push']);
  assert.deepEqual(programOf(['sudo', 'rm', '-rf', '/']), ['rm', '-rf', '/']);
  assert.deepEqual(programOf(['env', '-i', 'A=1', 'git', 'push']), ['git', 'push']);
  assert.deepEqual(programOf(['nohup', 'time', 'command', 'exec', 'git', 'push']), ['git', 'push']);
  assert.deepEqual(programOf(['git', 'push']), ['git', 'push']);
  assert.deepEqual(programOf([]), []);
});

test('R1: a program given by path is still that program', () => {
  assert.deepEqual(programOf(['/usr/bin/git', 'push']), ['git', 'push']);
  assert.deepEqual(programOf(['C:\\Git\\bin\\git.exe', 'push']), ['git', 'push']);
});

// Los casos de abajo salen de la pasada de mutación: cada uno fija un borde que ningún caso anterior
// distinguía.

test('R1: repeated spaces and an empty command give no empty words', () => {
  assert.deepEqual(commandTokens('git   push '), ['git', 'push']);
  assert.deepEqual(commandTokens(''), []);
});

test('R1: every git global option that takes a value is skipped with its value', () => {
  for (const option of ['--work-tree', '--namespace', '--super-prefix', '--config-env']) {
    assert.equal(gitSubcommand([option, 'value', 'push']).name, 'push', option);
  }
});

test('R1: after a closing quote the line is read normally again', () => {
  assert.deepEqual(simpleCommands('echo "a" && git push'), [['echo', 'a'], ['git', 'push']]);
});

test('R1: only a NAME=value word is an assignment', () => {
  assert.deepEqual(programOf(['1A=x', 'git']), ['1A=x', 'git']);
});

test('R1: nice is a wrapper; options count only after a wrapper', () => {
  assert.deepEqual(programOf(['nice', 'git', 'push']), ['git', 'push']);
  assert.deepEqual(programOf(['-x', 'git']), ['-x', 'git']);
});

test('R1: only a trailing .exe is dropped from the program name', () => {
  assert.deepEqual(programOf(['my.exec']), ['my.exec']);
});

// T6 (spec 017, R4): leer una sustitución como separador partía el comando de fuera. `rm -rf $(pwd)/x`
// se quedaba en `rm -rf` (sin operando) más un `/x` suelto, y el borrado pasaba como inofensivo.

test('R4: the outer command keeps a marker where a substitution was, and goes on after it', () => {
  assert.deepEqual(simpleCommands('rm -rf $(pwd)/x'), [['pwd'], ['rm', '-rf', '$(…)/x']]);
  assert.deepEqual(simpleCommands('rm -rf `pwd`/x y'), [['pwd'], ['rm', '-rf', '$(…)/x', 'y']]);
  assert.deepEqual(simpleCommands('a $(b $(c)) d'), [['c'], ['b', '$(…)'], ['a', '$(…)', 'd']]);
});

test('R4: a substitution may chain commands inside it', () => {
  assert.deepEqual(simpleCommands('echo $(cd x && git push)'), [['cd', 'x'], ['git', 'push'], ['echo', '$(…)']]);
});

test('R4: ${NAME} is one word, not a group', () => {
  assert.deepEqual(simpleCommands('rm -rf ${BUILD}/x'), [['rm', '-rf', '${BUILD}/x']]);
  assert.deepEqual(simpleCommands('echo ${A:-b}c'), [['echo', '${A:-b}c']]);
});

test('R5: an unclosed substitution or parameter does not throw', () => {
  assert.deepEqual(simpleCommands('rm -rf $(pwd'), [['pwd'], ['rm', '-rf', '$(…)']]);
  assert.deepEqual(simpleCommands('rm ${X'), [['rm', '${X']]);
});

test('R1: a subshell without $ is still only a separator', () => {
  assert.deepEqual(simpleCommands('(git push) && ls'), [['git', 'push'], ['ls']]);
});

test('R4: outside quotes a backslash makes the next character literal', () => {
  assert.deepEqual(simpleCommands('find . \\( -name a \\) -delete'), [['find', '.', '(', '-name', 'a', ')', '-delete']]);
  assert.deepEqual(simpleCommands('echo a\\;b'), [['echo', 'a;b']]);
  assert.deepEqual(simpleCommands('echo a\\'), [['echo', 'a']]);
});

test('R4: single quotes keep a substitution literal; double quotes still expand it', () => {
  assert.deepEqual(simpleCommands("echo '$(git push)'"), [['echo', '$(git push)']]);
  assert.deepEqual(simpleCommands('echo "$(git push)"'), [['git', 'push'], ['echo', '$(…)']]);
  assert.deepEqual(simpleCommands('echo "`git push`"'), [['git', 'push'], ['echo', '$(…)']]);
});

test('R4: only the $ right before ( opens a substitution, and only that $ is dropped', () => {
  assert.deepEqual(simpleCommands('echo x$y$(pwd)'), [['pwd'], ['echo', 'x$y$(…)']]);
  assert.deepEqual(simpleCommands('echo $a(b)'), [['echo', '$a'], ['b']]);
  assert.deepEqual(simpleCommands('echo $ x'), [['echo', '$', 'x']]);
});

test('R4: braces are a group only at the start of a word', () => {
  assert.deepEqual(simpleCommands('rm -rf {..,x}'), [['rm', '-rf', '{..,x}']]);
  assert.deepEqual(simpleCommands('echo a{b}'), [['echo', 'a{b}']]);
  assert.deepEqual(simpleCommands('{echo x}'), [['{echo', 'x}']]);
});

// T3 (spec 018, R11): el motivo de la guarda citaba `git commit -m feat: saludo` —sin las comillas que
// tenía—, y así no se lee como se escribió. `shellJoin` las vuelve a poner solo donde hacen falta.

test('R11 (018): words that need it are quoted again, the rest are left as they are', () => {
  assert.equal(shellJoin(['git', 'commit', '-m', 'feat: saludo']), "git commit -m 'feat: saludo'");
  assert.equal(shellJoin(['rm', '-rf', 'dist/a.js', '--', '~/x', 'a=b', 'v1.2,3@x%+^']), 'rm -rf dist/a.js -- ~/x a=b v1.2,3@x%+^');
});

test('R11 (018): shell characters, an empty word and a single quote are quoted safely', () => {
  assert.equal(shellJoin(['echo', 'a;b', 'a|b', '*.ts', '']), "echo 'a;b' 'a|b' '*.ts' ''");
  assert.equal(shellJoin(['echo', "it's"]), "echo 'it'\\''s'");
});

test('R11 (018): a substitution marker is shown as it is, not as quoted text', () => {
  assert.equal(shellJoin(['rm', '-rf', '$(…)/x']), 'rm -rf $(…)/x');
});

test('R11 (018): what shellJoin writes reads back as the same words', () => {
  assert.deepEqual(commandTokens(shellJoin(['git', 'commit', '-m', 'feat: saludo', 'a b'])), ['git', 'commit', '-m', 'feat: saludo', 'a b']);
});

// T1 (spec 023, R10): `bash -c "git push"` pasaba sin decisión: el programa es `bash` y el push va dentro de
// una cadena. `shellScript` devuelve esa cadena para que la guarda la lea como un comando propio.

test('R10 (023): the script of a shell run with -c is returned as it is', () => {
  for (const shell of ['bash', 'sh', 'zsh', 'dash']) {
    assert.equal(shellScript([shell, '-c', 'git push']), 'git push', shell);
  }
  assert.equal(shellScript(['bash', '-c', 'git add . && git commit -m x']), 'git add . && git commit -m x');
});

test('R10 (023): -c also counts inside a group of short options and after other options', () => {
  assert.equal(shellScript(['bash', '-lc', 'git push']), 'git push');
  assert.equal(shellScript(['bash', '-cx', 'git push']), 'git push');
  assert.equal(shellScript(['bash', '--login', '-c', 'git push']), 'git push');
  // `-o`/`-O` (y sus formas `+`) consumen su valor: `pipefail` no es el script.
  for (const option of ['-o', '+o', '-O', '+O']) {
    assert.equal(shellScript(['bash', option, 'pipefail', '-c', 'git push']), 'git push', option);
  }
  assert.equal(shellScript(['bash', '-c', '--', 'git push']), 'git push');
});

test('R10 (023): the shell is found through paths, .exe and wrappers', () => {
  assert.equal(shellScript(['/bin/bash', '-c', 'git push']), 'git push');
  assert.equal(shellScript(['C:\\Git\\bin\\bash.exe', '-c', 'git push']), 'git push');
  assert.equal(shellScript(['env', 'bash', '-c', 'git push']), 'git push');
  assert.equal(shellScript(['GIT_TRACE=1', 'sudo', 'sh', '-c', 'git push']), 'git push');
});

test('R10 (023): without -c, without a script or with another program there is no script', () => {
  assert.equal(shellScript(['bash', 'deploy.sh']), null);
  assert.equal(shellScript(['bash', '-x', 'deploy.sh']), null);
  assert.equal(shellScript(['bash', '-c']), null);
  assert.equal(shellScript(['bash', '--norc', 'deploy.sh']), null);
  assert.equal(shellScript(['bash', '-c1', 'deploy.sh']), null);
  assert.equal(shellScript(['fish', '-c', 'git push']), null);
  assert.equal(shellScript(['echo', '-c', 'git push']), null);
  assert.equal(shellScript([]), null);
});

// Dentro de comillas dobles, `\` escapa `"`, `\`, `$`, `` ` `` y el salto de línea (POSIX); con cualquier otro
// carácter la barra se queda. Entre comillas simples no escapa nada. Sin esto, un `bash -c` anidado con
// comillas escapadas se partía y su `git commit` no se veía (lo encontró el E2E de la spec 023).
test('R10 (023): a backslash escapes the special characters inside double quotes, and only there', () => {
  assert.deepEqual(simpleCommands('git commit -m "say \\"hi\\""'), [['git', 'commit', '-m', 'say "hi"']]);
  assert.deepEqual(simpleCommands('echo "a\\\\b" "c\\$d" "e\\`f"'), [['echo', 'a\\b', 'c$d', 'e`f']]);
  assert.deepEqual(simpleCommands('echo "a\\nb"'), [['echo', 'a\\nb']]);
  assert.deepEqual(simpleCommands("echo 'a\\'"), [['echo', 'a\\']]);
  assert.deepEqual(simpleCommands("echo 'a\\\"b'"), [['echo', 'a\\"b']]);
  assert.deepEqual(simpleCommands('echo "a\\'), [['echo', 'a\\']]);
});
