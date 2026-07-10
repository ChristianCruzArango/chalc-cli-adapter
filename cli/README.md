# chalc-cli — agente de código para modelos locales

Agente de código conversacional (estilo Claude Code) que corre sobre **modelos locales limitados**
(Ollama: `qwen2.5-coder:7b/14b`, `deepseek-coder-v2:16b`, …) y se **acopla a un proyecto ya equipado
por chalc** (skills, MCP, reglas, SDD). Cero dependencias npm; reutiliza `../lib`.

> Diseño y fases en [`PLAN.md`](./PLAN.md).

## Uso

Dentro de un proyecto equipado por chalc (`chalc` deja un `.chalc.json`):

```bash
chalc-cli                 # pide la ruta, carga el proyecto y abre una sesión interactiva
chalc-cli /ruta/proyecto  # o pasas la ruta directa
```

Arranca así:

```
chalc-cli · qwen2.5-coder:7b (ollama) · /ruta/proyecto
  target: claude
  stacks: angular
  skills: angular-signals, clean-code
  MCP conectados: postgres
  git: rama develop (limpio)

Escribe una instrucción. /exit para salir.

› agrega validación al login
  → read  {"path":"src/login.ts",...}
  → edit  ¿Aprobar edit src/login.ts: "..." → "..."? [y/N] y
✔ añadí validación de email y password
  tokens: 3120 in / 240 out (3 llamadas)
```

La sesión es **continua**: cada mensaje mantiene el contexto de los anteriores.

### Ver los agentes mientras trabajan

En la TUI, `/agents` es un comando de observación fuera de banda: responde inmediatamente aunque el
líder, desarrollador o revisor esté ejecutando una tarea. No pausa ni interrumpe el turno y la caja de
entrada permanece disponible. El panel muestra estado, duración, modelo, tarea y última herramienta real
utilizada; nunca expone el razonamiento privado del modelo.

```text
/agents

╭─ AGENTES ─────────────────────────────────────────────────╮
│ ● Desarrollador trabajando       00:18  qwen (ollama)     │
│   └─ edit cli/index.mjs                                  │
│ ○ Líder        inactivo          --:--                    │
│ ○ Revisor      inactivo          --:--                    │
╰────────────────────────────────────────────────────────────╯
```

## Configuración

Usa **exactamente** el proveedor/modelo que fijaste con `chalc config-ia` (o env `CHALC_PROVIDER`/`CHALC_MODEL`).
**No hardcodea ningún modelo**: si no hay uno configurado, aborta y te manda a `config-ia`.

Opcional, en `~/.chalc/config.json`:

```jsonc
{
  "provider": "ollama",
  "model": "qwen2.5-coder:7b",   // lo eliges tú
  "cli": {
    "trust": "dev",                    // safe | dev | trusted (perfil del shell)
    "allow": ["git", "npm", "node"],  // comandos que la tool bash puede correr (vacío = bash deshabilitado)
    "mcpApproval": "always",          // always (default) | mutating (solo MCP confiables)
    "mcpEnvAllowlist": ["CHALC_MCP_DB_URL"], // secretos que este usuario permite resolver al proyecto
    "allowPrivateMcpHttp": false,      // solo el usuario local puede habilitar HTTP privado/loopback
    "numCtx": 16384,                  // ventana de Ollama (sube del default 2048)
    "budgetTokens": 6000,             // presupuesto de tokens del prompt
    "maxSteps": 12                    // pasos máximos por tarea
  }
}
```

Idioma: sigue `chalc lang` (es/en). Todo el prompt del agente es bilingüe.

## Cómo mantiene el contexto chico (modelos locales)

- **Una acción por turno**, JSON compacto (no tool-calling nativo).
- **CCR** difiere las observaciones voluminosas a `[CCR ref=…]`; el modelo las expande con `recall` solo si las necesita.
- **Budgeter** decide qué entra en el prompt ANTES de llamar (prioridad: protocolo → tarea → tools → skills → contexto).
- **Skills**: índice compacto siempre; el `SKILL.md` completo solo de las relevantes; `references/` se leen con `read` a demanda.
- **MCP**: índice compacto de tools; el esquema completo se pide con `describe` solo antes de usar la tool.

## Todo se toma del proyecto (nada hardcodeado)

| Recurso | Origen |
|---|---|
| provider / model | tu `config-ia` |
| skills | `.claude/skills` o `.chalc/skills` equipadas |
| servidores MCP | `.mcp.json` / `.cursor/mcp.json` / … del proyecto |
| reglas / constitución | `CLAUDE.md`, `specs/constitution.md` |
| stacks / git | detectados del proyecto |

## Seguridad

- Filesystem confinado a la raíz del proyecto (sin path traversal).
- `write`/`edit`/`bash` piden **aprobación** por acción.
- MCP pide aprobación por servidor al conectar y por acción según `cli.mcpApproval`: `always` pregunta por toda llamada (default); `mutating` se reserva para servidores confiables. No hay llamadas MCP automáticas al abrir el proyecto.
- `bash`: perfil de confianza + allowlist + ejecución sin shell en POSIX (argv estructurado) + guard
  léxico de rutas (bloquea `..`, `~`/`~usuario` y rutas absolutas posicionales, también tras `--`).
- `/auto` (auto-aprobación) tiene una **excepción deliberada**: los comandos capaces de ejecutar código
  arbitrario (`node`/`python`/`npx`/`ruby`/`php` y `npm|pnpm|yarn|bun run·exec·dlx·x`) piden
  confirmación SIEMPRE — sin ese freno, `/auto` + perfil `dev` anularía la única defensa real del shell.

## Módulos

```
index.mjs        REPL interactivo (shell de terminal)
session.mjs      createSession/ask: ata proyecto + tools + harness + modelo + loop
project.mjs      acople: .chalc.json + detección de git/skills/MCP
agents/
  registry.mjs   estado observable de ejecuciones (rol, tarea, tool, tiempo, estado/error)
engine/
  loop.mjs       motor plan→acción→observación (+ CCR, reintentos)
  protocol.mjs   contrato JSON del turno
  harness.mjs    arma el prompt (renderPrompt)
  budgeter.mjs   presupuesto de tokens
  model.mjs      adaptador Ollama (num_ctx) / cloud
  text.mjs       textos del prompt (es/en)
tools/           read/list/grep/write/edit/bash (confinadas, con aprobación)
skills/loader.mjs  skills equipadas → secciones del harness
mcp/             cliente MCP stdio nativo → tools del agente
ui/
  screen.mjs     TUI con entrada fija, historial y comandos fuera de banda
  render.mjs     componentes ANSI compartidos
  agents.mjs     gráfico adaptativo para `/agents`
```
