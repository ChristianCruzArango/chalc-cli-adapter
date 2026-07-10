import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { qaAgentTestPath, qaResultsPath } from '../lib/qa.mjs';
import { writeQaAgentArtifacts, writeQaEvidenceScreenshots } from '../lib/qaflow.mjs';

async function makeRoot() {
  return mkdtemp(join(tmpdir(), 'chalc-qaflow-'));
}

const context = {
  id: '001-login',
  files: { 'spec.md': '## Requisitos\n- **R1** — Login visible\n- **R2** — Error visible\n' }
};

test('writeQaEvidenceScreenshots persiste screenshots base64 como rutas relativas de evidencia', async () => {
  const root = await makeRoot();
  try {
    const paths = await writeQaEvidenceScreenshots(root, context.id, [
      { step: 1, observation: { ok: true } },
      { step: 2, observation: { screenshotBase64: Buffer.from('png-data').toString('base64') } }
    ]);

    assert.deepEqual(paths, ['.chalc/qa-evidence/001-login/step-2-failure.png']);
    assert.equal(await readFile(join(root, '.chalc', 'qa-evidence', context.id, 'step-2-failure.png'), 'utf8'), 'png-data');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeQaAgentArtifacts escribe results, repair-plan y replay spec web', async () => {
  const root = await makeRoot();
  try {
    const result = {
      steps: [
        {
          step: 1,
          action: { type: 'browser', requirement: 'R1', steps: [{ op: 'goto', url: '/' }, { op: 'expectText', selector: 'body', value: 'Login' }] },
          observation: { ok: true }
        },
        { step: 2, observation: { screenshotBase64: Buffer.from('fail').toString('base64') } }
      ],
      verdicts: [
        { id: 'R1', status: 'PASS', evidence: 'Login visible' },
        { id: 'R2', status: 'FAIL', evidence: 'Authorization: Bearer live-token' }
      ]
    };

    const artifacts = await writeQaAgentArtifacts({
      projectPath: root,
      context,
      surface: 'web',
      baseUrl: 'http://localhost:3000',
      result,
      repairPlan: true
    });

    assert.equal(artifacts.resultsPath, qaResultsPath(root, context.id));
    assert.equal(artifacts.replaySpecPath, qaAgentTestPath(root, context.id));
    assert.ok(artifacts.repairPath.endsWith(join('qa', 'repair-plan.md')));
    assert.deepEqual(artifacts.evidencePaths, ['.chalc/qa-evidence/001-login/step-2-failure.png']);

    const results = await readFile(artifacts.resultsPath, 'utf8');
    assert.match(results, /\.chalc\/qa-evidence\/001-login\/step-2-failure\.png/);
    assert.match(results, /Authorization: \[REDACTED\]/);
    assert.doesNotMatch(results, /live-token/);

    const repair = await readFile(artifacts.repairPath, 'utf8');
    assert.match(repair, /R2 — Error visible/);
    assert.doesNotMatch(repair, /R1.*PASS/);

    const replay = await readFile(artifacts.replaySpecPath, 'utf8');
    assert.match(replay, /test\('R1 — Login visible'/);
    assert.match(replay, /page\.goto\("http:\/\/localhost:3000\/"\)/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('writeQaAgentArtifacts no crea replay spec cuando la superficie es api', async () => {
  const root = await makeRoot();
  try {
    const artifacts = await writeQaAgentArtifacts({
      projectPath: root,
      context,
      surface: 'api',
      baseUrl: 'http://localhost:3000',
      result: { steps: [], verdicts: [{ id: 'R1', status: 'PASS', evidence: 'ok' }] }
    });

    assert.equal(artifacts.replaySpecPath, null);
    assert.equal(existsSync(qaAgentTestPath(root, context.id)), false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
