# chalc `cli/` — agente de código para modelos locales

Agente de código conversacional (estilo Claude Code / Codex CLI) que corre sobre
**modelos locales limitados** (`qwen2.5-coder:7b/14b`, `deepseek-coder-v2:16b` vía Ollama)
y se **acopla a un proyecto ya equipado por chalc** (skills, MCP, reglas, SDD).

Todo el CLI vive bajo `cli/` y reutiliza lo compartido desde `../lib`
(`ai.mjs`, `ccr.mjs`, `tokenmeter.mjs`, `promptkit.mjs`, `net.mjs`, `securefile.mjs`).
Cero dependencias npm, igual que el resto de chalc.

## Principio rector: minimizar tokens en TODA dirección

Los modelos locales tienen ventana chica y se degradan al llenarse. Por eso:

- Prompt del sistema mínimo. **Una acción por turno**, JSON compacto (no tool-calling nativo).
- Observaciones voluminosas → **CCR** (`../lib/ccr.mjs`): se difieren a `[CCR ref=…]` y se
  recuperan con `recall(ref)` solo si el modelo las necesita.
- Esquemas de tools (fs/shell + MCP) → **índice compacto** siempre visible; el esquema completo
  se difiere y se expande con `describe(tool)` solo antes de usarla.
- Skills → solo el `SKILL.md`; los `references/` vía `recall`.
- **Budgeter pre-vuelo**: estima tokens y prioriza qué entra ANTES de llamar (no solo medir después).
- Forzar `num_ctx` en Ollama (por defecto 2048 → subir a 8–16K).

## Acople al proyecto equipado (`.chalc.json`)

El ancla es el manifiesto que chalc deja en la raíz:

```jsonc
{ "target":"claude", "stacks":["angular"], "skills":["angular-signals","clean-code"],
  "mcp":["postgres"], "methods":["sdd:lite"], "generatedAt":"..." }
```

Según `target`, el contenido real vive en rutas conocidas:

Rutas VERIFICADAS contra `targets/*.mjs` (solo claude usa `.claude/skills`; el resto la carpeta neutra `.chalc/skills`):

| target  | skills            | MCP (archivo → clave)            | reglas (archivo)                    |
|---------|-------------------|----------------------------------|-------------------------------------|
| claude  | `.claude/skills`  | `.mcp.json` → `mcpServers`       | `CLAUDE.md`                         |
| cursor  | `.chalc/skills`   | `.cursor/mcp.json` → `mcpServers`| `.cursor/rules/*.mdc` (sin archivo único → null) |
| copilot | `.chalc/skills`   | `.vscode/mcp.json` → `servers`   | `.github/copilot-instructions.md`   |
| gemini  | `.chalc/skills`   | `.gemini/settings.json` → `mcpServers` | `GEMINI.md`                    |

Constitución (`specs/constitution.md`) y arquitectura (`docs/architecture.md`) son contenido de proyecto,
independientes del target, y sirven de reglas base cuando el target no tiene un archivo de instrucciones único.

`cli/project.mjs` lee `.chalc.json`, resuelve esas rutas por target y expone
skills / MCP / reglas / constitución / arquitectura al motor.

## Estructura

```
cli/
  index.mjs            # REPL; arranca leyendo .chalc.json del cwd
  project.mjs          # ACOPLE: .chalc.json → target, skills, mcp, reglas
  engine/
    loop.mjs           # motor genérico (generaliza runQaAgent)
    protocol.mjs       # JSON-en-texto: parse + validación + reintento
    budgeter.mjs       # arma el prompt dentro de un presupuesto (usa CCR)
    history.mjs        # historial + compactación (sliding/summarize)
  tools/
    registry.mjs read.mjs write.mjs edit.mjs list.mjs grep.mjs bash.mjs
  mcp/
    client.mjs         # cliente MCP stdio/JSON-RPC (nativo, cero deps)
    astools.mjs        # expone tools MCP equipadas al agente
  skills/
    loader.mjs         # lee las skills equipadas del proyecto (no el catálogo)
  ui/
    repl.mjs approve.mjs
```

## Protocolo del turno (compacto, para modelos chicos)

El modelo responde SIEMPRE un único JSON:

```json
{"thought":"...","action":{"tool":"read","args":{"path":"src/x.js"}}}
```
```json
{"done":true,"summary":"..."}
```

Acciones especiales servidas sin ejecutar nada externo:
- `{"action":{"tool":"recall","args":{"ref":"c3"}}}`      → expande una referencia CCR.
- `{"action":{"tool":"describe","args":{"tool":"query"}}}` → expande el esquema de una tool.

`protocol.mjs` parsea robustamente (quita ``` y toma del primer `{` al último `}`),
valida el esquema y, si es inválido, **reintenta con el error como feedback**.

## Alcance actual: SOLO CLI

Se construye únicamente la shell de terminal. El motor (`engine/`) se mantiene **agnóstico de interfaz**
por buena práctica (emite eventos por `onStep`; no conoce terminal ni proveedores), así una eventual shell
web sería un añadido posterior sin tocar el motor — pero HOY no se construye.

## Fases

- **F0 — Fundaciones.** ✅ `engine/model.mjs`: ruta nativa Ollama `/api/chat` con `num_ctx` + `format:json` (no toca `ai.mjs`); cloud reutiliza `chat()`. `createChatImpl` da la firma del loop.
- **F1 — Acople + motor.** `project.mjs` ✅ (`loadProject` + `inspectProject`: manifiesto + detección viva de git/skills/MCP reales + asistentes, reutiliza `lib/gitprep`) · `engine/protocol.mjs` ✅ · `engine/loop.mjs` ✅ (con tests).
- **F2 — Herramientas fs/shell** ✅ `tools/fs.mjs` (read/list/grep/write/edit, confinadas a la raíz) · `tools/shell.mjs` (bash: allowlist + sin metacaracteres + aprobación) · `tools/registry.mjs` (con tests).
- **F3 — MCP como tools** (cliente stdio nativo; índice compacto + `describe` diferido).
- **F4 — Contexto** ✅ `engine/budgeter.mjs` (estima tokens + arma dentro del presupuesto) · `engine/harness.mjs` (`createRenderPrompt`: protocolo + índice de tools + contexto de proyecto acotado + historial). `session.mjs` ata todo (`runTask`), probado de punta a punta con modelo simulado.
- **F5 — Skills desde el proyecto equipado** ✅ `skills/loader.mjs`: índice compacto (siempre) + `SKILL.md` completo de las relevantes a la tarea (opcional, budget-bounded); obligatorias (clean-code/SOLID/…) siempre; `references/` en disco vía `read`. Cableado por-tarea en `session.ask`. Bilingüe.
- **F6 — CLI interactivo (estilo Claude Code)** ✅ `index.mjs` + bin `chalc-cli`: pide la ruta, carga el proyecto y abre una **sesión conversacional continua** (`createSession`/`ask`, contexto entre mensajes vía resúmenes + CCR compartido). **Dos front-ends misma lógica de turno** (`runTurn`): **TUI** (`ui/screen.mjs` — título arriba, salida con scroll, caja de entrada FIJA abajo; pantalla alterna + región de scroll + editor raw, cero deps; `CHALC_TUI=0` la desactiva) e **inline** (fallback no-TTY: `ui/render.mjs` banner + caja de contexto + `ui/spinner.mjs`). Aprobación por acción con opción "todo" (a); tools tolerantes a sinónimos de args; allowlist de bash por defecto. **No quema modelos**.
- **F3 — MCP como tools** ✅ `mcp/jsonrpc.mjs` (JSON-RPC 2.0 puro) + `mcp/client.mjs` (stdio nativo, handshake, sin deps) + `mcp/astools.mjs` (servidores tomados del `.mcp.json` del proyecto → tools `mcp__server__tool`, índice compacto + `describe` diferido + aprobación). Cableado y cerrado en `session` (`close()`).
- **F7 — Endurecimiento + evals** ✅ loop resiliente a fallos de `chatImpl` (red/servidor) con reintento dentro del paso; evals de robustez con salidas "sucias" de modelo local (cercado ```, prosa, primer intento inválido); `README.md`. Prueba en vivo por-modelo (7b/14b/16b): la corre el usuario con su Ollama.

## Notas técnicas

- **Ollama `num_ctx`**: la ruta OpenAI-compatible (`/v1/chat/completions`) no lee `options`.
  Para fijar el contexto de forma fiable el motor usa la ruta nativa `/api/chat`
  con `options:{num_ctx}`, o exporta `OLLAMA_CONTEXT_LENGTH`. Se decide en F0.
- **Seguridad**: `bash` y las tools de escritura piden aprobación y respetan allowlist,
  mismo instinto que `allowedMethods`/`allowedPaths` de `httpExecutor` en `qaagent.mjs`.
- **Testeo sin tokens**: `chatImpl` y los executors son inyectables (patrón ya usado en `runQaAgent`).
