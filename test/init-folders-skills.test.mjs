// T4 (spec 025, R18) — las guías por carpeta (README de cada carpeta y mapa de docs/architecture.md) solo
// recomiendan skills que existen en el catálogo. Hallado en T4: las de Angular citaban `angular-component`,
// `angular-di`… retiradas al entrar `angular-developer`; y los consejos comunes eran solo de Angular.

import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listStacks, getStack } from '../lib/init.mjs';
import { folderGuide, folderRoles } from '../lib/init-folders.mjs';

const SKILLS = fileURLToPath(new URL('../catalog/skills/', import.meta.url));
const everyFolder = () => listStacks().flatMap(({ id }) => getStack(id).architectures.flatMap((a) => a.folders.map((folder) => [id, folder])));

test('R18: every skill a folder guide recommends exists in the catalog', () => {
  const missing = [];
  for (const [stack, folder] of everyFolder()) {
    for (const skill of folderGuide(stack, folder, 'en').skills) if (!existsSync(join(SKILLS, skill, 'SKILL.md'))) missing.push(`${stack}:${folder} → ${skill}`);
  }
  assert.deepEqual(missing, []);
});

test('R18: React and Fastify folders recommend their own skills', () => {
  assert.ok(folderGuide('react', 'src/features').skills.includes('vercel-composition-patterns'));
  assert.ok(folderGuide('react', 'src/app').skills.includes('vercel-react-best-practices'));
  assert.ok(folderGuide('react', 'src/testing').skills.includes('vitest'));
  for (const folder of ['src/plugins', 'src/routes', 'src/modules']) assert.ok(folderGuide('fastify', folder).skills.includes('fastify-best-practices'), folder);
  assert.ok(folderGuide('angular', 'src/app/features').skills.includes('angular-developer'));
});

test('R18: guides shared by several frameworks do not speak only Angular', () => {
  for (const code of ['es', 'en']) {
    const shared = folderGuide('react', 'src/shared', code).tips.join(' ');
    assert.match(shared, /props/, `${code}: shared`);
    assert.match(folderGuide('react', 'src/presentation', code).tips.join(' '), /hooks/, `${code}: presentation`);
    assert.match(folderGuide('fastify', 'src/modules', code).tips.join(' '), /JSON Schema/, `${code}: modules`);
  }
});

// La tabla completa rol → skills por stack: quitar o cambiar una recomendación tiene que ser una decisión visible.
const EXPECTED_SKILLS = {
  core: { angular: ['angular-developer'], react: ['vercel-react-best-practices'] },
  shared: { angular: ['angular-developer', 'responsive-design', 'tailwind-best-practices'], react: ['vercel-composition-patterns', 'responsive-design', 'tailwind-best-practices'], fastify: ['fastify-best-practices'] },
  features: { angular: ['angular-developer'], react: ['vercel-composition-patterns', 'vercel-react-best-practices'] },
  domain: { angular: ['solid-principles', 'interface-design'], react: ['solid-principles', 'interface-design'], fastify: ['solid-principles', 'interface-design'], flutter: ['solid-principles', 'interface-design'] },
  application: { angular: ['solid-principles', 'interface-design'], react: ['solid-principles', 'interface-design'], fastify: ['solid-principles', 'interface-design'], flutter: ['solid-principles', 'interface-design'] },
  data: { angular: ['interface-design'], react: ['interface-design'], fastify: ['interface-design'], flutter: ['flutter-async', 'interface-design'] },
  infrastructure: { angular: ['angular-developer', 'interface-design'], react: ['vercel-react-best-practices', 'interface-design'], fastify: ['fastify-best-practices', 'node'], flutter: ['interface-design'] },
  presentation: { angular: ['angular-developer', 'responsive-design'], react: ['vercel-composition-patterns', 'vercel-react-best-practices', 'responsive-design'] },
  layouts: { angular: ['angular-developer', 'responsive-design'], react: ['vercel-composition-patterns', 'responsive-design'] },
  domains: { angular: ['solid-principles'], react: ['solid-principles'], fastify: ['solid-principles'], flutter: ['solid-principles'] },
  testing: { angular: ['angular-developer', 'mutation-testing'], react: ['vitest', 'mutation-testing'], fastify: ['mutation-testing'], flutter: ['mutation-testing'] },
  common: { angular: ['solid-principles'], react: ['solid-principles'], fastify: ['solid-principles'], flutter: ['solid-principles'] },
  config: { fastify: ['fastify-best-practices', 'node'] },
  modules: { fastify: ['fastify-best-practices'] },
  health: { fastify: ['fastify-best-practices'] },
  app: { react: ['vercel-react-best-practices', 'vercel-composition-patterns'] },
  plugins: { fastify: ['fastify-best-practices', 'node'] },
  routes: { fastify: ['fastify-best-practices'] },
  libs: {  }
};

test('R18: the skills each folder guide recommends, per stack, are exactly the agreed ones', () => {
  for (const role of folderRoles()) {
    for (const stack of ['angular', 'react', 'fastify', 'flutter']) {
      assert.deepEqual(folderGuide(stack, `src/${role}`, 'en').skills, EXPECTED_SKILLS[role]?.[stack] || [], `${role}/${stack}`);
    }
  }
});

test('R18: every guide has a title, purpose, content and tips in both languages, and they differ by language', () => {
  for (const role of folderRoles()) {
    const es = folderGuide('react', `src/${role}`, 'es');
    const en = folderGuide('react', `src/${role}`, 'en');
    assert.ok(es.title && es.title === en.title, role);
    for (const field of ['purpose', 'goes']) {
      assert.ok(es[field] && en[field] && es[field] !== en[field], `${role}.${field}`);
    }
    assert.equal(es.tips.length, en.tips.length, `${role}.tips`);
    assert.ok(es.tips.length > 0, `${role}.tips`);
    es.tips.forEach((tip, i) => assert.ok(tip && en.tips[i] && tip !== en.tips[i], `${role}.tips[${i}]`));
  }
});
