// F-06 — el frontmatter que chalc genera es YAML válido aunque el texto lleve «: ».
//
// Los resúmenes de los tres roles del catálogo contienen «: », y sin comillas un parser estricto
// fallaba con «mapping values are not allowed here»: el asistente no cargaba los roles del portón.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadRoles } from '../lib/roles.mjs';
import { writeRole, mdc, yamlScalar } from '../lib/targetkit.mjs';

const CATALOG = fileURLToPath(new URL('../catalog', import.meta.url));

// Lee un escalar de frontmatter como lo haría un parser YAML estricto en los dos casos que chalc
// emite: texto llano (que no puede contener «: » ni « #») o cadena entre comillas dobles.
function scalar(front, key) {
  const raw = front.match(new RegExp(`^${key}: (.*)$`, 'm'))[1];
  if (raw.startsWith('"')) return JSON.parse(raw);
  assert.doesNotMatch(raw, /: | #|^[-?:,[\]{}#&*!|>'"%@`]/, `${key} needs quoting: ${raw}`);
  return raw;
}

test('every catalog role is written with a frontmatter that round-trips', async () => {
  const roles = await loadRoles();
  assert.ok(roles.length >= 3);
  const dir = await mkdtemp(join(tmpdir(), 'chalc-f06-'));
  for (const role of roles) {
    for (const specLang of ['es', 'en']) {
      const file = await writeRole(dir, CATALOG, role, { specLang, file: join(dir, `${role.id}-${specLang}.md`) });
      const front = (await readFile(file, 'utf8')).split('---')[1];
      assert.equal(scalar(front, 'name'), role.id);
      assert.equal(scalar(front, 'description'), role.summary[specLang]);
    }
  }
});

test('Cursor rules quote descriptions with colons', () => {
  const front = mdc({ description: 'Mutation testing: score mínimo', body: 'x' }).split('---')[1];
  assert.equal(scalar(front, 'description'), 'Mutation testing: score mínimo');
});

test('yamlScalar leaves simple text alone and quotes what YAML would misread', () => {
  assert.equal(yamlScalar('revisor'), 'revisor');
  assert.equal(yamlScalar('Código limpio (Chalc)'), 'Código limpio (Chalc)');
  for (const tricky of ['a: b', 'yes', '#x', 'it\'s', '- item', 'x #y', '']) {
    assert.equal(JSON.parse(yamlScalar(tricky)), tricky);
  }
});
