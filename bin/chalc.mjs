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
import { VERBS } from '../lib/commands/verbs.mjs';
import { failureCode, installFatalHandlers } from '../lib/fatal.mjs';

// Salida con código SIN matar el proceso a mitad de camino: en Windows, un process.exit() justo
// después de una llamada HTTP (fetch/undici con sockets aún cerrándose) revienta libuv con
// "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), src\win\async.c". Fijando exitCode el
// loop se vacía solo y el proceso termina limpio con el mismo código.
const exitWith = (code) => { process.exitCode = code; };

// Red de seguridad: nunca mostrar stack traces. Ctrl+C (AbortError) sale limpio. Una excepción no
// capturada TERMINA el proceso (lib/fatal.mjs): su estado ya no es fiable. Solo aquí, en el entrypoint,
// se usa process.exit.
const printFailure = (message) => console.error(c.red('✗ ' + message));
const newline = () => process.stdout.write('\n');
installFatalHandlers({ print: printFailure, exit: (code) => process.exit(code) });

// Muestra el consumo de tokens SIEMPRE que se haya consultado la IA en este comando (transparencia de gasto).
function printTokenUsage() {
  const s = tokenSummary();
  if (s.calls > 0) console.log('\n' + c.dim(t('tokensUsed', s.total, s.input, s.output, s.calls)));
}

// El comando sale del registro único (lib/commands/verbs.mjs, M-04): alias, simulación y proyecto se
// declaran allí. Un comando sin simulación real rechaza `--dry-run` ANTES de hacer nada: aceptarlo e
// ignorarlo hacía que `feature --dry-run` hiciese git fetch, equipase repos, gastase tokens y crease
// ramas. Se carga solo el comando que se ejecuta.

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
  : dryRun && !VERBS[verb].dryRun
  ? async () => { console.error(c.red('✗ ' + t('dryRunUnsupported', verb))); exitWith(2); }
  : async () => (await VERBS[verb].load())();

run()
  .then(async () => {
    printTokenUsage();
    await flushTokenLog(projectPath);
  })
  .catch(async (err) => {
    printTokenUsage();
    await flushTokenLog(projectPath);
    // Mismo criterio que los manejadores: CommandExit con su código, Ctrl+C con 130, el resto con 1.
    exitWith(failureCode(err, { print: printFailure, newline }));
  });
