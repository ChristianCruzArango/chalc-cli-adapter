// Spec 038 (contrato de diseño), T1 — el contrato (R2): números, no adjetivos. Lo que falta o no vale cae al
// valor por defecto, y una spec puede ajustar el suyo sin tocar el del proyecto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tempDir } from './helpers/tmpdir.mjs';
import { CONTRACT_REL, DEFAULT_CONTRACT, contractOf, readContract } from '../catalog/design/lib/contract.mjs';

test('R1: el contrato por defecto', () => {
  assert.deepEqual(DEFAULT_CONTRACT, {
    viewports: [{ name: 'movil', width: 375, height: 812 }, { name: 'tablet', width: 768, height: 1024 }, { name: 'escritorio', width: 1440, height: 900 }],
    touchBelow: 1024,
    target: { touch: 44, pointer: 24 },
    spacing: { minGap: 8, step: 4, min: 4, max: 64, enforceScale: true },
    typography: { minSize: 12 },
    contrast: { normal: 4.5, large: 3 },
    maxPrimary: 1
  });
  assert.equal(CONTRACT_REL, '.chalc/design.contract.json');
  assert.ok(Object.isFrozen(DEFAULT_CONTRACT));
});

test('R2: sin nada, el de por defecto; lo que se declara manda, clave por clave', () => {
  assert.deepEqual(contractOf(), DEFAULT_CONTRACT);
  assert.deepEqual(contractOf(null, undefined, 'roto', [1]), DEFAULT_CONTRACT);
  const own = contractOf({ spacing: { minGap: 12 }, maxPrimary: 2, target: { touch: 48 } });
  assert.deepEqual([own.spacing, own.maxPrimary, own.target], [{ ...DEFAULT_CONTRACT.spacing, minGap: 12 }, 2, { touch: 48, pointer: 24 }]);
});

test('R2: un valor que no sirve cae al de por defecto, sin arrastrar a los demás', () => {
  const out = contractOf({ spacing: { minGap: -1, step: 0, max: 'mucho', enforceScale: 'sí' }, contrast: { normal: 0.5, large: 99 }, typography: { minSize: NaN }, maxPrimary: 0, touchBelow: 'x',
    viewports: [{ name: 'ok', width: 400, height: 800 }, { name: '', width: 10 }, { name: 'sin-alto', width: 300 }, 'roto'] });
  assert.deepEqual(out.spacing, DEFAULT_CONTRACT.spacing);
  assert.deepEqual(out.contrast, { normal: 4.5, large: 3 }, 'un contraste fuera de 1–21 no vale');
  assert.deepEqual([out.typography, out.maxPrimary, out.touchBelow], [DEFAULT_CONTRACT.typography, 1, 1024]);
  assert.deepEqual(out.viewports, [{ name: 'ok', width: 400, height: 800 }], 'solo las vistas completas');
  assert.deepEqual(contractOf({ viewports: [] }).viewports, DEFAULT_CONTRACT.viewports, 'sin ninguna vista válida, las de por defecto');
  assert.equal(contractOf({ spacing: { enforceScale: false } }).spacing.enforceScale, false);
});

test('R2: el contrato de una spec ajusta el del proyecto, y este el de por defecto', async (t) => {
  const root = await tempDir(t, 'chalc-038-contract-');
  assert.deepEqual(await readContract(root, 'specs/027-checkout'), DEFAULT_CONTRACT);
  await mkdir(join(root, '.chalc'), { recursive: true });
  await mkdir(join(root, 'specs', '027-checkout'), { recursive: true });
  await writeFile(join(root, '.chalc', 'design.contract.json'), JSON.stringify({ spacing: { minGap: 12 }, maxPrimary: 2 }));
  await writeFile(join(root, 'specs', '027-checkout', 'design.contract.json'), JSON.stringify({ maxPrimary: 3 }));
  const own = await readContract(root, 'specs/027-checkout');
  assert.deepEqual([own.spacing.minGap, own.maxPrimary], [12, 3]);
  assert.deepEqual((await readContract(root)).maxPrimary, 2);
  await writeFile(join(root, '.chalc', 'design.contract.json'), '{ roto');
  assert.deepEqual((await readContract(root)).spacing, DEFAULT_CONTRACT.spacing, 'un contrato ilegible no deja al proyecto sin contrato');
});
