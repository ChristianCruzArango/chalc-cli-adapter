// T1b (spec 025, R16) — un `description` multilínea (YAML válido) se lee entero, al proyectar la skill al
// agente y en `chalc doctor`. Hallado al vendorizar `vercel-composition-patterns`: chalc leía solo la primera
// línea de continuación y doctor avisaba «no declara description».

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { frontmatterValue } from '../lib/targetkit/formats.mjs';
import { readSkillMeta } from '../lib/targetkit.mjs';
import { skillIssues, makeIssue } from '../lib/commands/doctorchecks.mjs';
import { t } from '../lib/i18n.mjs';

const fm = (...lines) => lines.join('\n');

test('R16: single-line values keep working, with and without quotes', () => {
  assert.equal(frontmatterValue(fm('name: x', 'description: Hace cosas.'), 'description'), 'Hace cosas.');
  assert.equal(frontmatterValue(fm('description: "Revisa: todo"'), 'description'), 'Revisa: todo');
  assert.equal(frontmatterValue(fm("description: 'it''s'"), 'description'), "it's");
});

test('R16: an indented plain multi-line value is joined with spaces', () => {
  const text = fm('name: x', 'description:', '  React composition patterns', '  that scale.', 'license: MIT');
  assert.equal(frontmatterValue(text, 'description'), 'React composition patterns that scale.');
});

test('R16: a plain value that continues on indented lines is joined too', () => {
  const text = fm('description: React composition', '  patterns that scale.', 'license: MIT');
  assert.equal(frontmatterValue(text, 'description'), 'React composition patterns that scale.');
});

test('R16: folded (>) and literal (|) blocks, with chomping indicators', () => {
  assert.equal(frontmatterValue(fm('description: >', '  one', '  two', 'x: 1'), 'description'), 'one two');
  assert.equal(frontmatterValue(fm('description: >-', '  one', '  two'), 'description'), 'one two');
  assert.equal(frontmatterValue(fm('description: |', '  one', '  two', 'x: 1'), 'description'), 'one\ntwo');
  assert.equal(frontmatterValue(fm('description: |-', '  one', '  two'), 'description'), 'one\ntwo');
});

test('R16: blank lines inside the value add no extra spaces', () => {
  assert.equal(frontmatterValue(fm('description:', '  one', '', '  two', 'x: 1'), 'description'), 'one two');
  assert.equal(frontmatterValue(fm('description: >', '  one', '', '  two', 'x: 1'), 'description'), 'one two');
});

test('R16: a quote or a block sign in the middle of a plain value is just text', () => {
  assert.equal(frontmatterValue(fm("description: it's long", '  and goes on'), 'description'), "it's long and goes on");
  assert.equal(frontmatterValue(fm('description: a|', 'x: 1'), 'description'), 'a|');
});

test('R16: a missing or empty key gives an empty string; another key is not taken by mistake', () => {
  assert.equal(frontmatterValue(fm('name: x'), 'description'), '');
  assert.equal(frontmatterValue(fm('description:', 'license: MIT'), 'description'), '');
  assert.equal(frontmatterValue(fm('metadata:', '  description: nested'), 'description'), '');
});

test('R16: CRLF line endings are read the same', () => {
  const text = ['description:', '  one', '  two', 'x: 1'].join('\r\n');
  assert.equal(frontmatterValue(text, 'description'), 'one two');
});

async function catalogWith(skillMd) {
  const root = await mkdtemp(join(tmpdir(), 'chalc-fm-'));
  await mkdir(join(root, 'skills', 'multi'), { recursive: true });
  await writeFile(join(root, 'skills', 'multi', 'SKILL.md'), skillMd);
  return root;
}

test('R16: readSkillMeta returns the whole multi-line description', async () => {
  const root = await catalogWith('---\nname: multi\ndescription:\n  First line\n  second line.\nlicense: MIT\n---\n# body\n');
  assert.deepEqual(await readSkillMeta(root, 'multi'), { id: 'multi', name: 'multi', description: 'First line second line.' });
});

test('R16: doctor accepts a multi-line description and still flags a missing one', async () => {
  const ok = await catalogWith('---\nname: multi\ndescription:\n  First line\n---\n');
  assert.deepEqual(await skillIssues(ok, ['multi']), []);
  const bad = await catalogWith('---\nname: multi\ndescription:\nlicense: MIT\n---\n');
  assert.deepEqual(await skillIssues(bad, ['multi']), [makeIssue('warn', 'skills', t('drNoDeclare', 'multi', 'description'))]);
});

test('R16: doctor flags a SKILL.md without frontmatter, or with it below the first line', async () => {
  const expected = [
    makeIssue('warn', 'skills', t('drNoFrontmatter', 'multi')),
    makeIssue('warn', 'skills', t('drNoDeclare', 'multi', 'name')),
    makeIssue('warn', 'skills', t('drNoDeclare', 'multi', 'description'))
  ];
  assert.deepEqual(await skillIssues(await catalogWith('# multi\n'), ['multi']), expected);
  const late = await catalogWith('intro\n---\nname: multi\ndescription: x\n---\n');
  assert.deepEqual(await skillIssues(late, ['multi']), expected);
});
