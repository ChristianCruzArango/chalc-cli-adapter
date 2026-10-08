// spec 014 · T23 (R26) — la skill propia de código seguro, para todo proyecto.
//
// Las skills de seguridad de terceros cubren web y back, y ninguna habla de móvil. Esta es la guía de
// chalc para ESCRIBIR código seguro: va en la regla global, así que llega a cualquier stack, y tiene
// una sección por stack. No sustituye a las de terceros: remite a su archivo concreto, que tiene que
// existir.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SKILLS = join(ROOT, 'catalog', 'skills');
// En Windows git puede sacar el archivo con CRLF: se normaliza para que el frontmatter se lea igual.
const skill = (await readFile(join(SKILLS, 'secure-coding', 'SKILL.md'), 'utf8')).replace(/\r\n/g, '\n');

test('R26: the skill declares itself as chalc-authored with a name and a description', () => {
  const front = skill.match(/^---\n([^]*?)\n---/)?.[1] || '';
  assert.match(front, /^name: secure-coding$/m);
  assert.match(front, /^description: .{80,}$/m, 'la descripción dice cuándo usarla');
  assert.match(front, /source: chalc-authored/);
});

test('R26: every project receives it through the global rule', async () => {
  const global = JSON.parse(await readFile(join(ROOT, 'rules', 'global.json'), 'utf8'));
  assert.ok(global.always);
  assert.ok(global.skills.includes('secure-coding'));
});

test('R26: it covers the ten OWASP categories and the eight MASVS groups', () => {
  for (const id of ['A01', 'A02', 'A03', 'A04', 'A05', 'A06', 'A07', 'A08', 'A09', 'A10']) assert.ok(skill.includes(id), id);
  for (const g of ['STORAGE', 'CRYPTO', 'AUTH', 'NETWORK', 'PLATFORM', 'CODE', 'RESILIENCE', 'PRIVACY']) {
    assert.ok(skill.includes(`MASVS-${g}`), `MASVS-${g}`);
  }
});

// Lo que la auditoría encontró que faltaba: lo concreto de móvil y de Flutter.
test('R26: the mobile section names the concrete Flutter and platform controls', () => {
  for (const control of [
    'flutter_secure_storage', 'SharedPreferences', 'usesCleartextTraffic', 'NSAllowsArbitraryLoads',
    'allowBackup', 'debuggable', 'badCertificateCallback', '--obfuscate', 'WebView', 'deep link'
  ]) {
    assert.ok(skill.toLowerCase().includes(control.toLowerCase()), control);
  }
});

test('R26: every third-party reference it points to exists', () => {
  const paths = [...skill.matchAll(/`((?:security-review|code-security|security-and-hardening)\/[\w./-]+\.md)`/g)].map((m) => m[1]);
  assert.ok(paths.length >= 5, `remite a muy pocas referencias (${paths.length})`);
  for (const path of paths) assert.ok(existsSync(join(SKILLS, path)), `no existe ${path}`);
});

test('R26: it is applied while writing, and tells how to justify a gate finding', () => {
  assert.match(skill, /before writing|while writing/i);
  assert.match(skill, /chalc-allow: <rule> — <reason>/);
});
