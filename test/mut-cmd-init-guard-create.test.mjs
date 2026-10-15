// T11 (spec 023, R13, R14) — mutantes de lib/commands/init.mjs: al crear de verdad, la guarda pedida con el flag
// se aplica sobre el proyecto ya equipado. Dentro del proceso, para que Stryker lo vea; argv, PATH y HOME de
// chalc se fijan ANTES de importar. Un `npx` falso hace de scaffolder: solo crea la carpeta, sin red.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const BASE = mkdtempSync(join(tmpdir(), 'chalc-mut-init-guard-'));
after(() => rmSync(BASE, { recursive: true, force: true }));
const BIN = join(BASE, '.bin');
mkdirSync(BIN);
writeFileSync(join(BIN, 'npx'), '#!/bin/sh\nmkdir "$4"\n', { mode: 0o755 });
process.env.PATH = `${BIN}${delimiter}${process.env.PATH}`;
process.env.CHALC_HOME = join(BASE, '.home');
process.argv = [process.argv[0], 'chalc', 'init', 'angular', 'demo', '--architecture', 'modular-clean-architecture',
  '--no-ai', '--yes', '--allow-exec', '--dir', BASE, '--guard'];

const { runInit } = await import('../lib/commands/init.mjs');
const { t } = await import('../lib/i18n.mjs');
const { c } = await import('../lib/ansi.mjs');

async function capture(fn) {
  const out = [];
  const orig = console.log;
  console.log = (m = '') => out.push(String(m));
  try { await fn(); } finally { console.log = orig; }
  return out;
}

// Un script de shell con bit de ejecución: en Windows `npx` es `npx.cmd` y pasa por cmd.exe (reglas 3 y 7).
test('init --guard: crea, equipa y deja la guarda en el proyecto creado', { skip: process.platform === 'win32' }, async () => {
  const out = await capture(() => runInit());
  assert.ok(out.includes(`  ${c.cyan('•')} ${t('guardAdded')}`), out.join('\n'));
  // La guarda va sobre un proyecto equipado de verdad, no sobre una carpeta suelta.
  for (const rel of ['.chalc.json', join('.claude', 'settings.local.json')]) assert.ok(existsSync(join(BASE, 'demo', rel)), rel);
});
