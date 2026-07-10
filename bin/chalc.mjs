#!/usr/bin/env node
// ⚙️ chalc — equipa cualquier proyecto con skills/MCP/métodos correctos. Interactivo, sin IA.
//
// Uso:
//   chalc [rutaProyecto]                 modo interactivo (te pregunta qué montar)
//   chalc inspect [rutaProyecto]         explica qué detecta y por qué, sin escribir
//   chalc doctor                         valida reglas, catálogo, MCP, métodos y targets
//   chalc configure                      configura rules, skills y MCP de forma interactiva
//   chalc spec                           crea una carpeta/plantilla vacía specs/NNN-feature
//   chalc install <fuente> [--stack id]  instala un skill al catálogo y lo cablea a una regla
//   chalc [ruta] --yes                   sin preguntas: equipa el stack detectado
//   chalc [ruta] --method sdd[:full]     activa un método sin preguntar
//   chalc [ruta] --target claude         elige asistente destino (default: claude)
//   chalc [ruta] --dry-run               muestra el plan sin escribir
//
// <fuente> de install: URL de Git/GitHub, nombre/URL de skills.sh, o ruta local.
// Flujo apply: lee señales del proyecto -> aplica reglas -> resuelve skills/MCP/métodos
// del catálogo -> el target los proyecta a los archivos del asistente. Cero IA, cero tokens.
//
// Entrypoint delgado: el contexto (args/rutas/estilo) vive en lib/commands/context.mjs y
// cada comando en su módulo lib/commands/*.mjs; aquí solo se despacha por tabla.

import { t } from '../lib/i18n.mjs';
import { tokenSummary } from '../lib/tokenmeter.mjs';
import { flushTokenLog, setTokenLogCommand } from '../lib/tokenlog.mjs';
import { c, projectPath, verb } from '../lib/commands/context.mjs';
import { runConfigLang } from '../lib/commands/lang.mjs';
import { runInit, runVerify } from '../lib/commands/init.mjs';
import { runInstall, runConfigure } from '../lib/commands/configure.mjs';
import { runInspect } from '../lib/commands/inspect.mjs';
import { runDoctor } from '../lib/commands/doctor.mjs';
import { runAi, runAiDoctor, runAiEval } from '../lib/commands/ai.mjs';
import { runSpecGen } from '../lib/commands/specgen.mjs';
import { runFeature } from '../lib/commands/feature.mjs';
import { runSpec } from '../lib/commands/spec.mjs';
import { runQa } from '../lib/commands/qa.mjs';
import { runDeliver } from '../lib/commands/deliver.mjs';
import { runTokens } from '../lib/commands/tokens.mjs';
import { runUpdate } from '../lib/commands/update.mjs';
import { runApply } from '../lib/commands/apply.mjs';

// Red de seguridad: nunca mostrar stack traces. Ctrl+C (AbortError) sale limpio.
const onAbortOrError = (e) => {
  if (e && (e.code === 'ABORT_ERR' || e.name === 'AbortError')) { process.stdout.write('\n'); process.exit(130); }
  console.error(c.red('✗ ' + (e && e.message ? e.message : e)));
  process.exit(1);
};
process.on('uncaughtException', onAbortOrError);
process.on('unhandledRejection', onAbortOrError);

// Muestra el consumo de tokens SIEMPRE que se haya consultado la IA en este comando (transparencia de gasto).
function printTokenUsage() {
  const s = tokenSummary();
  if (s.calls > 0) console.log('\n' + c.dim(t('tokensUsed', s.total, s.input, s.output, s.calls)));
}

// Tabla de despacho: verbo (resuelto en context.mjs) → comando. Default: apply.
const COMMANDS = {
  lang: runConfigLang,
  init: runInit,
  verify: runVerify,
  install: runInstall,
  inspect: runInspect,
  doctor: runDoctor,
  configure: runConfigure,
  ai: runAi,
  aidoctor: runAiDoctor,
  aieval: runAiEval,
  specgen: runSpecGen,
  feature: runFeature,
  spec: runSpec,
  qa: runQa,
  deliver: runDeliver,
  tokens: runTokens,
  update: runUpdate,
  apply: runApply
};

// El histórico de consumo lleva el verbo del comando y se persiste SIEMPRE al terminar (éxito o
// error tras pagar tokens), con el projectPath del contexto como fallback — los verbos que
// resuelven su proyecto por dentro (spec-ia, feature, init) fijan la ruta real con setTokenLogProject.
setTokenLogCommand(verb);

(COMMANDS[verb] ?? COMMANDS.apply)()
  .then(async () => {
    printTokenUsage();
    await flushTokenLog(projectPath);
  })
  .catch(async (err) => {
    printTokenUsage();
    await flushTokenLog(projectPath);
    const message = err instanceof Error ? err.message : String(err?.message ?? err);
    console.error(c.red('✗ ' + message));
    process.exit(1);
  });
