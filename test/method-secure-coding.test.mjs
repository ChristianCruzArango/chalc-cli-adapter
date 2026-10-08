// spec 014 · T24 (R25) — el código seguro se escribe, no solo se revisa.
//
// Las reglas del método dicen «skills bajo demanda», y así las de seguridad quedaban para cuando el
// modelo creyera que hacían falta: casi nunca. La regla dura nueva las saca de ahí para el código que
// toca algo sensible, y los cuatro archivos (lite/full × es/en) tienen que decir lo mismo.

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'catalog', 'methods', 'sdd');
const FILES = { 'rules-lite.md': 'es', 'rules-full.md': 'es', 'rules-lite.en.md': 'en', 'rules-full.en.md': 'en' };

const TRIGGERS = {
  es: [/entrada externa/, /autenticaci/, /permisos/, /secretos/, /almacenamiento/, /red\b/, /criptograf/, /logs/],
  en: [/external input/, /authentication/, /permissions/, /secrets/, /storage/, /network/, /cryptograph/, /logs/]
};

const secureRule = (text) => text.split('\n').find((line) => line.includes('`secure-coding`')) || '';

test('R25: every rules file has a hard rule that opens secure-coding before writing sensitive code', async () => {
  for (const [name, code] of Object.entries(FILES)) {
    const rule = secureRule(await readFile(join(DIR, name), 'utf8'));
    assert.ok(rule, `${name}: no nombra secure-coding`);
    assert.match(rule, code === 'es' ? /ANTES de escribir/ : /BEFORE writing/, `${name}: no dice «antes»`);
    for (const trigger of TRIGGERS[code]) assert.match(rule, trigger, `${name}: falta ${trigger}`);
  }
});

// Sin decirlo, «skills bajo demanda» y la regla nueva se contradicen, y gana la que el modelo lea última.
test('R25: the rule says it is the exception to on-demand skills', async () => {
  for (const [name, code] of Object.entries(FILES)) {
    const rule = secureRule(await readFile(join(DIR, name), 'utf8'));
    assert.match(rule, code === 'es' ? /excepci[oó]n/ : /exception/, name);
  }
});

test('R25: the rule says the gate and the security role will check it', async () => {
  for (const [name, code] of Object.entries(FILES)) {
    const rule = secureRule(await readFile(join(DIR, name), 'utf8'));
    assert.match(rule, /`seguridad`/, name);
    assert.match(rule, code === 'es' ? /port[oó]n/ : /gate/, name);
  }
});
