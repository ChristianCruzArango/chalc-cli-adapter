// F-09 — `edit` escribe el texto nuevo literal, aunque lleve patrones de reemplazo con `$`.

import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createFsTools } from '../cli/tools/fs.mjs';
import { tempDir } from './helpers/tmpdir.mjs';

test('edit keeps $&, $$, $` and $\' literally', async (tc) => {
  const root = await tempDir(tc, 'chalc-f09-');
  await writeFile(join(root, 'a.sh'), 'before OLD after');
  const { edit } = createFsTools({ root });
  const replacement = "$$ and $& and $` and $' and $1";

  assert.equal((await edit.run({ path: 'a.sh', old: 'OLD', new: replacement })).ok, true);
  assert.equal(await readFile(join(root, 'a.sh'), 'utf8'), `before ${replacement} after`);
});
