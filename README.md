# ⚙️ Chalc

Chalc es una CLI local para **crear proyectos nuevos** (`chalc init`) y **equipar proyectos existentes** con la configuración de asistentes de desarrollo: skills, servidores MCP, reglas y métodos de trabajo.

El flujo de equipado (`chalc`) no llama a modelos de IA: lee señales del proyecto (`package.json`, archivos raíz, globs), aplica reglas del catálogo y escribe los archivos que necesita el target elegido (Claude Code, GitHub Copilot, Cursor o Gemini CLI).

La IA es **opt-in** y se usa solo en tres comandos, siempre con la API key configurada por el usuario:
- **`chalc init`** — la IA *sugiere* una arquitectura calibrada a tu propuesta (aliada, no oráculo; tú decides).
- **`chalc spec-ia`** — transforma una historia de usuario o documento en archivos SDD (`spec.md`, `plan.md`, `tasks.md`).
- **`chalc qa --agent`** — verifica cada requisito `R#` contra la app viva.

Si no usas esos comandos, Chalc no necesita proveedor de IA ni tokens. Las llamadas a IA usan **CCR** (compresión reversible) para ahorrar tokens y son provider-agnósticas (OpenRouter, Anthropic, OpenAI, Gemini u Ollama).

## Idea en una frase

> Chalc no analiza el código con IA: detecta señales simples del proyecto y aplica reglas explícitas del catálogo.

## Por qué existe

La idea nació de una necesidad práctica: hoy muchas configuraciones de asistentes se resuelven dentro de un CLI o una sesión con tokens, y cada proyecto termina dependiendo de lo que se configure o recuerde en ese momento.

Chalc busca separar esas dos cosas. La IA puede ayudar cuando hace falta, pero las herramientas, reglas, skills, MCP y métodos de trabajo deberían poder viajar con los proyectos de forma explícita y repetible. En vez de configurar todo a mano una y otra vez, Chalc permite mantener un catálogo propio y aplicar esa “herencia” a cada proyecto según su stack.

Así, un proyecto Angular puede recibir sus skills de Angular, un NestJS sus reglas de backend, todos pueden heredar reglas globales como mutation testing, y cada asistente recibe la configuración en su propio formato. La intención no es reemplazar al asistente, sino preparar bien el terreno para que trabaje con el contexto correcto.

## Comandos (referencia rápida)

| Comando | Qué hace | ¿IA? |
|---|---|---|
| `chalc lang [es\|en]` | Fija el idioma de Chalc una sola vez (se guarda en `~/.chalc/config.json`) | no |
| `chalc init` | Crea un proyecto nuevo desde cero con arquitectura elegida por el usuario y lo equipa | opt-in (sugiere arq.; `--no-ai` la desactiva) |
| `chalc` | Detecta el stack y equipa skills/MCP/método (interactivo) | no |
| `chalc inspect` | Explica qué detecta y por qué, sin escribir | no |
| `chalc doctor` | Valida el catálogo (rules, skills, MCP, métodos, targets) | no |
| `chalc configure` | Administra el catálogo (rules/skills/MCP) por menú | no |
| `chalc install <fuente>` | Instala un skill al catálogo y lo cablea a una regla | no |
| `chalc spec` | Crea una carpeta/plantilla vacía `specs/NNN-feature` | no |
| `chalc config-ia` | Configura el proveedor de IA + API key (una vez) | sí (setup) |
| `chalc ai-doctor` | Muestra proveedor, perfil y modelos resueltos por tarea | no |
| `chalc eval-ia` | Ejecuta evals locales de prompts/parsers sin llamar al proveedor | no |
| `chalc spec-ia` | HU (Azure DevOps/Jira/Drive/Word/pegar) → spec/plan/tasks | sí |
| `chalc qa <ruta>` | Lista specs y valida el preflight QA (Docker + documentación) | no |
| `chalc qa <ruta> --spec 004-login --plan` | Genera el plan QA trazable a los requisitos de una spec | no |
| `chalc qa <ruta> --spec 004-login --env qa:up --plan` | Registra en el plan el entorno de arranque elegido (sin ejecutarlo aún) | no |
| `chalc qa <ruta> --spec 004-login --env serve --url http://localhost:3000 --up` | Levanta el entorno, espera a que la URL responda y luego lo baja | no |
| `chalc qa <ruta> --spec 004-login --env serve --url http://localhost:3000 --agent` | Levanta la app, corre el agente QA (verifica cada R# contra la app viva), escribe `qa/results.md` y baja | sí |
| `chalc qa <ruta> ... --agent --repair-plan` | Además genera `qa/repair-plan.md` desde FAIL/BLOCKED | sí |
| `chalc qa <ruta> ... --agent --surface web\|api` | Fuerza la superficie (navegador vs HTTP) si la autodetección no acierta | sí |

Cada comando tiene su equivalente `npm run <comando>` (ej. `npm run spec-ia`) por si no haces `npm link`.
Todo el CLI es **bilingüe (es/en)**. Por defecto sigue el idioma del sistema operativo, pero puedes
fijarlo una sola vez con **`chalc lang es`** o **`chalc lang en`** (queda guardado y se aplica a todos
tus proyectos, sin tener que tocar variables de entorno cada vez).

## Cómo se usa (la idea: descargar, un comando, interactivo)

**Una sola vez** — dentro de la carpeta `chalc/`, instala el comando global:
```bash
npm link        # crea el comando `chalc` en todo tu sistema
chalc lang es   # (opcional) fija el idioma del CLI; queda guardado para siempre
```

**Crear un proyecto nuevo desde cero:**
```bash
chalc init angular
```

**Equipar un proyecto existente:**
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
npm run init -- angular mi-app --description "dashboard administrativo con roles y permisos"
npm run spec
```

### Banderas (para automatizar / sin preguntas)
```bash
chalc inspect               # explica qué detecta y por qué, sin escribir
chalc init angular          # crea un proyecto Angular desde cero
chalc doctor                # valida reglas, catálogo, MCP, métodos y targets
chalc ai-doctor             # valida la configuración IA local sin gastar tokens
chalc eval-ia               # evals locales de contratos IA/prompt sin red
chalc configure             # crea rules y conecta skills/MCP de forma guiada
chalc spec                  # crea una plantilla vacía specs/NNN-feature
chalc --yes                 # usa los valores por defecto, sin preguntar
chalc --method sdd          # activa el método SDD sin preguntar
chalc --dry-run             # muestra el plan sin escribir nada
chalc --target claude       # elige el asistente destino
chalc install <fuente> --allow-exec  # permite Git/npx si confías en la fuente
chalc install <fuente> --force       # reemplaza un skill existente sin preguntar
```

### Crear desde cero (`chalc init`)

`chalc init` es el flujo para quitar el dolor de empezar proyectos. Chalc lee una propuesta
por texto o archivo (`--doc` soporta Word/PDF/Markdown/TXT vía `docread`), sugiere arquitecturas,
explica tradeoffs y deja que el usuario seleccione. La regla es: **Chalc sugiere, el usuario decide**.
La IA nunca es autoridad: si propone algo fuera del catálogo, Chalc lo descarta y cae a una recomendación
determinística.

Clean Code, SOLID y arquitectura modular son **principios obligatorios** en todos los proyectos.
Lo que el usuario elige es la arquitectura concreta. Soporta **Angular, NestJS y .NET**, orquestando
el scaffolder **oficial** de cada uno (`ng new`, `nest new`, `dotnet new`):

```bash
chalc init                         # interactivo: elige stack, describe la idea, elige arquitectura
chalc init angular
chalc init angular mi-admin --description "dashboard administrativo con usuarios, roles, permisos y API"
chalc init angular mi-admin --doc propuesta.docx --architecture modular-clean-architecture --target claude
chalc init nestjs mi-api --description "API de tickets con autenticación y colas"
chalc init dotnet mi-svc --architecture clean-architecture --verify   # --verify compila al final
```

#### Paso a paso (flujo interactivo)
1. **Stack** — eliges Angular / NestJS / .NET.
2. **Nombre y carpeta** — dónde se crea el proyecto (`--dir` para fijarla sin preguntar).
3. **Propuesta** — describes la idea por texto o adjuntas un documento (`--doc` lee Word/PDF/Markdown/TXT).
4. **La IA sugiere la arquitectura** (calibrada a tu propuesta) y, si tiene dudas que cambian la decisión,
   **te las pregunta**. Tú eliges la arquitectura final de la lista. Con `--no-ai` usas solo el análisis determinista.
5. **Resumen y confirmación** — Chalc te muestra qué va a hacer (incluida la versión del CLI elegida) antes de crear.
6. Crea el proyecto con el scaffolder oficial, lo re-moldea a la arquitectura y lo **equipa**.

Arquitecturas disponibles (la IA recomienda la más liviana que encaje; tú decides):

| Stack | Scaffolder oficial | Arquitecturas |
|---|---|---|
| **Angular** | `ng new` | `modular-feature-first` (MVPs/dashboards) · `modular-clean-architecture` (dominio/larga vida) · `enterprise-modular` (equipos grandes) |
| **NestJS** | `nest new` | `modular-feature` · `clean-hexagonal` · `enterprise-microservices` |
| **.NET** | `dotnet new` | `webapi-simple` · `clean-architecture` (solución + capas Domain/Application/Infrastructure/Api) |
| **Flutter** | `flutter create` | `feature-first` · `clean-architecture` (capas `presentation/domain/data`) · `enterprise-modular` |

#### Qué hace especial a `chalc init`
- **Se acomoda a tu máquina:** usa la versión de la herramienta que **ya tienes instalada**. En Angular/NestJS
  elige el major del CLI **compatible con tu Node** (ej.: Node 22.20 → `@angular/cli@20`, no el 22 que aborta);
  en **Flutter** y **.NET** usa directamente el **SDK instalado** (`flutter create` / `dotnet new`), y muestra
  esa versión en el resumen. No te obliga a actualizar nada.
- **Cada carpeta nace documentada:** en vez de un `.gitkeep` vacío, cada carpeta trae un `README.md` que
  explica —según la arquitectura— qué va ahí, buenas prácticas y qué skills aplicar. Así tu IA tiene contexto local.
- **`docs/architecture.md` detallado:** mapa de carpetas, reglas de dependencia y cómo agregar un feature.
- **El asistente lo lee primero:** `CLAUDE.md` (y equivalentes) abre con un bloque de **Principios obligatorios
  (siempre)** y una referencia a `docs/architecture.md` para que la IA respete la arquitectura antes de crear archivos.
- **`--verify`** corre el build/análisis (`npm run build` / `dotnet build` / `flutter analyze`) para confirmar que el proyecto compila al nacer.
- **Bilingüe (es/en)** según `chalc lang` o el idioma del sistema.

Al crear, Chalc genera el proyecto base del scaffolder oficial, las carpetas de la arquitectura con su
`README.md`, `docs/architecture.md`, `specs/` (método SDD), las skills globales (`clean-code`,
`solid-principles`, `modular-architecture`, `mutation-testing`), las skills del stack, los MCP y el target
IA elegido (`CLAUDE.md`, Cursor, Copilot o Gemini).

#### Extensible a cualquier framework

`chalc init` no está casado con Angular/NestJS/.NET/Flutter: cada stack es **una entrada declarativa** en
el registro de stacks (`lib/init.mjs`). Sumar Vue, Django, Spring, Go, Rails… es definir su scaffolder
oficial, sus arquitecturas y sus carpetas — **el motor no se toca**.

Forma de una entrada de stack:

```js
STACKS = {
  '<stack-id>': {
    label:        'Mi Framework (Lenguaje)',
    scaffold:     () => [{ command: '<cli-oficial>', args: (name) => ['create', name], cwd: 'parent' }],
    verify:       [{ command: '<cli>', args: ['install'] }, { command: '<cli>', args: ['build'] }],
    pick:         (a) => a.complexity === 'alta' ? 'clean-architecture' : 'feature-first',  // recomendación
    architectures: [
      { id: 'feature-first',      folders: ['src/core', 'src/shared', 'src/features'] },
      { id: 'clean-architecture', folders: ['src/domain', 'src/application', 'src/infrastructure', 'src/presentation'] }
    ]
  }
}
```

El flujo es el mismo para todos los stacks:

```
chalc init <stack>
     │
     ├─ 1) scaffolder OFICIAL  (usa la versión instalada en tu máquina)  ──►  proyecto base
     │        ng new · nest new · dotnet new · flutter create · …
     │
     ├─ 2) reshape a la arquitectura elegida  ──►  carpetas + README por carpeta + docs/architecture.md
     │
     └─ 3) equip (rules/<stack>.json + regla global)  ──►  skills + MCP + método SDD (specs/) + archivo del asistente
```

Para dejar equipado el nuevo stack: crea sus skills en `catalog/skills/`, (opcional) su MCP en
`catalog/mcp/`, y cabléalos en `rules/<stack>.json`. Cada carpeta de la arquitectura se documenta sola
vía `lib/init-folders.mjs` (si usas un rol de carpeta nuevo, agrega ahí su guía). Versionado de la
herramienta: si es un CLI de npm, añade su tabla Node→versión como en Angular/NestJS; si es un SDK local
(como Flutter/.NET), simplemente usa el instalado.

### Entender antes de aplicar
```bash
chalc inspect /ruta/al/proyecto
```

`inspect` es interactivo por defecto y no escribe archivos: te pregunta qué detalle quieres ver,
lista las reglas que aplican, las señales que las activaron (`package.json`, archivos raíz o globs
como `*.csproj`) y el plan base que `chalc --yes` montaría. En entornos no interactivos imprime el
diagnóstico completo.

### Agente QA: probar la app de verdad (`chalc qa --agent`)
Con `--agent`, chalc **levanta tu app, la prueba como una persona y reporta** cada requisito `R#`:

1. **Levanta el entorno** sin forzar puerto y **lee la URL que el dev server anuncia** (`ng serve` → `:4201`,
   Vite → `:5173`…), respetando la config de la app (forzar puerto rompe Module Federation). `--url` la fija.
2. **Detecta la superficie** (web vs API) por stack; `--surface web|api` la fuerza.
3. **Si la app exige autenticación, te la PIDE** (no falla en silencio): detecta guards/MSAL/interceptor Bearer
   y te pregunta cómo inyectar la sesión (token en localStorage/sessionStorage o header `Authorization: Bearer`).
4. **Explora y verifica con un agente IA** (provider-agnóstico): el veredicto se ancla en hechos observados
   (status HTTP, texto/elemento visible), nunca en suposiciones — un requisito sin evidencia queda `BLOCKED`,
   nunca un `PASS` inventado. El presupuesto de pasos escala con los `R#` (`--max-steps` lo ajusta).
5. **Escribe `qa/results.md`** (veredicto + evidencia por `R#`) y un **spec Playwright ejecutable**
   (`qa/e2e/<spec>.agent.spec.mjs`, un test por `R#`); si tienes `@playwright/test`, lo **corre con `npx playwright test`**.
6. **Baja el entorno** al terminar (siempre).

```bash
chalc qa . --spec 004-login --env start --agent           # interactivo: pregunta superficie/auth si hace falta
chalc qa . --spec 004-login --env start --agent --url http://localhost:3000 --surface web --max-steps 24 --allow-exec
chalc qa . --spec 004-login --env start --agent --repair-plan --allow-exec
chalc qa . --spec 004-login --repair-plan                 # genera repair-plan desde qa/results.md existente
```

### Manejo de tokens en el agente QA (CCR, integrado)
El agente (`qa --agent`) trae **CCR (Compresión Reversible)** propia, inspirada en Headroom pero **sin
dependencias y provider-agnóstica** (funciona igual con Anthropic, OpenRouter, OpenAI, Gemini u Ollama):

- Las salidas voluminosas (respuestas HTTP, DOM, logs) se reemplazan en el prompt por una referencia
  compacta `[CCR ref=... chars=N preview="..."]`.
- El original queda en una caché local con TTL; si el modelo necesita el contenido completo, pide
  `{"type":"recall","ref":"..."}` y se le devuelve entero durante el siguiente turno; luego vuelve a diferirse.
  **Reversible mientras la referencia viva dentro de su TTL.**
- **El plan y los requisitos R# nunca se comprimen** (fidelidad). Solo se difieren las observaciones.
- Está activo por defecto; desactívalo con `--no-ccr`. El reporte `qa/results.md` muestra cuánto difirió.

Opcionalmente puedes **además** apuntar a un proxy externo (Headroom u otro OpenAI-compatible) vía
`CHALC_BASE_URL`, sin tocar código:
```bash
headroom proxy --port 8787
CHALC_BASE_URL=http://localhost:8787/v1 CHALC_PROVIDER=openai CHALC_API_KEY=$TU_KEY \
  chalc qa . --spec 004-login --env serve --url http://localhost:3000 --agent
```

### Revisar la salud del Chalc
```bash
chalc doctor
```

`doctor` es interactivo por defecto y valida que el catálogo esté consistente: reglas JSON,
referencias a skills/MCP, frontmatter básico de skills, ids seguros, `implies`, definición de
MCP, métodos y targets cargables. En modo no interactivo (`chalc doctor --yes`) sale con código
`1` si encuentra errores, útil para CI.

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
├── bin/chalc.mjs            el motor / CLI (Node puro, sin dependencias)
├── lib/                     módulos del motor
│   ├── cli/args.mjs         parser de banderas/argumentos testeable
│   ├── i18n.mjs             textos bilingües (es/en) + `chalc lang` (idioma persistente)
│   ├── ids.mjs              validación de ids seguros (kebab-case)
│   ├── net.mjs              fetch con timeout/límites y validación de URLs externas
│   ├── install.mjs          instalar/vendorizar skills (Git/skills.sh/local)
│   ├── targetkit.mjs        utilidades compartidas por los targets (principios, arquitectura, bloques)
│   ├── docread.mjs          extrae texto de Word/PDF/CSV/…
│   ├── sources.mjs          trae la HU de Azure DevOps / Jira / Drive
│   ├── ── creación de proyectos (`chalc init`) ──
│   ├── init.mjs             registro de stacks: arquitecturas, scaffolder oficial, versión de CLI por Node
│   ├── init-folders.mjs     guías por carpeta (README.md) + mapa de carpetas para architecture.md
│   ├── init-scaffold.mjs    re-moldea el proyecto a la arquitectura + escribe docs/architecture.md
│   ├── initai.mjs           capa IA opcional que sugiere arquitectura (CCR + recall, clarifications)
│   ├── ── generación de specs (`chalc spec-ia`) ──
│   ├── ai.mjs               cliente multi-proveedor de IA (fetch) + config ~/.chalc (perfiles por tarea)
│   ├── ccr.mjs              compresión reversible (CCR) para ahorrar tokens, provider-agnóstica
│   ├── specgen.mjs          orquesta la generación del spec
│   ├── specvalidate.mjs     valida la salida (R#, trazabilidad, estructura mínima)
│   ├── aitrace.mjs          traza reproducible por spec (hashes, sin contenido crudo)
│   ├── aieval.mjs           evals locales de prompts/parsers sin llamar al proveedor
│   ├── ── agente QA (`chalc qa --agent`) ──
│   ├── qa.mjs               plan QA, entornos, reportes (results.md / repair-plan.md)
│   ├── qaagent.mjs          agente que verifica cada R# contra la app viva (provider-agnóstico)
│   └── prompts/             system prompts (estándar XML de HALLC)
│       ├── spec-gen.prompt.xml       generación de specs (harness de fidelidad)
│       ├── init-architect.prompt.xml sugerencia de arquitectura (aliada, no oráculo)
│       └── qa-agent.prompt.xml       verificación QA anclada en hechos
├── catalog/
│   ├── skills/              las skills reales (autocontenidas, portátiles)
│   ├── mcp/                 definiciones de servidores MCP
│   ├── profiles/            perfiles de modelos por tarea (chalc-default.json: spec/qa/repair)
│   └── methods/sdd/         el método SDD (constitución, plantillas es/en, reglas, gráfico)
├── rules/                   criterio: qué señal = qué stack = qué se instala (incl. global.json)
├── targets/
│   ├── claude.mjs           traductor a Claude Code
│   ├── copilot.mjs          traductor a GitHub Copilot
│   ├── cursor.mjs           traductor a Cursor
│   └── gemini.mjs           traductor a Gemini CLI
└── test/                    suite con `node --test` (parser, init, IA, QA, seguridad, doctor)
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
| Mobile | Flutter, Dart, Swift, Kotlin | Flutter con skills + MCP (`dart`); Dart/Swift/Kotlin detecta |
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
chalc install <fuente> --stack angular --allow-exec
chalc install <fuente> --stack angular --force
```

Las fuentes Git/GitHub y `skills.sh` requieren ejecutar herramientas externas (`git clone` o
`npx --yes skills add`). En modo interactivo Chalc pide confirmación antes de ejecutarlas. En modo
no interactivo debes pasar `--allow-exec` explícitamente si confías en la fuente. Las rutas locales
no necesitan ese permiso.

También puedes pegar comandos completos del nuevo CLI de skills:

```bash
chalc install "npx skills add https://github.com/wshobson/agents --skill angular-migration" --allow-exec
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
chalc install <fuente> [--stack <id>] [--allow-exec]
```

`<fuente>` puede ser:
- **URL de Git/GitHub** — `https://github.com/owner/repo`, `.../tree/<rama>/<subcarpeta>`, o `*.git`.
- **skills.sh** — un nombre/URL; Chalc usa `npx skills add` por dentro y vendoriza el resultado.
- **Ruta local / carpeta** — copia directa al catálogo.

Por seguridad, Git/GitHub y `skills.sh` no se ejecutan automáticamente en modo no interactivo:
usa `--allow-exec` cuando la fuente sea confiable. En interactivo, Chalc pregunta antes de ejecutar.

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
También puedes separar modelos por tarea con `CHALC_SPEC_MODEL`, `CHALC_QA_MODEL` y `CHALC_REPAIR_MODEL`.
Cliente HTTP con `fetch` nativo, cero dependencias.

Chalc soporta perfiles versionables en `catalog/profiles/*.json`. El perfil incluido (`chalc-default`) define:
- `spec`: modelo fuerte para convertir HU/documentos en SDD.
- `qa`: modelo más económico/rápido para loops de verificación.
- `repair`: modelo fuerte si luego se agrega reparación asistida; el plan actual se genera de forma determinística desde QA.

Puedes inspeccionar la resolución final sin consumir tokens:

```bash
chalc ai-doctor
CHALC_QA_MODEL=mi-modelo-rapido chalc ai-doctor
```

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
   | Archivo local | ruta a `.md` / `.txt` (recomendado: se leen directo, sin herramientas extra) / Word / PDF / Excel→CSV |
   | **Azure DevOps** | URL del work item + PAT → trae título + descripción + criterios |
   | **Jira** | URL del issue + email + token |
   | **Google Drive / URL** | la URL (export a texto) |
   | Pegar texto | el texto directo |

4. La IA genera `specs/NNN-feature/{spec,plan,tasks}.md` (en `full`, también data-model/research/quickstart/contracts).
5. Chalc valida la salida: requisitos `R#`, referencias en tasks, estructura mínima y aclaraciones pendientes.
6. Guarda una traza reproducible en `specs/<feature>/.chalc/ai-trace.jsonl` con hashes de prompt/output, nunca el contenido crudo.
7. Imprime un **comando hand-off** detallado para pegar en tu asistente y generar el código con TDD.

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

- **CLI bilingüe (es/en)**: toda la salida al usuario pasa por `lib/i18n.mjs` y sale en el idioma elegido.
- **Fijar el idioma una sola vez**: `chalc lang es` o `chalc lang en` lo guarda en `~/.chalc/config.json`
  y se aplica a todos tus proyectos. `chalc lang` sin argumento abre el menú interactivo.
- **Precedencia del idioma**: `--lang` > `CHALC_LANG` > config guardada (`chalc lang`) > `LANG`/`LC_*` del SO > `en`.
- **Idioma del spec**: `chalc spec-ia --lang es|en|pt|…` (o el menú) — independiente del idioma del CLI.
- El método SDD (constitución, plantillas, reglas, gráfico explicativo) está en **es y en**.

## Seguridad

- La **API key** vive en `~/.chalc/config.json` (permisos `600`), **nunca** en el proyecto ni en `.chalc.json`; entrada enmascarada.
- Las fuentes remotas para `spec-ia` usan timeout, límite de tamaño y validación de redirects; se bloquean protocolos no HTTP(S), `localhost` e IPs privadas/locales.
- Las llamadas a proveedores de IA tienen timeout para evitar procesos colgados.
- Las trazas IA guardan hashes, conteos y metadatos; no guardan prompts, documentos fuente ni secretos.
- Los ids de targets, skills, MCP, rules y métodos se validan como kebab-case seguro antes de usarse como rutas o imports.
- Instalar skills desde Git/GitHub o `skills.sh` requiere confirmación interactiva o `--allow-exec` en modo no interactivo.
- Las **herramientas de mutación** se instalan **project-local** (dev-dependency / tool-manifest), nunca `-g` global.
- Chalc **no sobrescribe** tu `CLAUDE.md`: solo edita su bloque entre `<!-- chalc:start -->` y `<!-- chalc:end -->`; el resto se conserva.
- Las skills se **vendorizan** (contenido real, sin symlinks) y traen `.chalc-skill.json` con fuente, fecha y hash.

## Tests y CI

Chalc usa el runner nativo de Node:

```bash
npm test
```

La suite cubre parser de argumentos, detección de stacks con fixtures versionados en `test/fixtures/`,
bloqueos de seguridad (`target` inseguro, instalación externa sin `--allow-exec`, URLs locales) y
`doctor`. Para CI, el mínimo recomendado es:

```bash
npm test
npm run doctor -- --yes
node bin/chalc.mjs eval-ia --yes
```

## Targets (asistentes) soportados

El mismo catálogo neutro se proyecta al formato nativo de cada herramienta. Eliges el target en el flujo interactivo o con `--target`.

| Target | Instrucciones | Skills | MCP |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md` | `.claude/skills/<id>/` | `.mcp.json` |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `.chalc/skills/<id>/` (referenciados) | `.vscode/mcp.json` (`servers`, type `stdio`) |
| **Gemini CLI** | `GEMINI.md` | `.chalc/skills/<id>/` (referenciados) | `.gemini/settings.json` (`mcpServers`) |
| **Cursor** | `.cursor/rules/chalc-*.mdc` | `.chalc/skills/<id>/` + un `.mdc` por skill | `.cursor/mcp.json` (`mcpServers`) |

Todos escriben además `.chalc.json` (manifiesto). Agregar otro asistente = un `targets/<nombre>.mjs` con `apply()`, reusando catálogo y reglas.
