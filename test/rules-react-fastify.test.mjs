// T2 (spec 025, R3–R8) — al equipar, React, Next.js, React Native, Fastify y Vitest reciben sus skills y MCP,
// y ningún otro stack se los lleva por error.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { detectContext, matchRules } from '../lib/detect.mjs';
import { loadJsonDir } from '../lib/commands/catalogstore.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REACT_SKILLS = ['vercel-react-best-practices', 'vercel-composition-patterns', 'tailwind-best-practices', 'responsive-design', 'interface-design'];
const FASTIFY_SKILLS = ['fastify-best-practices', 'node'];
const NEW_SKILLS = [...REACT_SKILLS.slice(0, 2), 'vercel-react-native-skills', ...FASTIFY_SKILLS];

async function equipmentFor(files) {
  const dir = await mkdtemp(join(tmpdir(), 'chalc-react-fastify-'));
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), typeof content === 'string' ? content : JSON.stringify(content));
  const rules = matchRules(await loadJsonDir(join(ROOT, 'rules')), await detectContext(dir));
  return {
    rules: rules.map((r) => r.id),
    skills: rules.flatMap((r) => r.skills || []),
    mcp: rules.flatMap((r) => r.mcp || []),
    optionalMcp: rules.flatMap((r) => r.optionalMcp || [])
  };
}
const deps = (...names) => ({ 'package.json': { name: 'x', dependencies: Object.fromEntries(names.map((n) => [n, '1'])) } });
const devDeps = (...names) => ({ 'package.json': { name: 'x', devDependencies: Object.fromEntries(names.map((n) => [n, '1'])) } });

test('R3: a React web project gets the React and UI skills, without an MCP', async () => {
  const { skills, mcp } = await equipmentFor(deps('react', 'react-dom'));
  for (const skill of REACT_SKILLS) assert.ok(skills.includes(skill), skill);
  assert.deepEqual(mcp, []);
});

test('R4: a Next.js project gets the Next.js MCP on top of the React skills', async () => {
  for (const files of [deps('next', 'react', 'react-dom'), { ...deps('react', 'react-dom'), 'next.config.mjs': 'export default {}' }]) {
    const { skills, mcp } = await equipmentFor(files);
    assert.deepEqual(mcp, ['next-devtools'], JSON.stringify(Object.keys(files)));
    for (const skill of REACT_SKILLS) assert.ok(skills.includes(skill), skill);
  }
});

test('R4: a plain React project does not get the Next.js MCP', async () => {
  assert.ok(!(await equipmentFor(deps('react', 'react-dom'))).rules.includes('nextjs'));
});

test('R5: React Native / Expo get their skill and none of the web React skills, even with react-dom', async () => {
  for (const files of [deps('react', 'react-native'), deps('react', 'expo'), deps('react', 'react-dom', 'expo', 'react-native-web')]) {
    const { skills } = await equipmentFor(files);
    assert.ok(skills.includes('vercel-react-native-skills'), JSON.stringify(files));
    for (const skill of [...REACT_SKILLS, 'frontend-design']) assert.ok(!skills.includes(skill), `${JSON.stringify(files)} → ${skill}`);
  }
});

test('R6: a Fastify project gets Fastify and Node skills, postgres as optional MCP, and no UI skills', async () => {
  const { rules, skills, mcp, optionalMcp } = await equipmentFor(deps('fastify'));
  for (const skill of FASTIFY_SKILLS) assert.ok(skills.includes(skill), skill);
  assert.deepEqual(mcp, []);
  assert.ok(optionalMcp.includes('postgres'));
  for (const skill of [...REACT_SKILLS, 'frontend-design']) assert.ok(!skills.includes(skill), skill);
  assert.ok(!rules.includes('javascript') && !rules.includes('typescript'), 'fastify implies the generic JS/TS rules');
});

test('R7: Vitest as dependency or by its config file gives the vitest skill', async () => {
  for (const files of [devDeps('vitest'), { ...deps('react'), 'vitest.config.ts': 'export default {}' }]) {
    assert.ok((await equipmentFor(files)).skills.includes('vitest'), JSON.stringify(Object.keys(files)));
  }
});

test('R8: Angular, NestJS, Express and non-JS stacks get none of the new skills (Angular + Vitest only vitest)', async () => {
  for (const files of [deps('@angular/core'), deps('@nestjs/core'), deps('express'), { 'pyproject.toml': '[project]' }]) {
    const { skills, mcp } = await equipmentFor(files);
    for (const skill of [...NEW_SKILLS, 'vitest']) assert.ok(!skills.includes(skill), `${JSON.stringify(files)} → ${skill}`);
    assert.ok(!mcp.includes('next-devtools'));
  }
  const angularVitest = await equipmentFor({ 'package.json': { name: 'x', dependencies: { '@angular/core': '1' }, devDependencies: { vitest: '1' } } });
  assert.ok(angularVitest.skills.includes('vitest'));
  for (const skill of NEW_SKILLS) assert.ok(!angularVitest.skills.includes(skill), skill);
});
