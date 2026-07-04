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

## Configuración

Usa **exactamente** el proveedor/modelo que fijaste con `chalc config-ia` (o env `CHALC_PROVIDER`/`CHALC_MODEL`).
**No hardcodea ningún modelo**: si no hay uno configurado, aborta y te manda a `config-ia`.

Opcional, en `~/.chalc/config.json`:

```jsonc
{
  "provider": "ollama",
  "model": "qwen2.5-coder:7b",   // lo eliges tú
  "cli": {
    "allow": ["git", "npm", "node"],  // comandos que la tool bash puede correr (vacío = bash deshabilitado)
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
- `write`/`edit`/`bash` y **toda** llamada MCP piden **aprobación** por acción.
- `bash`: allowlist + sin metacaracteres de shell (un comando por acción).

## Módulos

```
index.mjs        REPL interactivo (shell de terminal)
session.mjs      createSession/ask: ata proyecto + tools + harness + modelo + loop
project.mjs      acople: .chalc.json + detección de git/skills/MCP
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
```
