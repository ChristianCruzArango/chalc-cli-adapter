// spec 014 — etapa `security` del portón: inyección (SQL, código, HTML).
//
// Cada regla se prueba en las dos direcciones: lo que TIENE que disparar y lo que no. La segunda
// mitad es la que mantiene viva la etapa: un detector con falsos positivos se silencia a base de
// `chalc-allow` hasta que nadie lee lo que dice.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource } from '../catalog/gate/lib/security.mjs';

const rulesIn = (text, file) => scanSource(text, { file }).map((f) => f.rule);

// ── T6 (R5): sql-concat ───────────────────────────────────────────────────────────────────────

const sqlIn = (text, file) => rulesIn(text, file).filter((r) => r === 'sql-concat');

test('R5: a query built by concatenation or interpolation fires, in every dialect', async () => {
  const cases = [
    ['const q = "SELECT * FROM users WHERE id = " + id;', 'src/repo.ts'],
    ['const q = `SELECT * FROM users WHERE email = \'${email}\'`;', 'src/repo.ts'],
    ["await db.rawQuery('SELECT * FROM movimientos WHERE cuenta = $cuentaId');", 'lib/data/db.dart'],
    ["await db.rawQuery('DELETE FROM movimientos WHERE id = ${mov.id}');", 'lib/data/db.dart'],
    ['cursor.execute(f"SELECT * FROM users WHERE name = \'{name}\'")', 'app/repo.py'],
    ['cursor.execute("SELECT * FROM users WHERE name = \'%s\'" % name)', 'app/repo.py'],
    ['cursor.execute("UPDATE users SET name = \'{}\'".format(name))', 'app/repo.py'],
    ['var cmd = new SqlCommand($"SELECT * FROM Users WHERE Id = {id}", conn);', 'src/Repo.cs'],
    ['stmt.executeQuery("SELECT * FROM users WHERE id = " + id);', 'src/Repo.java'],
    ['db.execSQL("INSERT INTO logs VALUES (\'$msg\')")', 'src/Repo.kt'],
    ['const q = "select * from users where id = " + id;', 'src/repo.ts']
  ];
  for (const [text, file] of cases) assert.equal(sqlIn(text, file).length, 1, `${file}: ${text}`);
});

test('R5: parameterized queries and non-SQL text do not fire', async () => {
  const cases = [
    ["await db.rawQuery('SELECT * FROM movimientos WHERE cuenta = ?', [cuentaId]);", 'lib/data/db.dart'],
    ['cursor.execute("SELECT * FROM users WHERE name = %s", (name,))', 'app/repo.py'],
    ['const q = "SELECT * FROM users WHERE id = $1";', 'src/repo.ts'],
    ['cmd.CommandText = "SELECT * FROM Users WHERE Id = @id";', 'src/Repo.cs'],
    ['const q = "SELECT * FROM users";', 'src/repo.ts'],
    ["const msg = 'Select an item from the list: ' + item;", 'src/ui.ts'],
    ["final msg = 'Update your profile, $name';", 'lib/ui/home.dart'],
    ["final msg = 'Delete from cart: ${item.name}';", 'lib/ui/cart.dart']
  ];
  for (const [text, file] of cases) assert.deepEqual(sqlIn(text, file), [], `${file}: ${text}`);
});

// ── T7 (R6): dynamic-eval ─────────────────────────────────────────────────────────────────────

const evalIn = (text, file) => rulesIn(text, file).filter((r) => r === 'dynamic-eval');

test('R6: running code or shell commands built from data fires', async () => {
  const cases = [
    ['const result = eval(userInput);', 'src/calc.ts'],
    ['const fn = new Function("a", body);', 'src/calc.ts'],
    ['exec(`git log ${branch}`, cb);', 'src/git.js'],
    ['execSync("rm -rf " + dir);', 'src/clean.js'],
    ['child_process.execSync(`convert ${file} out.png`);', 'src/img.js'],
    ['result = eval(expression)', 'app/calc.py'],
    ['exec(code)', 'app/plugins.py'],
    ['os.system("ping " + host)', 'app/net.py'],
    ['subprocess.run(f"ping {host}", shell=True)', 'app/net.py'],
    ['Runtime.getRuntime().exec("ping " + host);', 'src/Net.java']
  ];
  for (const [text, file] of cases) assert.equal(evalIn(text, file).length, 1, `${file}: ${text}`);
});

test('R6: fixed commands, argument lists and regex exec do not fire', async () => {
  const cases = [
    ['const m = /(\\d+)/.exec(text);', 'src/parse.ts'],
    ['const m = pattern.exec(line);', 'src/parse.ts'],
    ['execSync("git rev-parse HEAD");', 'src/git.js'],
    ["execFileSync('git', ['log', branch]);", 'src/git.js'],
    ['subprocess.run(["ping", host])', 'app/net.py'],
    ['os.system("clear")', 'app/cli.py'],
    ['const evaluate = (a) => a;', 'src/calc.ts']
  ];
  for (const [text, file] of cases) assert.deepEqual(evalIn(text, file), [], `${file}: ${text}`);
});

// ── T8 (R7): unsafe-html ──────────────────────────────────────────────────────────────────────

const htmlIn = (text, file) => rulesIn(text, file).filter((r) => r === 'unsafe-html');

test('R7: writing unescaped HTML fires', async () => {
  const cases = [
    ['el.innerHTML = comment.body;', 'src/view.ts'],
    ['el.innerHTML += `<li>${item}</li>`;', 'src/view.ts'],
    ['el.outerHTML = html;', 'src/view.ts'],
    ['el.insertAdjacentHTML("beforeend", row);', 'src/view.ts'],
    ['document.write(banner);', 'src/legacy.js'],
    ['<div dangerouslySetInnerHTML={{ __html: post.body }} />', 'src/Post.tsx'],
    ['this.html = this.sanitizer.bypassSecurityTrustHtml(raw);', 'src/post.component.ts']
  ];
  for (const [text, file] of cases) assert.equal(htmlIn(text, file).length, 1, `${file}: ${text}`);
});

test('R7: safe text, fixed markup and sanitized HTML do not fire', async () => {
  const cases = [
    ['el.textContent = comment.body;', 'src/view.ts'],
    ["el.innerHTML = '';", 'src/view.ts'],
    ['el.innerHTML = "<hr>";', 'src/view.ts'],
    ['el.innerHTML = DOMPurify.sanitize(html);', 'src/view.ts'],
    ['<div dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(body) }} />', 'src/Post.tsx'],
    ['if (el.innerHTML === html) return;', 'src/view.ts']
  ];
  for (const [text, file] of cases) assert.deepEqual(htmlIn(text, file), [], `${file}: ${text}`);
});


// En JS `exec` es un nombre corriente: un ejecutor propio, un helper de tests. Solo cuenta como
// shell cuando recibe un comando armado como texto.
test('R6: a JS function that happens to be called exec does not fire on plain values', async () => {
  assert.deepEqual(evalIn("await exec({ type: 'http', method: 'GET' });", 'test/qa.test.mjs'), []);
  assert.deepEqual(evalIn('const out = exec(step);', 'src/runner.ts'), []);
  assert.equal(evalIn('exec("ls " + dir);', 'src/runner.ts').length, 1);
});
