# ⚙️ Chalc

Equipa cualquier proyecto con las skills y servidores MCP correctos — **el núcleo es sin IA, sin tokens, sin CLI pesado**.

Surtes tu Chalc **una vez** con las herramientas que te gustan; él lee el proyecto y *apareja* solo lo que aplica, en el formato del asistente que elijas (Claude, Copilot, Cursor, Gemini…).

Además trae una **capa de IA opcional** (`chalc spec-ia`) que, con TU API key, convierte una historia de usuario (Word, Azure DevOps, Jira, Drive…) en una especificación **SDD** lista para implementar. La IA es opt-in: el núcleo nunca la necesita.

## Idea en una frase

> Chalc no adivina lo que el proyecto necesita: **aplica reglas que tú escribes una vez**. La curación del catálogo es el producto. La IA es opcional y la pone quien lo use.

## Comandos (referencia rápida)

| Comando | Qué hace | ¿IA? |
|---|---|---|
| `chalc` | Detecta el stack y equipa skills/MCP/método (interactivo) | no |
| `chalc inspect` | Explica qué detecta y por qué, sin escribir | no |
| `chalc doctor` | Valida el catálogo (rules, skills, MCP, métodos, targets) | no |
| `chalc configure` | Administra el catálogo (rules/skills/MCP) por menú | no |
| `chalc install <fuente>` | Instala un skill al catálogo y lo cablea a una regla | no |
| `chalc spec` | Crea una carpeta/plantilla vacía `specs/NNN-feature` | no |
| `chalc config-ia` | Configura el proveedor de IA + API key (una vez) | sí (setup) |
| `chalc spec-ia` | HU (Azure DevOps/Jira/Drive/Word/pegar) → spec/plan/tasks | sí |

Cada comando tiene su equivalente `npm run <comando>` (ej. `npm run spec-ia`) por si no haces `npm link`.
Todo el CLI es **bilingüe (es/en)** según el idioma del sistema operativo.

## Cómo se usa (la idea: descargar, un comando, interactivo)

**Una sola vez** — dentro de la carpeta `chalc/`, instala el comando global:
```bash
npm link        # crea el comando `chalc` en todo tu sistema
```

**Después, en cualquier proyecto:**
```bash
cd mi-proyecto
chalc             # detecta el lenguaje/stack y te pregunta qué montar (interactivo)
```

Eso es todo. `chalc` te guía: elige asistente (Claude…), confirma el stack, activa métodos (SDD…) y aplica.

### Sin instalar nada (desde la carpeta chalc)
```bash
npm start                          # equipa la carpeta actual
npm start -- /ruta/al/proyecto     # equipa otro proyecto
npm run inspect -- /ruta/al/proyecto
npm run doctor
npm run configure
npm run spec
```

### Banderas (para automatizar / sin preguntas)
```bash
chalc inspect               # explica qué detecta y por qué, sin escribir
chalc doctor                # valida reglas, catálogo, MCP, métodos y targets
chalc configure             # crea rules y conecta skills/MCP de forma guiada
chalc spec                  # crea una plantilla vacía specs/NNN-feature
chalc --yes                 # usa los valores por defecto, sin preguntar
chalc --method sdd          # activa el método SDD sin preguntar
chalc --dry-run             # muestra el plan sin escribir nada
chalc --target claude       # elige el asistente destino
chalc install <fuente> --force  # reemplaza un skill existente sin preguntar
```

### Entender antes de aplicar
```bash
chalc inspect /ruta/al/proyecto
```

`inspect` es interactivo por defecto y no escribe archivos: te pregunta qué detalle quieres ver,
lista las reglas que aplican, las señales que las activaron (`package.json`, archivos raíz o globs
como `*.csproj`) y el plan base que `chalc --yes` montaría. En entornos no interactivos imprime el
diagnóstico completo.

### Revisar la salud del Chalc
```bash
chalc doctor
```

`doctor` es interactivo por defecto y valida que el catálogo esté consistente: reglas JSON,
referencias a skills/MCP, frontmatter básico de skills, métodos y targets cargables. En modo
no interactivo (`chalc doctor --yes`) sale con código `1` si encuentra errores, útil para CI.

### Preparar una plantilla de spec
```bash
chalc spec
```

La ruta oficial es `specs/` en plural. `chalc spec` **no redacta la especificación**:
solo crea la carpeta y copia plantillas vacías con placeholders. Cada feature vive en
`specs/NNN-nombre/` con `spec.md`, `plan.md` y `tasks.md` (más archivos extra en modo `full`).
La spec real la escribe una persona o un asistente después, dentro de `spec.md`.

## Cómo funciona

```
proyecto  ──►  detecta señales        ──►  aplica reglas      ──►  target proyecta
               (package.json, archivos)     (rules/*.json)          los archivos del asistente
```

1. **Detecta** el stack por señales reales (`@angular/core`, `nest-cli.json`, etc.), incluyendo proyectos anidados típicos de monorepos.
2. **Resuelve** del `catalog/` las skills + MCP que la regla indica.
3. **Proyecta** con el `target` elegido a los archivos correctos.

## Estructura

```
chalc/
├── bin/chalc.mjs          el motor / CLI (Node puro, sin dependencias)
├── lib/                 módulos del motor
│   ├── i18n.mjs         textos bilingües (es/en)
│   ├── install.mjs      instalar/vendorizar skills (Git/skills.sh/local)
│   ├── targetkit.mjs    utilidades compartidas por los targets
│   ├── ai.mjs           cliente multi-proveedor de IA (fetch) + config ~/.chalc
│   ├── docread.mjs      extrae texto de Word/PDF/CSV/…
│   ├── sources.mjs      trae la HU de Azure DevOps / Jira / Drive
│   ├── specgen.mjs      orquesta la generación del spec
│   └── prompts/spec-gen.prompt.xml   el system prompt (harness de fidelidad)
├── catalog/
│   ├── skills/          las skills reales (autocontenidas, portátiles)
│   ├── mcp/             definiciones de servidores MCP
│   └── methods/sdd/     el método SDD (constitución, plantillas es/en, reglas, gráfico)
├── rules/               criterio: qué señal = qué stack = qué se instala (incl. global.json)
└── targets/
    ├── claude.mjs       traductor a Claude Code
    ├── copilot.mjs      traductor a GitHub Copilot
    ├── cursor.mjs       traductor a Cursor
    └── gemini.mjs       traductor a Gemini CLI
```

## Qué genera (target Claude)

| Concepto | Archivo en el proyecto |
|---|---|
| Skills | `.claude/skills/<id>/` (copia real) |
| MCP | `.mcp.json` (fusionado, no pisa lo existente) |
| Reglas/stack | `CLAUDE.md` (bloque gestionado entre `<!-- chalc:start -->` y `<!-- chalc:end -->`) |
| Manifiesto | `.chalc.json` (qué se instaló y cuándo) |

## Extender Chalc

- **Nuevo stack / lenguaje** → crea `rules/<id>.json` con su `detect` (`anyDependency`/`anyFile`/`anyGlob` o las variantes `all*`), `skills`, `mcp`. Un stack específico puede `"implies": ["javascript", …]` para suprimir lenguajes genéricos en el display.
- **Nueva skill** → copia la carpeta a `catalog/skills/<id>/` y referénciala en una regla (o usa `chalc install` / `chalc configure`).
- **Skill universal** → agrégalo a `rules/global.json` (`always:true`) para que lo reciba todo proyecto (así está `mutation-testing`).
- **Nuevo MCP** → crea `catalog/mcp/<id>.json`.
- **Nuevo asistente** → crea `targets/<nombre>.mjs` con un `apply()` que escriba los archivos de esa herramienta. El catálogo y las reglas se reutilizan tal cual.
- **Nuevo método** → carpeta en `catalog/methods/<id>/` con `method.json` (label/description/explain/modes, todo `{es,en}`), reglas y scaffold por modo.
- **Nuevo idioma del CLI** → agrega la clave (`pt`, …) en `lib/i18n.mjs` y los archivos `*.pt.*` / `scaffold-*-pt` del método.

## Multilenguaje

Chalc detecta el **lenguaje/stack** por señales reales y se adapta:

| Grupo | Reglas incluidas | Estado |
|---|---|---|
| Web/TypeScript | JavaScript, TypeScript, Angular, NestJS | Angular/NestJS con skills; JS/TS detecta |
| Mobile | Flutter, Dart, Swift, Kotlin | detecta |
| Backend/General | .NET, Go, Java, PHP, Ruby, Python, Rust, Elixir | detecta |
| Sistemas/IaC | C, C++, Shell, Terraform, Zig | detecta |
| Otros ecosistemas | Clojure, Erlang, Haskell, Julia, Lua, Perl, R, Scala | detecta |

Agregar un lenguaje = crear `rules/<lang>.json` con su `detect`. Soporta:
- `anyDependency`, `anyFile`, `anyGlob`: basta con una señal.
- `allDependency`, `allFile`, `allGlob`: todas esas señales deben estar presentes.

## Configurar catálogo (rules, skills y MCP)

La forma recomendada de mantener Chalc es interactiva:

```bash
npm run configure
# o, si hiciste npm link:
chalc configure
```

`configure` abre un menú para administrar el catálogo sin editar JSON a mano:

| Opción | Qué hace | Dónde escribe |
|---|---|---|
| Crear una rule nueva | Crea una regla de detección por archivos, globs o dependencias | `rules/<id>.json` |
| Instalar skill y agregarlo a una rule | Descarga/copia el skill al catálogo y luego pregunta a qué rule conectarlo | `catalog/skills/<id>/` + `rules/<id>.json` |
| Agregar skill existente a una rule | Busca un skill ya instalado y lo agrega a `skills` de la rule elegida | `rules/<id>.json` |
| Registrar MCP nuevo | Crea la definición del servidor MCP | `catalog/mcp/<id>.json` |
| Agregar MCP existente a una rule | Busca un MCP y lo agrega a `mcp` u `optionalMcp` de la rule elegida | `rules/<id>.json` |

El selector de rules incluye búsqueda por `id`, nombre o lenguaje. Por ejemplo puedes escribir
`angular`, `TypeScript`, `nest`, `python`, etc., y luego elegir la rule con flechas.

### Flujo típico: agregar una skill

```bash
npm run configure
```

1. Elige **Instalar skill y agregarlo a una rule**.
2. Pega la fuente: URL de GitHub, nombre de `skills.sh`, ruta local o el comando completo `npx skills add ...`.
3. Chalc copia/vendoriza el skill a `catalog/skills/<id>/`. Ese es el destino permanente.
4. Chalc pregunta si quieres conectarlo a una rule.
5. Buscas la rule destino y Chalc actualiza `rules/<id>.json`.

Si el skill ya existe, Chalc pregunta antes de reemplazarlo. En modo directo/no interactivo puedes usar:

```bash
chalc install <fuente> --stack angular
chalc install <fuente> --stack angular --force
```

También puedes pegar comandos completos del nuevo CLI de skills:

```bash
chalc install "npx skills add https://github.com/wshobson/agents --skill angular-migration"
```

### Flujo típico: agregar un MCP

```bash
npm run configure
```

1. Elige **Registrar MCP nuevo**.
2. Define `id`, descripción, comando y argumentos.
3. Si requiere secretos, agrega la variable/env correspondiente.
4. Chalc escribe `catalog/mcp/<id>.json`.
5. Puedes conectarlo inmediatamente a una rule como obligatorio (`mcp`) u opcional (`optionalMcp`).

Ejemplo conceptual de MCP:

```json
{
  "id": "postgres",
  "description": "Servidor MCP de PostgreSQL",
  "requiresSecret": true,
  "server": {
    "command": "node",
    "args": ["${PROJECT}/.chalc/mcp/postgres/dist/index.js"],
    "env": {
      "DB_ENV_FILE": "${PROJECT}/.env.local"
    }
  }
}
```

Después de configurar, revisa la salud del catálogo:

```bash
npm run doctor -- --yes
```

## Instalar skills nuevos (lo que mantiene vivo el sistema)

Los skills de skills.sh (o de cualquier marketplace) caen en `~/.claude/skills`, **nunca** en el catálogo de Chalc.
Por eso Chalc los instala en un temporal, lo **copia al catálogo** (dereferenciando symlinks) y lo
**cablea a una regla** preguntándote a qué stack pertenece. Así las reglas se llenan con el uso.

```bash
chalc install <fuente> [--stack <id>]
```

`<fuente>` puede ser:
- **URL de Git/GitHub** — `https://github.com/owner/repo`, `.../tree/<rama>/<subcarpeta>`, o `*.git`.
- **skills.sh** — un nombre/URL; Chalc usa `npx skills add` por dentro y vendoriza el resultado.
- **Ruta local / carpeta** — copia directa al catálogo.

Tras instalar, Chalc pregunta **a qué stack pertenece** (Angular, Nest, … o *Global* = todos los proyectos)
y escribe el skill en `rules/<stack>.json`. Desde ese momento, todo proyecto de ese stack lo recibe.
Si el skill ya existe, Chalc pregunta antes de reemplazarlo; en modo no interactivo debes usar `--force`.
Cada skill vendorized incluye `.chalc-skill.json` con fuente, fecha y hash del contenido.

> También puedes instalar **dentro del flujo interactivo** (`chalc`): te ofrece *"¿Instalar un skill nuevo?"*,
> lo cablea a una regla y lo equipa de una vez en el proyecto actual.

## Métodos de trabajo

Además de skills/MCP por stack, Chalc puede montar **métodos** (formas de trabajar), independientes del lenguaje.

### Spec-Driven Development (SDD)

La **especificación es la fuente de verdad**, no el código. Basado en GitHub Spec Kit + AWS Kiro.
Cinco fases en orden: **Constitución → Specify → Plan → Tasks → Implement**.

- **EARS**: los requisitos se escriben testeables — `WHEN <evento> THE SYSTEM SHALL <comportamiento>` — con id (`R1`, `R2`…).
- **Test-First (innegociable)**: ningún código antes de un test que **falle** (Red), aprobado. Luego el mínimo código (Green), refactor.
- **Mutation testing**: tras Green/refactor, los tests deben **matar mutantes** (score ≥ 80%). Ver sección *Test-First + Mutation testing*.
- **Trazabilidad**: cada tarea y cada test apunta a un requisito (`R#`).

Al elegirlo en el modo interactivo, Chalc **muestra un gráfico breve** explicando SDD antes de integrarlo, y pregunta el **tamaño del proyecto**:

| Modo | Para | Monta en `specs/` |
|---|---|---|
| `lite` | proyectos pequeños | `constitution.md` + `_template/{spec,plan,tasks}.md` |
| `full` | proyectos grandes | lo anterior + `research.md`, `data-model.md`, `contracts/`, `quickstart.md` |

El método se inyecta en el archivo del asistente (`CLAUDE.md`, etc.) como reglas, y deja `specs/` en el proyecto.
Sin interactivo: `chalc --method sdd:lite` o `chalc --method sdd:full` (o `--mode lite|full`).
La constitución, plantillas y reglas están en **es y en** (siguen el idioma del sistema).

## Capa de IA opcional — generar specs desde una HU

El núcleo de Chalc no usa IA. Pero dos comandos **opt-in** (con tu API key) convierten una historia de
usuario en una especificación SDD. La IA aquí **solo estructura** lo que le pasas — no inventa.

### 1) `chalc config-ia` — configurar el cerebro (una vez)

```bash
chalc config-ia        # o: npm run config-ia
```

Elige el proveedor de LLM y pega tu API key:

| Proveedor | Notas |
|---|---|
| **OpenRouter** | una sola key → Claude, GPT, Gemini, Llama… (recomendado) |
| **Anthropic** | Claude nativo |
| **OpenAI** | GPT |
| **Google Gemini** | Gemini |
| **Ollama** | local, sin key |

La config se guarda en `~/.chalc/config.json` (permisos `600`, **fuera del proyecto**, nunca se commitea).
La key se teclea **enmascarada**. Override por entorno: `CHALC_PROVIDER`, `CHALC_API_KEY`, `CHALC_MODEL`, `CHALC_BASE_URL`.
Cliente HTTP con `fetch` nativo, cero dependencias.

> **Copilot no es proveedor de generación** (no expone API con key) — es un *destino*. Para generar usa
> OpenRouter / Anthropic / OpenAI / Gemini / Ollama.

### 2) `chalc spec-ia` — HU → spec/plan/tasks

```bash
chalc spec-ia                                   # interactivo
chalc spec-ia /ruta/proyecto --lang es --doc mi-hu.docx
```

Flujo:
1. **Ruta del proyecto.** Si no tiene SDD, Chalc **lo monta al vuelo** (`specs/` con constitución + plantillas).
2. **Idioma del spec** (independiente del idioma del CLI): `--lang es` o lo eliges en el menú.
3. **Fuente de la HU** (de dónde sale la historia de usuario):

   | Fuente | Qué te pide |
   |---|---|
   | Archivo local | ruta a Word / PDF / Excel→CSV / md / txt |
   | **Azure DevOps** | URL del work item + PAT → trae título + descripción + criterios |
   | **Jira** | URL del issue + email + token |
   | **Google Drive / URL** | la URL (export a texto) |
   | Pegar texto | el texto directo |

4. La IA genera `specs/NNN-feature/{spec,plan,tasks}.md` (en `full`, también data-model/research/quickstart/contracts).
5. Imprime un **comando hand-off** detallado para pegar en tu asistente y generar el código con TDD.

### Harness de fidelidad (la IA NO inventa)

El prompt (`lib/prompts/spec-gen.prompt.xml`) tiene un cerco estricto: la IA es un **estructurador, no un
autor**. Si algo no está en el documento, **no va al spec** — va como `[NEEDS CLARIFICATION]`. Nunca
inventa requisitos, campos, entidades, reglas, edge cases ni tecnología. Un documento corto produce un
spec corto lleno de preguntas abiertas — y eso es **correcto**, no un fallo.

## Test-First + Mutation testing (calidad)

El método SDD impone **Test-First** (Red → Green → Refactor) y **mutation testing** en 4 capas
(constitución, reglas del asistente, plantilla `tasks.md`, y el prompt de `spec-ia`). El skill universal
`mutation-testing` está cableado a la regla `global`, así que **todo proyecto lo recibe**, con la
herramienta correcta por stack (instalación **project-local**, nunca global):

| Stack | Herramienta | Instalar (project-local) |
|---|---|---|
| JS/TS (Angular, Nest, Node) | Stryker | `npm i -D @stryker-mutator/core` + el runner (jest/karma/…) |
| .NET / C# | Stryker.NET | `dotnet new tool-manifest` → `dotnet tool install dotnet-stryker` |
| Python | mutmut | `uv add --dev mutmut` |
| Java · Go · Rust · PHP | PIT · Gremlins · cargo-mutants · Infection | (ver el skill) |

Objetivo: **mutation score ≥ 80%** en la lógica crítica. Son herramientas **dev-only** (no van a
producción); audítalas con `npm audit` / `dotnet list package --vulnerable` / `pip-audit` / `composer audit`.

## Internacionalización

- **CLI bilingüe (es/en)**: los textos salen en el idioma del SO (`LANG`/`LC_*`), o forzado con `CHALC_LANG=es`.
- **Idioma del spec**: `chalc spec-ia --lang es|en|pt|…` (o el menú) — independiente del idioma del CLI.
- El método SDD (constitución, plantillas, reglas, gráfico explicativo) está en **es y en**.

## Seguridad

- La **API key** vive en `~/.chalc/config.json` (permisos `600`), **nunca** en el proyecto ni en `.chalc.json`; entrada enmascarada.
- Las **herramientas de mutación** se instalan **project-local** (dev-dependency / tool-manifest), nunca `-g` global.
- Chalc **no sobrescribe** tu `CLAUDE.md`: solo edita su bloque entre `<!-- chalc:start -->` y `<!-- chalc:end -->`; el resto se conserva.
- Las skills se **vendorizan** (contenido real, sin symlinks) y traen `.chalc-skill.json` con fuente, fecha y hash.

## Targets (asistentes) soportados

El mismo catálogo neutro se proyecta al formato nativo de cada herramienta. Eliges el target en el flujo interactivo o con `--target`.

| Target | Instrucciones | Skills | MCP |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md` | `.claude/skills/<id>/` | `.mcp.json` |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `.chalc/skills/<id>/` (referenciados) | `.vscode/mcp.json` (`servers`, type `stdio`) |
| **Gemini CLI** | `GEMINI.md` | `.chalc/skills/<id>/` (referenciados) | `.gemini/settings.json` (`mcpServers`) |
| **Cursor** | `.cursor/rules/chalc-*.mdc` | `.chalc/skills/<id>/` + un `.mdc` por skill | `.cursor/mcp.json` (`mcpServers`) |

Todos escriben además `.chalc.json` (manifiesto). Agregar otro asistente = un `targets/<nombre>.mjs` con `apply()`, reusando catálogo y reglas.
