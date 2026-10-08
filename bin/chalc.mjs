#!/usr/bin/env node
// ⚙️ chalc — equipa cualquier proyecto con skills/MCP/métodos correctos. Interactivo, sin IA.
//
// Uso:
//   chalc [rutaProyecto]                 modo interactivo (te pregunta qué montar)
//   chalc inspect [rutaProyecto]         explica qué detecta y por qué, sin escribir
//   chalc doctor                         valida reglas, catálogo, MCP, métodos y targets
//   chalc configure                      configura rules, skills y MCP de forma interactiva
//   chalc spec                           crea una carpeta/plantilla vacía specs/NNN-feature
//   chalc dashboard [carpeta]            monitoreo solo-lectura de los workspaces (modo worktree)
//   chalc debate "<idea>"                dos modelos discuten tu idea y dejan un informe descargable
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
import { argError, c, dryRun, flags, projectPath, verb } from '../lib/commands/context.mjs';
import { CommandExit } from '../lib/commands/exit.mjs';
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
import { runDashboard } from '../lib/commands/dashboard.mjs';
import { runApply } from '../lib/commands/apply.mjs';
import { runDebate } from '../lib/commands/debate.mjs';

// Salida con código SIN matar el proceso a mitad de camino: en Windows, un process.exit() justo
// después de una llamada HTTP (fetch/undici con sockets aún cerrándose) revienta libuv con
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c". Fijando exitCode el
// loop se vacía solo y el proceso termina limpio con el mismo código.
const exitWith = (code) => { process.exitCode = code; };

// Red de seguridad: nunca mostrar stack traces. Ctrl+C (AbortError) sale limpio.
const onAbortOrError = (e) => {
  if (e instanceof CommandExit) return exitWith(e.exitCode);
  if (e && (e.code === 'ABORT_ERR' || e.name === 'AbortError')) { process.stdout.write('\n'); return exitWith(130); }
  console.error(c.red('✗ ' + (e && e.message ? e.message : e)));
  exitWith(1);
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
  dashboard: runDashboard,
  debate: runDebate,
  apply: runApply
};

// Los comandos con simulación real. Los demás aceptaban `--dry-run` (es un flag global) y lo
// ignoraban: `feature --dry-run` hacía git fetch, equipaba repos, gastaba tokens y creaba ramas.
// Mejor rechazarlo ANTES de hacer nada que prometer una simulación que no existe. Los de solo
// lectura (inspect, doctor, tokens) no escriben, así que el flag no cambia nada en ellos.
const DRY_RUN_COMMANDS = new Set(['apply', 'init', 'specgen', 'debate', 'inspect', 'doctor', 'tokens']);

// El histórico de consumo lleva el verbo del comando y se persiste SIEMPRE al terminar (éxito o
// error tras pagar tokens), con el projectPath del contexto como fallback — los verbos que
// resuelven su proyecto por dentro (spec-ia, feature, init) fijan la ruta real con setTokenLogProject.
setTokenLogCommand(verb);

// `--help`/`-h`, o una flag que no existe: la ayuda, sin trazas de Node (2 = uso incorrecto).
const showUsage = (code) => async () => {
  if (argError) console.error(c.red('✗ ' + argError.message));
  (code ? console.error : console.log)(t('usage'));
  exitWith(code);
};

const run = argError ? showUsage(2)
  : flags.help ? showUsage(0)
  : dryRun && !DRY_RUN_COMMANDS.has(verb)
  ? async () => { console.error(c.red('✗ ' + t('dryRunUnsupported', verb))); exitWith(2); }
  : (COMMANDS[verb] ?? COMMANDS.apply);

run()
  .then(async () => {
    printTokenUsage();
    await flushTokenLog(projectPath);
  })
  .catch(async (err) => {
    printTokenUsage();
    await flushTokenLog(projectPath);
    // Un comando que termina con un código (CommandExit) ya dijo lo que tenía que decir.
    if (err instanceof CommandExit) return exitWith(err.exitCode);
    if (err && (err.code === 'ABORT_ERR' || err.name === 'AbortError')) { process.stdout.write('\n'); return exitWith(130); }
    const message = err instanceof Error ? err.message : String(err?.message ?? err);
    console.error(c.red('✗ ' + message));
    exitWith(1);
  });
