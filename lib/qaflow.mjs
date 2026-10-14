import { mkdir, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { qaAgentTestPath, qaResultsPath, requirements } from './qa.mjs';
import { buildRepairPlanMarkdown, buildResultsMarkdown } from './qaagent.mjs';
import { renderReplaySpec } from './qa/browser.mjs';
import { readChoices } from './manifest.mjs';

function requirementTextsFromContext(context) {
  return Object.fromEntries(
    requirements(context?.files?.['spec.md'] || '').map((r) => [r.id.toUpperCase(), r.text])
  );
}

export async function writeQaEvidenceScreenshots(projectPath, specId, steps = []) {
  const evidencePaths = [];
  // Evidencia visual puede contener datos personales de la app: vive bajo .chalc (ignorado por Git),
  // no junto a los entregables versionables de la spec.
  const evidenceDir = join(projectPath, '.chalc', 'qa-evidence', specId);
  for (const step of steps || []) {
    const raw = step.observation?.screenshotBase64;
    if (!raw) continue;
    await mkdir(evidenceDir, { recursive: true });
    const file = join(evidenceDir, `step-${step.step}-failure.png`);
    await writeFile(file, Buffer.from(raw, 'base64'));
    evidencePaths.push(`.chalc/qa-evidence/${specId}/${basename(file)}`);
  }
  return evidencePaths;
}

export async function writeQaResultsArtifact(projectPath, specId, { surface, baseUrl, result }) {
  const evidencePaths = await writeQaEvidenceScreenshots(projectPath, specId, result?.steps || []);
  const markdown = buildResultsMarkdown(specId, { surface, baseUrl, result, evidencePaths });
  const path = qaResultsPath(projectPath, specId);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, markdown, 'utf8');
  return { path, markdown, evidencePaths };
}

export async function writeQaRepairPlanArtifact(projectPath, context, result) {
  const path = join(projectPath, 'specs', context.id, 'qa', 'repair-plan.md');
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buildRepairPlanMarkdown(context.id, { result, requirementTexts: requirementTextsFromContext(context) }), 'utf8');
  return { path };
}

export async function writeQaReplaySpecArtifact(projectPath, context, baseUrl, result) {
  const path = qaAgentTestPath(projectPath, context.id);
  await mkdir(dirname(path), { recursive: true });
  const specLang = (await readChoices(projectPath)).lang;   // idioma del contenido del proyecto (C2)
  const spec = renderReplaySpec({
    // Stryker disable next-line ArrayDeclaration: un paso que no es objeto se filtra igual que una lista vacía
    specId: context.id, baseUrl, steps: result?.steps || [], requirementTexts: requirementTextsFromContext(context), specLang
  });
  // Stryker disable next-line StringLiteral: writeFile con codificación '' usa utf8, el mismo resultado
  await writeFile(path, spec, 'utf8');
  return { path };
}

export async function writeQaAgentArtifacts({ projectPath, context, surface, baseUrl, result, repairPlan = false }) {
  const results = await writeQaResultsArtifact(projectPath, context.id, { surface, baseUrl, result });
  const repair = repairPlan ? await writeQaRepairPlanArtifact(projectPath, context, result) : null;
  const replay = surface === 'web' ? await writeQaReplaySpecArtifact(projectPath, context, baseUrl, result) : null;
  return {
    resultsPath: results.path,
    resultsMarkdown: results.markdown,
    evidencePaths: results.evidencePaths,
    repairPath: repair?.path || null,
    replaySpecPath: replay?.path || null
  };
}
