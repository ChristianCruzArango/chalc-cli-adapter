// spec 014 · Tm — los bordes de cada regla de seguridad.
//
// La pasada de mutación dejó vivos los mutantes que cambian el ESPACIADO y las ANCLAS de las
// expresiones: ningún test escribía `rejectUnauthorized:false` sin espacio, ni un host que EMPIEZA
// como uno local (`localhost.evil.com`), ni una consulta en mayúsculas sin `WHERE`. Esos son
// justamente los huecos por donde un detector deja pasar código real, así que cada caso va aquí, en
// las dos direcciones.

import test from 'node:test';
import assert from 'node:assert/strict';
import { scanSource, securityLines } from '../catalog/gate/lib/security.mjs';

const hits = (rule, text, file = 'src/a.ts') => scanSource(text, { file }).filter((f) => f.rule === rule);
const fires = (rule, cases) => { for (const [text, file] of cases) assert.equal(hits(rule, text, file).length, 1, `${file ?? 'src/a.ts'}: ${text}`); };
const silent = (rule, cases) => { for (const [text, file] of cases) assert.deepEqual(hits(rule, text, file), [], `${file ?? 'src/a.ts'}: ${text}`); };

test('R15: a file with no extension has no dialect', () => {
  assert.equal(securityLines('apiKey = "a1b2c3d4e5f6"\n', 'Makefile'), null);
});

test('R2: secrets — exact length, spacing, names and look-alike values', () => {
  fires('hardcoded-secret', [
    ['const apiKey = "Ab12cd34";'],
    ['const apiKey:string = "a1b2c3d4e5f6";'],
    ['val accessKey:String = "q1w2e3r4t5y6"', 'src/Keys.kt'],
    ['const privateKey = "Zx9-Qw8-Er7";'],
    ['const authKey = "Zx9-Qw8-Er7";'],
    ["const password = 'Pa$$w0rd!x';", 'src/a.ts'],
    ["const token = 'Zx9<Qw8>';"],
    ["const token = '<Qw8>Er7';"],
    ["const token = 'Ab1xxxxxxx';"],
    ["const token = 'aaaaB12x';"]
  ]);
  silent('hardcoded-secret', [
    ['const apiKey = "Ab12cd3";'],
    ["final token = 'tok$userId1A';", 'lib/a.dart']
  ]);
});

test('R3: tls — every spacing of the switches and the callbacks', () => {
  fires('tls-disabled', [
    ['const a = new https.Agent({ rejectUnauthorized:false });'],
    ['const a = new https.Agent({ rejectUnauthorized :  false });'],
    ['process.env.NODE_TLS_REJECT_UNAUTHORIZED= "0";', 'src/a.js'],
    ['process.env.NODE_TLS_REJECT_UNAUTHORIZED =0;', 'src/a.js'],
    ['r = requests.get(url, verify= False)', 'app/a.py'],
    ['r = requests.get(url, verify =False)', 'app/a.py'],
    ['client.badCertificateCallback = (c, h, p) =>true;', 'lib/a.dart'],
    ['client.badCertificateCallback = (c, h, p) => (true);', 'lib/a.dart'],
    ['client.badCertificateCallback = (c, h, p) =>  true;', 'lib/a.dart'],
    ['client.badCertificateCallback = (c, h, p) {return true;};', 'lib/a.dart'],
    ['client.badCertificateCallback = (c, h, p) { true };', 'lib/a.dart'],
    ['ServicePointManager.ServerCertificateValidationCallback = (s, c, ch, e) => true;', 'src/A.cs']
  ]);
  silent('tls-disabled', [
    // El `=> true` es de otra función; el callback valida de verdad.
    ['final ok = (x) => true; client.badCertificateCallback = verificar;', 'lib/a.dart']
  ]);
});

test('R4: transport — hosts that only look local, and namespaces that only look like one', () => {
  fires('insecure-transport', [
    ['const u = "http://localhost.evil.com/x";'],
    ['const u = "http://evil-localhost/x";'],
    ['const u = "http://127.0.0.1.evil.com/x";'],
    ['const u = "http://www.w3.org.evil.com/x";'],
    ['const u = "http://evil.www.w3.org/x";']
  ]);
  silent('insecure-transport', [['const u = "http://127.0.0.10:8080";']]);
});

test('R5: sql — uppercase without WHERE, every statement in lowercase, and constant concatenation', () => {
  fires('sql-concat', [
    ['const q = "SELECT name FROM users ORDER BY " + col;'],
    ['const q = "SELECT  name FROM users ORDER BY " + col;'],
    ['const q = "INSERT INTO " + tabla;'],
    ['const q = "INSERT  INTO " + tabla;'],
    ['const q = "UPDATE cuentas SET " + campos;'],
    ['const q = "UPDATE  cuentas  SET " + campos;'],
    ['const q = "DELETE FROM sesiones " + filtro;'],
    ['const q = "DELETE  FROM sesiones " + filtro;'],
    ['const q = "insert into logs values (" + v;'],
    ['const q = "insert  into logs values (" + v;'],
    ['const q = "update cuentas set saldo = " + s;'],
    ['const q = "update  cuentas  set saldo = " + s;'],
    ['const q = "delete from sesiones where id = " + id;'],
    ['const q = "delete  from sesiones where id = " + id;'],
    ['const q = "SELECT * FROM users WHERE id = " +id;'],
    ['const q = prefix + "SELECT * FROM users WHERE id = 1";'],
    ['const q = prefix+"SELECT * FROM users WHERE id = 1";'],
    ['cursor.execute("SELECT * FROM users WHERE name = %s" % (name,))', 'app/a.py']
  ]);
  silent('sql-concat', [
    ['db.query("SELECT * FROM users WHERE id = ?", [a + b]);'],
    ['const q = "SELECT * FROM users WHERE " + "id = 1";'],
    ['const q = "a" + "SELECT * FROM users WHERE id = 1";'],
    ['const q = "SELECT * FROM users WHERE id = ?"; const total = base +'],
    ['const q = `SELECT * FROM users`;'],
    ['q = "SELECT * FROM users WHERE id = {id}"', 'app/a.py']
  ]);
  assert.equal(hits('sql-concat', 'const q = "select * from users where id = " + id;')[0].data.match, 'SELECT');
});

test('R6: eval and shell — spacing, arguments after a fixed command, and shell=True', () => {
  fires('dynamic-eval', [
    ['const r = eval (input);'],
    ['const r = eval("a"+b);'],
    ['execSync ("rm -rf " + dir);', 'src/a.js'],
    ['exec( "ls " + dir);', 'src/a.js'],
    ['subprocess.run(f"ping {host}", shell =True)', 'app/a.py'],
    ['subprocess.run(f"ping {host}", shell= True)', 'app/a.py']
  ]);
  silent('dynamic-eval', [
    ['const r = eval();'],
    ['execSync("git status", { cwd: dir + "/x" });', 'src/a.js'],
    ['subprocess.run("ls -la", shell=True)', 'app/a.py'],
    ['subprocess.run(["ls", f"{d}"], shell=False)', 'app/a.py']
  ]);
});

test('R7: html — assignment without spaces', () => {
  fires('unsafe-html', [['el.innerHTML=data;']]);
});

test('R8: weak hashes — spacing in every call shape and SHA1 without the dash', () => {
  fires('weak-hash', [
    ["const h = createHash( 'md5' );"],
    ["const h = createHash ('sha1');"],
    ['final d = md5.convert (b);', 'lib/a.dart'],
    ["h = hashlib.new( 'sha1', d)", 'app/a.py'],
    ["h = hashlib.new ('md5')", 'app/a.py'],
    ['MessageDigest.getInstance( "SHA1");', 'src/A.java'],
    ['MessageDigest.getInstance ("MD5");', 'src/A.java'],
    ['using var h = MD5.Create ();', 'src/A.cs'],
    ['var h = new  SHA1Managed();', 'src/A.cs']
  ]);
});
