# ⚙️ Chalc

> **Español** · [English](README.md)

Chalc es una CLI local para **crear proyectos nuevos** (`chalc init`) y **equipar proyectos existentes** con la configuración de asistentes de desarrollo: skills, servidores MCP, reglas y métodos de trabajo.

El flujo de equipado (`chalc`) no llama a modelos de IA: lee señales del proyecto (`package.json`, archivos raíz, globs), aplica reglas del catálogo y escribe los archivos que necesita el target elegido (Claude Code, GitHub Copilot, Cursor, Gemini CLI o Codex CLI).

La IA es **opt-in** y se usa solo en tres comandos, siempre con la API key configurada por el usuario:
- **`chalc init`** — la IA *sugiere* una arquitectura calibrada a tu propuesta (aliada, no oráculo; tú decides).
- **`chalc spec-ia`** — transforma una historia de usuario o documento en archivos SDD (`spec.md`, `plan.md`, `tasks.md`).
- **`chalc qa --agent`** — verifica cada requisito `R#` contra la app viva.

Si no usas esos comandos, Chalc no necesita proveedor de IA ni tokens. Las llamadas a IA usan **CCR** (compresión reversible) para ahorrar tokens y son provider-agnósticas (OpenRouter, Anthropic, OpenAI, Gemini u Ollama). Y **siempre que se consulta la IA, Chalc muestra cuántos tokens consumió** (entrada/salida/total y nº de llamadas), para que sepas el gasto.

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
| `chalc verify [ruta]` | Verifica un proyecto: completitud (carpetas/README, architecture.md, specs/) + **fronteras de arquitectura** (capas) | no |
| `node .chalc/gate.mjs` | **Portón de calidad** de un repo equipado: tests + mutación + comprobaciones estáticas; evidencia en `.chalc/gate.md`. No es un comando de chalc — corre en el repo, con o sin chalc | no |
| `node .chalc/next.mjs` | **Advisor de flujo** de un repo equipado: dice cuál es la ÚNICA acción siguiente del ciclo de tarea, leyendo el estado real del repo. Solo lectura. No es un comando de chalc — corre en el repo, con o sin chalc | no |
| `chalc doctor` | Valida el catálogo (rules, skills, MCP, métodos, targets) | no |
| `chalc configure` | Administra el catálogo (rules/skills/MCP) por menú | no |
| `chalc install <fuente>` | Instala un skill al catálogo y lo cablea a una regla | no |
| `chalc spec` | Crea una carpeta/plantilla vacía `specs/NNN-feature` | no |
| `chalc config-ia` | Configura la IA por paquetes: base (proveedor + key), `cli` (equipo líder/desarrollador/revisor), `spec`, `qa`, `repair` | sí (setup) |
| `chalc ai-doctor` | Muestra proveedor, perfil y modelos resueltos por tarea | no |
| `chalc eval-ia` | Ejecuta evals locales de prompts/parsers sin llamar al proveedor | no |
| `chalc spec-ia` | HU (Azure DevOps/Jira/Drive/Word/pegar) → spec/plan/tasks | sí |
| `chalc feature` | Orquestador full-stack: UNA HU → contrato de API + spec del back + spec del front + spec del móvil opcional (mismo `NNN` en todos los repos). Con `--worktree`: varias HUs en paralelo, un workspace aislado por HU | sí |
| `chalc dashboard [carpeta]` | Dashboard local solo-lectura de los workspaces del modo worktree: progreso de tareas + estado git por lado, auto-refresco | no |
| `chalc-cli` | Shell interactiva del agente sobre tu proyecto equipado (tools con aprobación, skills y MCP) | sí |
| `chalc qa <ruta>` | Lista specs y valida el preflight QA (Docker + documentación) | no |
| `chalc qa <ruta> --spec 004-login --plan` | Genera el plan QA trazable a los requisitos de una spec | no |
| `chalc qa <ruta> --spec 004-login --env qa:up --plan` | Registra en el plan el entorno de arranque elegido (sin ejecutarlo aún) | no |
| `chalc qa <ruta> --spec 004-login --env serve --url http://localhost:3000 --up` | Levanta el entorno, espera a que la URL responda y luego lo baja | no |
| `chalc qa <ruta> --spec 004-login --env serve --url http://localhost:3000 --agent` | Levanta la app, corre el agente QA (verifica cada R# contra la app viva), escribe `qa/results.md` y baja | sí |
| `chalc qa <ruta> ... --agent --repair-plan` | Además genera `qa/repair-plan.md` desde FAIL/BLOCKED | sí |
| `chalc deliver <ruta> --spec 004-login --env serve --allow-exec` | Flujo QA → repair-plan → verify → rerun; si hay FAIL/BLOCKED se detiene para reparar y continuar con `--rerun` | sí |
| `chalc qa <ruta> ... --agent --surface web\|api` | Fuerza la superficie (navegador vs HTTP) si la autodetección no acierta | sí |
| `chalc tokens <ruta> [--json]` | Muestra el gasto de IA acumulado del proyecto (tokens + USD estimado) por comando, tarea/rol y modelo | no |
| `chalc update [id…] [--check]` | Sincroniza las skills instaladas con su fuente (git/skills.sh/local) y regenera `skills-lock.json`; `--check` solo reporta | no |

Casi todos los comandos tienen su equivalente `npm run <comando>` (ej. `npm run spec-ia`) por si no haces
`npm link`; las excepciones son `qa`, `deliver`, `verify`, `install` y `feature`, que se invocan como `npm start -- <comando> …`.
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

Implementación mínima, Clean Code, SOLID y arquitectura modular son **principios obligatorios** en todos los proyectos.
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
3. **Propuesta** — describes la idea por texto o adjuntas un documento (`--doc` lee Word/PDF/Markdown/TXT;
   Word/PDF requieren herramientas del sistema — ver la nota en `spec-ia` —; en Windows usa `.md`/`.txt`).
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
- **Verificación automática al final** (sin tokens): comprueba que esté todo (carpetas con README, `docs/architecture.md`, `specs/`, manifiesto, archivo del asistente) y las **fronteras de arquitectura**, y cierra con un **✓ Proyecto creado correctamente**. Lo mismo se corre luego con `chalc verify` en cualquier proyecto.
- **`--verify`** corre el build/análisis (`npm run build` / `dotnet build` / `flutter analyze`) para confirmar que el proyecto compila al nacer.
- **Bilingüe (es/en)** según `chalc lang` o el idioma del sistema.

Al crear, Chalc genera el proyecto base del scaffolder oficial, las carpetas de la arquitectura con su
`README.md`, `docs/architecture.md`, `specs/` (método SDD), las skills globales (`minimal-implementation`,
`clean-code`, `solid-principles`, `modular-architecture`, `mutation-testing`), las skills del stack, los MCP y el target
IA elegido (`CLAUDE.md`, Cursor, Copilot, Gemini o Codex).

#### Extensible a cualquier framework

`chalc init` no está casado con Angular/NestJS/.NET/Flutter: cada stack es **una entrada declarativa** en
el registro de stacks (`lib/init.mjs`). Sumar Vue, Django, Spring, Go, Rails… es definir su scaffolder
oficial, sus arquitecturas y sus carpetas — **el motor no se toca**.

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
3. **Si la app exige autenticación, consigue la sesión por ti** (no falla en silencio) — ver "Login QA" abajo.
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

### Login QA: chalc consigue el token por ti (no pegues JWTs)
Para probar endpoints protegidos el agente necesita una sesión. Pegar un JWT crudo es incómodo (expira, es enorme),
así que chalc puede **hacer el login por ti**: declara una vez el contrato de login de tu app y chalc te pregunta
*con qué usuario* y acuña el token.

Orden de resolución de la sesión para `--agent`:
1. **Token directo** (CI o token externo): `--auth-token <jwt>` o `CHALC_QA_TOKEN` — se usa tal cual, gana sobre todo.
2. **Login por credenciales**: si el proyecto declara un contrato `qa.login`, chalc pide las credenciales
   (interactivo) — o las lee de `--auth-<campo>` / `CHALC_QA_<CAMPO>` (no interactivo) — levanta la app,
   llama al endpoint de login, extrae el token y lo inyecta. En interactivo muestra y confirma el destino antes
   de pedir secretos; en no interactivo exige `--allow-login`. Por defecto el endpoint debe ser del mismo origen
   de la app o loopback (`--allow-external-login` es una excepción explícita, solo HTTPS). Las credenciales nunca se imprimen ni se guardan.
3. **Clásico**: detecta guards/MSAL/interceptor Bearer y te pregunta cómo inyectar la sesión (storage o header).

Declara el contrato en `.chalc.json` (`qa.login`) — o por spec en `specs/<id>/qa/inputs.json` (`login`, con precedencia):

```jsonc
// .chalc.json — ejemplo para un endpoint de login de dev que acuña el token desde un userType
"qa": { "login": {
  "url": "http://localhost:5002/api/auth/generate-token",
  "method": "POST",
  "query":     { "userType": "${userType}" },   // ${campo} se rellena con las credenciales recolectadas
  "tokenPath": "datos.token",                    // ruta con puntos al token en la respuesta JSON
  "fields":    [{ "name": "userType", "label": "Tipo de usuario", "default": "admin" }]
} }
// login clásico en su lugar: "body": { "email": "${email}", "password": "${password}" }, "tokenPath": "token",
//                           "fields": [{ "name": "email" }, { "name": "password", "secret": true }]
```

```bash
chalc qa . --spec 012 --env dotnet --agent --allow-exec            # interactivo: pregunta "Tipo de usuario [admin]"
CHALC_QA_USERTYPE=admin chalc qa . --spec 012 --agent --allow-exec --allow-login  # no interactivo (CI)
```

Un login fallido (credenciales malas, endpoint caído, `tokenPath` ausente) aborta el agente con un error claro y
baja el entorno igual — nunca corre el agente sin autenticar.

### Flujo deliver: QA → repair → verify → rerun
`chalc deliver` encadena el cierre de una entrega sin inventar reparaciones:

1. Corre `qa --agent --repair-plan`.
2. Si hay `FAIL`/`BLOCKED`, deja `qa/repair-plan.md` y se detiene para que apliques la reparación.
3. Continúa con `chalc deliver ... --rerun`: primero ejecuta `verify`; si pasa, reejecuta QA.

```bash
chalc deliver . --spec 004-login --env start --allow-exec
chalc deliver . --spec 004-login --env start --rerun --allow-exec
```

### Histórico de gasto de IA: `chalc tokens`
Cada llamada de IA (de `spec-ia`, `feature`, `qa`, `deliver`, `init` y la shell `chalc-cli`) queda registrada en el
`.chalc/tokens.jsonl` del proyecto — fecha, comando, tarea/rol, proveedor, modelo y tokens. `chalc tokens` agrega
ese histórico para que veas a dónde se va el dinero y midas el ahorro:

```bash
chalc tokens .           # total + desglose por comando, tarea/rol y modelo, con USD estimado
chalc tokens . --json    # el mismo agregado como JSON limpio (para scripts/CI)
```

- Los importes en USD son **estimaciones** con una tabla local de precios (por 1M de tokens); los modelos sin
  precio conocido se señalan como tales — nunca se inventan. Los proveedores locales (Ollama) cuentan como $0.
- Puedes fijar o pisar precios en `~/.chalc/config.json`:
  `"prices": { "<modelo>": { "input": USD_por_1M, "output": USD_por_1M } }`.
- El registro es best-effort y append-only: jamás rompe un comando, y el gasto se persiste incluso cuando un
  comando falla después de pagar tokens.

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

1. **Detecta** el stack por señales reales ancladas a la raíz del proyecto (`package.json`, `angular.json`, `nest-cli.json`, globs raíz, etc.). En monorepos, ejecuta `chalc` dentro del paquete/app que quieras equipar.
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
│   ├── detect.mjs           detección de stack/reglas desde señales raíz del proyecto
│   ├── net.mjs              fetch con timeout/límites y validación de URLs externas
│   ├── install.mjs          instalar/vendorizar skills (Git/skills.sh/local)
│   ├── targetkit.mjs        utilidades compartidas por los targets (principios, arquitectura, bloques)
│   ├── docread.mjs          extrae texto de Word/PDF/CSV/…
│   ├── sources.mjs          trae la HU de Azure DevOps / Jira / Drive
│   ├── ── creación de proyectos (`chalc init`) ──
│   ├── init.mjs             registro de stacks: arquitecturas, scaffolder oficial, versión de CLI por Node
│   ├── init-folders.mjs     guías por carpeta (README.md) + mapa de carpetas para architecture.md
│   ├── init-scaffold.mjs    re-moldea el proyecto a la arquitectura + escribe docs/architecture.md
│   ├── verify.mjs           verificación de completitud del proyecto (carpetas, docs, specs, manifiesto)
│   ├── verify-boundaries.mjs re-export del linter de fronteras del portón — `chalc verify`
│   ├── gatedetect.mjs      detecta la config del portón desde las señales reales del repo
│   ├── gateemit.mjs        emite el portón en `.chalc/` al equipar
│   ├── gatehandoff.mjs     el ciclo de cierre de tarea que va en cada hand-off
│   ├── initai.mjs           capa IA opcional que sugiere arquitectura (CCR + recall, clarifications)
│   ├── ── generación de specs (`chalc spec-ia`) ──
│   ├── ai.mjs               cliente multi-proveedor de IA (fetch) + config ~/.chalc (perfiles por tarea)
│   ├── tokenmeter.mjs       mide los tokens consumidos por la IA y los muestra al usuario
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
├── cli/                     shell interactiva y orquestador del equipo de agentes
│   ├── index.mjs            REPL, comandos slash, cola viva y coordinación líder/dev/revisor
│   ├── session.mjs          sesión, modelos por rol, contexto y ciclo de vida observable
│   ├── agents/
│   │   └── registry.mjs     registro de ejecuciones: estado, tarea, herramienta, tiempo y errores
│   ├── ui/
│   │   ├── screen.mjs       TUI con entrada fija, historial y escritura mientras trabaja
│   │   ├── render.mjs       presentación ANSI compartida
│   │   └── agents.mjs       panel/gráfico adaptativo del comando `/agents`
│   ├── engine/              loop plan→acción→observación, planner, reviewer y presupuesto
│   ├── tools/               filesystem y shell confinados, con aprobación
│   ├── mcp/                 clientes MCP stdio/HTTP y adaptación a tools
│   └── skills/loader.mjs    skills equipadas → contexto relevante del agente
├── catalog/
│   ├── skills/              las skills reales (autocontenidas, portátiles)
│   ├── mcp/                 definiciones de servidores MCP
│   ├── profiles/            perfiles de modelos por tarea (chalc-default.json: spec/qa/repair)
│   ├── methods/sdd/         el método SDD (constitución, plantillas es/en, reglas, gráfico)
│   ├── agents/              los roles de revisión: contrato + prompt (es/en) por carpeta
│   ├── hooks/               el hook opcional de fin de turno, documentado — nunca instalado
│   ├── gate/                el portón de calidad: código real que se copia a `.chalc/` al equipar
│   ├── next/                el advisor de flujo: decide la ÚNICA acción siguiente del ciclo de tarea
│   ├── tools/               qué sabe chalc de cada stack: tests, mutación, reporte e instalación
│   └── mail/                el buzón entre lados de un workspace
├── rules/                   criterio: qué señal = qué stack = qué se instala (incl. global.json)
├── targets/
│   ├── claude.mjs           traductor a Claude Code
│   ├── codex.mjs            traductor a Codex CLI
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

### Mantener las skills instaladas al día: `chalc update`
Cada skill instalada guarda un manifiesto (`catalog/skills/<id>/.chalc-skill.json`) con su fuente y un
hash del contenido. `chalc update` re-descarga cada fuente, compara hashes y reemplaza solo lo que de
verdad cambió — y regenera `skills-lock.json` como espejo fiel del catálogo:

```bash
chalc update --check                 # solo reporta: al día / desactualizada / error (no escribe nada)
chalc update                         # aplica actualizaciones (pregunta antes de git/npx; --allow-exec evita la pregunta)
chalc update angular-migration       # actualiza solo la(s) skill(s) indicadas
```

- Una fuente caída no aborta el resto: se reporta por skill y la corrida continúa.
- Las builtin del catálogo (sin fuente) se omiten y se cuentan como no-actualizables.
- Tras actualizar, re-corre `chalc apply` en tus proyectos para propagar el contenido nuevo.

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
- **Mutation testing**: tras Green/refactor, los tests deben **matar mutantes** (score ≥ 80%). El **portón de calidad** de abajo es quien lo comprueba.
- **Trazabilidad**: cada tarea y cada test apunta a un requisito (`R#`).

Al elegirlo en el modo interactivo, Chalc **muestra un gráfico breve** explicando SDD antes de integrarlo, y pregunta el **tamaño del proyecto**:

| Modo | Para | Monta en `specs/` |
|---|---|---|
| `lite` | proyectos pequeños | `constitution.md` + `_template/{spec,plan,tasks}.md` |
| `full` | proyectos grandes | lo anterior + `research.md`, `data-model.md`, `contracts/`, `quickstart.md` |

El método se inyecta en el archivo del asistente (`CLAUDE.md`, etc.) como reglas, y deja `specs/` en el proyecto.
Sin interactivo: `chalc --method sdd:lite` o `chalc --method sdd:full` (o `--mode lite|full`).
La constitución, plantillas y reglas están en **es y en** (siguen el idioma del sistema).

### Portón de calidad: cerrar una tarea se verifica, no se promete

Equipar un repo también le deja un **portón de calidad**: `.chalc/gate.mjs`, código real sin
dependencias que corre con Node a secas, esté o no chalc instalado ahí.

Por qué existe: "corre mutation testing y llega a 80%" era una frase de las reglas que nadie
comprobaba. Un asistente podía reportar un score sin ejecutar nada. Ahora el score sale de **parsear
el archivo de reporte de la propia herramienta** — nunca de su stdout, nunca de un resumen escrito.

```
node .chalc/gate.mjs           # cierra una tarea: tests + mutación + comprobaciones estáticas
node .chalc/gate.mjs --fast    # omite la mutación (minutos) — NO cierra tarea
```

| Etapa | Qué comprueba | De dónde sale |
|---|---|---|
| tests | la suite del propio repo | `test.command` |
| mutación | score ≥ umbral y mutantes supervivientes | el reporte nativo (Stryker, Stryker.NET, mutmut, PIT) |
| código | una cosa por archivo, largo de archivo/función, parámetros, anidamiento, `catch` vacío, salida de depuración, `any` | archivos cambiados |
| fronteras | imports que cruzan capas o features | el mismo linter de `chalc verify` |
| trazabilidad | cada test cambiado cita un `R#` real | `specs/NNN-*/spec.md` |
| contrato | cada ruta del contrato existe en el código | `contracts/api.md` |

**Lo que no se puede comprobar se bloquea, nunca se aprueba.** Herramienta ausente, reporte que no
está o reporte más viejo que el código que cambiaste salen con código distinto de cero e imprimen el
comando de instalación exacto. Cada corrida escribe `.chalc/gate.md` con la fecha, la rama, cada
comando con su código de salida y su duración reales, el score, los supervivientes y los hallazgos —
evidencia que puedes leer tú mismo.

La configuración vive en **`.chalc/gate.json`** (umbrales, comandos, rutas de reporte). Re-equipar
regenera el código del portón y **conserva lo que hayas editado ahí**.

### La duplicación deja de ser opinión

El portón gana una séptima etapa. Compara los archivos que la tarea tocó contra **todo el árbol de
fuentes** y reporta los bloques repetidos con la ruta y la línea de las dos copias:

```
src/pago.service.ts:6 — 7 líneas idénticas a "src/factura.service.ts:6"
```

Caza el caso que más duele: **copiaste de un archivo que no abriste**. El revisor no lo veía —tiene
delante el diff de una tarea, no el repo— y el portón tampoco lo medía: la spec 007 lo había dejado
fuera de alcance por temor a los falsos positivos.

Tres frenos evitan ese temor:

- **Solo cuenta si tocaste una de las dos puntas.** Un repo con historia tiene duplicación vieja a
  montones; volcarla entera enterraría el trabajo de hoy.
- **Las líneas que repite la gramática no cuentan**: imports, cierres sueltos, `else`, decoradores.
  Cinco `import` seguidos de un `}` aparecen idénticos en medio repo.
- **El contenido de las cadenas SÍ se compara.** Vaciarlo volvía idénticas las tablas `es` y `en` de
  cualquier marco bilingüe. Correr la etapa sobre este mismo repo lo destapó: 81 hallazgos, casi
  todos tablas de idioma. Con las cadenas preservadas: 19, y reales.

Se ajusta en `.chalc/gate.json`:

```jsonc
"lint": {
  "duplication": { "enabled": true, "minLines": 6, "maxFiles": 4000 }
}
```

El mínimo se mide en **líneas significativas**, no en líneas del archivo. Y el revisor deja de
opinar sobre lo que ahora mide un script: lo suyo pasa a ser la duplicación que ningún script ve —
dos funciones que hacen lo mismo con otros nombres y otra forma.

### Agente revisor: lo que el portón no puede medir

El portón mide y no opina. A su lado, cada repo recibe un **agente revisor** en el formato de su
target (subagente real en `.claude/agents/` para Claude Code, regla en `.cursor/rules/`, sección del
bloque gestionado para Codex, Copilot y Gemini). Lee `.chalc/gate.md`, el diff de la tarea, la
constitución y **las skills activas de ESE repo**, y juzga lo que solo se ve leyendo: si el test
comprueba el requisito o solo lo acompaña, si la abstracción es la correcta, si el nombre dice lo que
hace.

Responde `OK` o una lista numerada con `archivo:línea`. **No modifica archivos**, con una única
excepción: anota su veredicto al final de `.chalc/review.md`, en modo solo añadir. Sin ese rastro, el
advisor no podría comprobar que la revisión ocurrió.

### Roles con contrato

El alcance de cada rol se declara **una vez, como dato**, en `catalog/agents/<id>/contract.json`:

```jsonc
{
  "id": "revisor", "order": 10, "cadence": "task",
  "writes": [".chalc/review.md"],
  "forbiddenWrites": ["**"],
  "tools": ["Read", "Grep", "Glob", "Bash", "Write"]
}
```

De ahí salen los permisos que el target concede y la prosa que el rol lee, así que no pueden
desincronizarse. Y hay una verificación dura: **un rol que no declara nada en `writes` no puede
recibir una herramienta de escritura**, y `Edit` no se concede nunca — escribir la bitácora propia y
modificar código ajeno no son el mismo permiso.

Hoy hay dos roles, y no se pisan:

| Rol | Cuándo | Qué juzga |
|---|---|---|
| `revisor` | cada tarea | calidad del test, abstracción, nombres, mínimo |
| `endurecedor` | al cerrar la feature | entradas inválidas, rutas de error, casos borde, dependencias que fallan |

La **cadencia** importa por el coste: cada pasada es una llamada a un modelo. Meter al endurecedor en
las veinte tareas de una feature multiplica ese coste por veinte para encontrar casi siempre lo mismo
que encontraría al final. Se ajusta por repo en `.chalc/gate.json`:

```jsonc
"flow": {
  "roles": [
    { "id": "revisor",     "order": 10, "cadence": "task",    "required": true },
    { "id": "endurecedor", "order": 20, "cadence": "feature", "required": true }
  ]
}
```

**Añadir un rol es añadir una carpeta**: su contrato y su prompt en los dos idiomas. Los cinco
targets lo proyectan y el advisor lo secuencia sin tocar código.

> **Solo Claude Code concede permisos por agente.** En Cursor el rol es una regla y en Codex, Copilot
> y Gemini una sección del bloque gestionado: ahí el alcance es una **instrucción, no una
> restricción**, y lo emitido lo dice con esas palabras. chalc avisa al equipar cuál de las dos cosas
> te tocó.

### Advisor de flujo: el siguiente paso lo decide el estado, no la memoria

El portón mide y el revisor juzga, pero durante mucho tiempo **el orden en que se usaban vivía en
prosa** dentro del hand-off. Nadie leía `.chalc/gate.md` de vuelta: se podía correr el portón, seguir
tocando código y marcar la tarea con una evidencia ya rancia.

Equipar deja también un **advisor**: `.chalc/next.mjs`, de solo lectura y sin dependencias.

```bash
node .chalc/next.mjs
```

```text
NEXT_ACTION: run_gate
REASON: Tocaste código a las 15:04 y la evidencia es de las 14:32: mide lo de antes.
COMMAND: node .chalc/gate.mjs
```

Lee el estado real del repo —fecha de la evidencia, veredicto del portón, bitácora del revisor,
checkboxes de `tasks.md`, archivos cambiados— y devuelve **una sola** acción de esta tabla, la
primera que aplique: `blocked_config`, `run_gate`, `fix_gate`, `call_reviewer`, `fix_review`,
`tick_task`, `work_task`, `done`. Si no puede saber en qué punto va, responde `ask_human` y devuelve
el control en vez de adivinar.

`NEXT_ACTION` y `COMMAND` **no se traducen** (los consume el asistente); `REASON` va en el idioma del
spec y siempre cita el dato que produjo la acción. Un verde de una corrida `--fast`, o de otra rama,
no cierra tarea: vuelve a `run_gate`.

Las puertas de aprobación se ajustan en `.chalc/gate.json`:

```jsonc
"flow": {
  "approvals": { "task": true, "feature": true },   // pedir tu OK al cerrar
  "review": { "required": true }                    // exigir revisor antes de marcar
}
```

El hand-off que imprimen `spec-ia` y `feature` ya no recita pasos: manda consultar el advisor y
obedecer su `COMMAND` hasta que responda `done`. En una feature full-stack el ciclo es **por repo**,
nombrando el advisor de cada lado, y está prohibido cambiar de repo sin cerrar el actual.

> Chalc **nunca instala el hook** que haría esto automático: los hooks se ejecutan solos y
> `.claude/settings.json` va commiteado, así que activarlo le impondría un comando a todo el que
> clone el repo. El bloque listo para pegar y el porqué quedan en `.chalc/gate-hook.md`.

### La tabla de herramientas: un archivo por lenguaje

Lo que chalc sabe de cada stack —con qué comando se corren sus tests, con qué herramienta se muta,
cómo se instala, dónde escribe su reporte y si el portón sabe leerlo— vive en **un archivo de datos
por lenguaje** en `catalog/tools/`:

```jsonc
// catalog/tools/maven.json
{
  "id": "maven", "label": "Java / Kotlin (Maven)", "priority": 50,
  "detect": { "files": ["pom.xml"] },
  "test": { "rule": "fixed", "value": "mvn test" },
  "mutation": { "rule": "fixed", "value": {
    "tool": "pit",
    "command": "mvn org.pitest:pitest-maven:mutationCoverage",
    "report": "target/pit-reports/**/mutations.xml",
    "format": "pit"
  }}
}
```

De esa misma fila salen **dos** cosas que antes se mantenían por separado y a mano: la
`.chalc/gate.json` que el portón lee, y las tablas de la skill `mutation-testing` que el asistente
lee. Que coincidan ya no depende de que alguien se acuerde de tocar los dos sitios.

La variación que no cabe como valor fijo se expresa con un juego cerrado de cuatro reglas —`fixed`,
`jsonField`, `bySignal`, `byLookup`—, no con condicionales sueltos en JSON. Así el runner de Stryker
sale del framework de test detectado y el comando de Dart de si el `pubspec` nombra Flutter, sin una
sola rama de código por lenguaje.

**Añadir un stack es añadir un archivo.** No hay que tocar la detección, ni el portón, ni el texto de
ninguna skill.

Y la pregunta "¿puede el portón verificar la mutación aquí?" se responde cruzando el `format` que
declara la tabla con los parsers que el portón tiene de verdad — no con una lista escrita a mano que
se queda vieja. Hoy se leen `elements`, `junit` y `pit`; Go, Rust y PHP no tienen parser todavía y la
skill lo dice sola.

### Coordinación entre lados: la deriva de contrato se detecta sola

En una feature full-stack el contrato se copia **idéntico** en la spec de cada lado. Cuando el back
lo cambia a media feature, edita su copia y sigue — y las otras se quedan viejas. El front implementa
contra algo que ya no existe y se entera al integrar, porque el portón solo detecta rutas
desaparecidas, no cambios de forma ni de código de error.

En modo worktree los lados son carpetas hermanas, así que el advisor lo compara y lo dice:

```text
NEXT_ACTION: sync_contract
REASON: El contrato de `back` cambió y tu copia quedó vieja (2 línea(s) de diferencia).
        Mira QUÉ cambió antes de seguir: implementar contra el contrato viejo se descubre al integrar.
COMMAND: diff specs/003-pago/contracts/api.md ../back/specs/003-pago/contracts/api.md
```

**Nadie tiene que acordarse de avisar**: se compara el contenido de dos archivos que deberían ser
iguales. Y va **antes** de `run_gate`, porque medir contra un contrato viejo gasta una corrida entera
—minutos, con mutación— para producir una evidencia que hay que tirar.

El comando **muestra** la diferencia; nunca sobrescribe. Copiar sería lo correcto casi siempre, pero
lo que se perdería —una nota que hubieras añadido a tu copia— no deja rastro, y quien adapta código
necesita saber QUÉ cambió.

### Y un buzón, para lo que ningún archivo dice

"Estoy bloqueado esperando el endpoint de pagos" no está en disco. Cada repo equipado lleva
`.chalc/mail.mjs`:

```bash
node .chalc/mail.mjs send --to front --message "Cambié el 422 a 409 en /pagos."
node .chalc/mail.mjs read
```

Sin demonio y sin proceso vivo: los lados comparten el sistema de archivos, así que quien escribe
deja el aviso directamente donde el otro lo lee, en `<workspace>/.chalc-mail/` — **fuera** de todos
los worktrees, para no ensuciar el `git status` de nadie.

La asimetría es deliberada: **enviar es opcional, leer no**. El advisor emite `read_mail` mientras
queden avisos sin abrir, así que uno escrito se ve seguro. Un aviso es una línea; lo que necesita más
es una conversación con el usuario.

En un mono-repo las dos cosas quedan apagadas y no emiten nada: no hay lados con quien coordinarse.

## Capa de IA opcional — generar specs desde una HU

El núcleo de Chalc no usa IA. Pero dos comandos **opt-in** (con tu API key) convierten una historia de
usuario en una especificación SDD. La IA aquí **solo estructura** lo que le pasas — no inventa.

### 1) `chalc config-ia` — configurar el cerebro (una vez), por paquetes

La configuración está dividida en **paquetes**: cada comando pregunta ÚNICAMENTE lo que estás
configurando — sin interrogatorios sobre tareas que no vas a usar:

```bash
chalc config-ia          # base: proveedor + API key + modelo default (empieza aquí)
chalc config-ia cli      # el EQUIPO de la shell: modelos líder / desarrollador / revisor
chalc config-ia spec     # solo el modelo de spec-ia
chalc config-ia qa       # solo el modelo de qa --agent
chalc config-ia repair   # solo el modelo de repair-plan
chalc config-ia doctor   # inspecciona la resolución final, sin gastar tokens
```

`config-ia cli` configura tu **equipo de agentes** y habla claro: cada agente se presenta con su
nombre y qué hace (el **AGENTE LÍDER** planea la tarea y escribe las órdenes de trabajo; el
**AGENTE DESARROLLADOR** escribe el código, orden por orden; el **AGENTE REVISOR** controla la
calidad de lo entregado). Por cada agente eliges dónde corre — el proveedor base u otro distinto
con su propia API key — así un líder/revisor en la nube puede dirigir a un desarrollador local
gratuito. Al guardar se muestra la **tarjeta del equipo** (agente → modelo → nube ☁ / local ⌂).
Ojo: en OpenRouter los modelos llevan prefijo del fabricante (`anthropic/claude-sonnet-4.6`, no
`claude-sonnet-4.6`).

> **Si cambias de proveedor (p. ej. Ollama → OpenRouter):** los modelos por tarea y los roles del
> equipo se guardan **contra el proveedor en el que los elegiste**. Al cambiar el proveedor base,
> Chalc suelta los que ya no existen allí (`gpt-oss:20b` enviado a OpenRouter da `400 not a valid
> model ID`), usa el nuevo modelo default y te lo avisa. Elige los nuevos con `config-ia
> spec|qa|repair` y `config-ia cli`; `config-ia doctor` te lista lo que haya quedado colgado.

El wizard base te pide elegir el proveedor de LLM y pegar tu API key:

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

   > **Nota (Word/PDF):** `.docx`, `.odt`, `.rtf` y `.html` se leen con Node puro (zip + zlib), así que
   > funcionan igual en Windows, macOS y Linux, sin herramientas extra. Para `.pdf` Chalc usa `pdftotext`
   > si está instalado y, si no, un extractor propio (solo PDFs de texto: uno escaneado necesita OCR).
   > El `.doc` legacy sí requiere LibreOffice (`soffice`) en el PATH, o guárdalo como `.docx`.
   | **Azure DevOps** | URL del work item + PAT → trae título + descripción + criterios |
   | **Jira** | URL del issue + email + token |
   | **Google Drive / URL** | la URL (export a texto) |
   | Pegar texto | el texto directo |

4. La IA genera `specs/NNN-feature/{spec,plan,tasks}.md` (en `full`, también data-model/research/quickstart/contracts).
5. Chalc valida la salida: requisitos `R#`, referencias en tasks, estructura mínima y aclaraciones pendientes.
6. Guarda una traza reproducible en `specs/<feature>/.chalc/ai-trace.jsonl` con hashes de prompt/output, nunca el contenido crudo.
7. Imprime un **comando hand-off** detallado para pegar en tu asistente y generar el código con TDD.

### 3) `chalc feature` — orquestador full-stack (HU → contrato + spec back + spec front + spec móvil)

```bash
chalc feature                                    # interactivo (pide rutas de front y back, y si hay app móvil)
chalc feature /ruta/front --back /ruta/back --lang es --no-branch
chalc feature /ruta/front --back /ruta/back --movil /ruta/app   # con repo móvil (alias: --mobile)
```

Toma **una** historia de usuario y coordina **dos repos** (front y back) — o **tres**, si la feature
además tiene **app móvil** — alrededor de un contrato de API:

1. Detecta el stack de cada repo (framework y lenguaje: Angular, NestJS, Flutter, React Native, Kotlin,
   Swift…), lo confirma contigo y los equipa si hace falta (SDD incluido).
2. Adquiere la HU con las mismas fuentes que `spec-ia` (archivo, Azure DevOps, Jira, URL o pegar).
3. La IA genera en orden: **contrato de API compartido** → **spec del back** → **spec del front** →
   **spec del móvil** (si hay), para que cada cliente consuma exactamente lo que el back promete. La
   app móvil es otro consumidor del MISMO contrato: no hay endpoints separados por cliente.
4. Escribe `specs/NNN-<slug>/` en TODOS los repos con el **mismo número**, guarda el contrato en
   `contracts/api.md` y estampa su huella en cada archivo (anti-drift: si regeneras la feature con un
   contrato distinto, te lo avisa). Re-ejecutar la misma HU es **idempotente**: reusa la carpeta del
   slug en vez de crear duplicados `NNN+1`.
5. Opcional: crea la rama `feat/<slug>` en todos los repos — todo o nada, y solo si todos los árboles
   están limpios. `--branch` / `--no-branch` deciden sin preguntar.
6. Cierra con un **hand-off único** para tu asistente que coordina la implementación en todos los repos.

Flags: `--back <ruta>`, `--movil <ruta>` (alias `--mobile`), `--lang es|en`, `--full` o `--mode lite|full` (modo SDD), `--branch`/`--no-branch`.

#### Modo worktree — varias HUs en paralelo

```bash
chalc feature /ruta/front --back /ruta/back --worktree             # workspaces aislados, uno por HU
chalc feature /ruta/front --back /ruta/back --worktree --workspace-dir D:/features --no-terminals
```

En interactivo, `chalc feature` pregunta **dónde trabajar**: en el repo sin rama (default, el
flujo de arriba), en el repo creando la rama, o en **worktrees aislados**. En modo worktree el
modelo es "N desarrolladores, una HU cada uno" — chalc prepara todo, tú ejecutas los agentes:

1. **Puerta bloqueante**: verifica cada repo (árbol limpio + al día, pull seguro fast-forward)
   ANTES de pedir las HUs y antes de gastar un solo token; en interactivo re-verifica hasta que
   los resuelvas, en no interactivo aborta.
2. Captura **una o más HUs** y reserva números `NNN` consecutivos por adelantado (sin
   colisiones entre HUs paralelas).
3. Genera los contratos **en secuencia**: el contrato de la HU N ve los anteriores para no
   redefinir sus rutas, y un chequeo de rutas duplicadas entre contratos te avisa (regex, sin IA).
4. Crea un **workspace por HU**: `<base>/NNN-slug/` con un worktree git por repo (`back/`,
   `front/` y `movil/` si hay) sobre la rama `feat/<slug>`, y todo DENTRO del worktree: skills
   equipadas, `specs/NNN-slug/`, el contrato con su lock y el hand-off del orquestador en
   `handoff.md`. El árbol principal de cada repo queda intacto. Todo-o-nada por HU; chalc nunca
   ejecuta `worktree remove`, `prune`, `--force`, commit ni push.
5. Ofrece abrir **Windows Terminal con un panel por HU — todos a la vista en una sola
   ventana** — cada panel ya ubicado en su workspace; el comando del agente (`claude`,
   `codex`…) lo escribes tú. Siempre escribe `open-all.ps1` (u `open-all.sh`) en la carpeta
   base para reabrirlas después.

Cada workspace es un "desarrollador" independiente: mismo contrato compartido, su propia rama, su
propio PR. Dos reglas: no muevas la carpeta de un workspace (los worktrees guardan rutas absolutas
hacia su repo), y al mergear el PR de un lado quita su worktree desde el repo original
(`git worktree remove <ruta>`).

Flags extra: `--worktree`, `--workspace-dir <carpeta>` (se recuerda para corridas futuras y para
el dashboard), `--terminals`/`--no-terminals`. Sea cual sea la ruta que indiques, chalc trabaja
siempre dentro de su subcarpeta `chalc-workspaces/` (la crea si falta, nunca la duplica) — no
riega workspaces en tu carpeta.

### 4) `chalc dashboard` — monitoreo solo-lectura de los workspaces (sin IA, sin tokens)

```bash
chalc dashboard                       # usa la carpeta recordada por chalc feature --worktree
chalc dashboard D:/features --port 4321
```

Con varias HUs corriendo en paralelo necesitas la vista de pájaro sin recorrer cada terminal.
`chalc dashboard` sirve una página local (solo localhost, solo GET, cero dependencias) con una
tarjeta por workspace: estado agregado (`sin arrancar / en curso / completa / rota`) y, por lado
(`back/`, `front/`, `movil/`), la rama, el progreso de tareas leído del `tasks.md` de esa spec,
si el árbol está limpio o con cambios, los commits sobre la rama base (`develop`/`main`/`master`)
y el asunto del último commit — más la **tarea en curso** (la primera pendiente del `tasks.md`),
para ver en qué va cada agente. Se refresca sola cada 5 segundos. Nunca escribe, nunca lanza
agentes — te dice **a qué terminal ir**. Ctrl+C lo apaga.

En una terminal interactiva la misma vista se pinta también **en vivo en la consola** (mismo
refresco, mismos datos) — navegador y terminal en tiempo real; `--no-watch` sirve solo la página.
Y en Windows, `chalc dashboard --console` (o `npm run dashboard --console`) abre el **puesto
de mando**: una ventana de Windows Terminal con layout fijo — el panel `dashboard` corriendo la
vista viva en un lado (la mitad de la ventana, siempre legible) y los workspaces apilados a
partes iguales en el otro, cada panel listo para que escribas el comando del agente. Si la página
ya está servida por otro proceso, la vista de consola sigue funcionando sola.

### Harness de fidelidad (la IA NO inventa)

El prompt (`lib/prompts/spec-gen.prompt.xml`) tiene un cerco estricto: la IA es un **estructurador, no un
autor**. Si algo no está en el documento, **no va al spec** — va como `[NEEDS CLARIFICATION]`. Nunca
inventa requisitos, campos, entidades, reglas, edge cases ni tecnología. Un documento corto produce un
spec corto lleno de preguntas abiertas — y eso es **correcto**, no un fallo.

## Shell interactiva del agente (`chalc-cli`)

```bash
npm run cli        # o `chalc-cli` si hiciste npm link
```

Una shell de agente tipo Claude Code pero **100 % local y provider-agnóstica**: usa exactamente el
proveedor/modelo que configuraste en `chalc config-ia` (por ejemplo un modelo local de Ollama) y trabaja
sobre el proyecto que le indiques — idealmente uno ya equipado por chalc.

- **Tools deterministas**: `read`, `list`, `grep`, `write`, `edit` y `bash` (con allowlist de comandos).
  Escrituras, ediciones y comandos de shell piden **aprobación por acción**: `y` aprueba, `n` rechaza,
  `a` aprueba todo lo que resta de la instrucción.
- **Skills equipadas**: el índice compacto entra siempre al prompt; el `SKILL.md` completo solo el de
  las skills relevantes a la tarea (las obligatorias — clean-code, SOLID… — entran siempre).
- **MCP del proyecto**: conecta los servidores del `.mcp.json` equipado, mostrándote el comando y
  pidiendo tu **aprobación por servidor** antes de ejecutarlo (abrir un repo ajeno nunca ejecuta nada a ciegas).
- **CCR integrado**: comprime observaciones voluminosas (archivos largos, salidas de shell) para no
  llenar la ventana del modelo local; el agente las expande bajo demanda con `recall`.
- **Control en runtime** (estilo Claude Code): `/model [nombre]` cambia el modelo **en caliente** sin
  perder la conversación, `/tools` lista las herramientas disponibles (fs + shell + MCP), `/tokens`
  muestra el consumo acumulado de la sesión, `/agents` muestra el equipo y su actividad actual,
  `/clear` reinicia la conversación, `/skills`, `/mcp`, `/help`, `/exit`.
- **Panel de agentes no bloqueante**: `/agents` se atiende inmediatamente aun cuando un agente esté
  trabajando o esperando aprobación; no pausa, interrumpe ni encola el comando. Muestra estado,
  duración, modelo/proveedor, tarea y última herramienta real del líder, desarrollador y revisor.
  La caja continúa disponible para escribir o encolar cambios.
- **Interrumpir sin salir**: `ESC` (en la TUI) o `Ctrl+C` (en modo scroll) cancelan el turno en curso —
  el agente se detiene al terminar el paso actual y NO ejecuta la acción que estuviera proponiendo;
  la sesión sigue viva. En la TUI además puedes **seguir escribiendo mientras trabaja**: las
  instrucciones se encolan y se procesan al terminar el turno.
- La TUI es la vista por defecto: la conversación vive en el buffer NORMAL de la terminal (scroll
  nativo — la sesión completa queda ahí incluso al salir) con la caja de entrada SIEMPRE fija abajo.
  La rueda del mouse / PgUp abre un modo lectura sobre el historial con la caja utilizable; si el
  agente imprime mientras lees, aparece el aviso "↓ N mensajes nuevos" y `End` vuelve al vivo.
  Con `CHALC_TUI=0` cae al modo scroll clásico (robusto en cualquier terminal).

**Modelos por rol** — el EQUIPO del cli (líder/desarrollador/revisor): se configura con **`chalc config-ia cli`**,
que pregunta solo lo de la shell (dónde corre cada rol y con qué modelo), con nombres entendibles y una
línea que explica qué hace cada uno. Cada rol puede vivir incluso en un proveedor DISTINTO con su propia
API key (p. ej. líder y revisor en la nube vía OpenRouter, y el desarrollador local en Ollama). Sin
configurar, todos usan el modelo default. `/model <nombre>` lo cambia en caliente dentro de la sesión.
Los demás paquetes también se configuran por separado: `config-ia spec`, `config-ia qa`, `config-ia repair`
— cada uno pregunta únicamente su modelo.

### El proceso del equipo (`/plan`): líder → desarrollador → revisor

`/plan <tarea>` ejecuta el equipo completo. Los agentes no chatean entre sí: se comunican por
artefactos auditables persistidos en el proyecto.

1. **El LÍDER planea y redacta el spec — en UNA sola llamada.** Recibe el contexto completo del
   proyecto (skills, MCP, archivo de instrucciones, constitución, arquitectura, README de carpetas)
   más la plantilla de spec del proyecto (`specs/_template/spec.md`) cuando existe. Entrega dos
   artefactos: `.chalc/plan.md` (el checklist de órdenes de trabajo, incluida la orden LITERAL que
   recibirá cada tarea) y el **spec** — siguiendo la plantilla del proyecto (requisitos EARS R1, R2…)
   con una sección `## Task N` por paso — guardado en la carpeta `specs/NNN-slug/` del proyecto
   (`.chalc/spec.md` de fallback) y enlazado desde el plan. Solo se sobrescriben archivos sellados
   por chalc: un spec escrito por el usuario (o por `spec-ia`) jamás se toca.
2. **El DESARROLLADOR ejecuta tarea por tarea.** Cada turno lleva UNA orden con SOLO su sección
   `## Task N` — contexto pequeño y explícito. Ante dudas debe LEER los specs; nunca los escribe
   (los pasos de redactar specs se enrutan al líder). El harness — nunca el modelo — marca cada `[x]`
   del `plan.md` con evidencia real (archivo escrito / comando ejecutado). Un run caído se retoma con
   `/plan` (sin argumento) desde la primera tarea pendiente, sin volver a pagar al líder.
3. **El REVISOR cierra el loop de calidad contra el contrato.** Recibe el spec aprobado, el plan de
   ejecución (con las `[x]` verificadas por el harness) y las skills relevantes, y revisa el diff en
   solo lectura en dos dimensiones: cumplimiento del contrato (requisitos, tareas completas) y calidad
   del código (convenciones, arquitectura, imports reales, nada de entregables huecos). Sus hallazgos
   son trazables ("incumple R2", con archivo y causa); las correcciones las ejecuta siempre el
   desarrollador con órdenes literales registradas, y cada ronda queda en `.chalc/review.md`. Tras su
   OK corre el build real del stack como portón determinista final.

Configuración opcional adicional en `~/.chalc/config.json`, bloque `cli`: `numCtx` (ventana del modelo),
`trust` (`safe`, `dev`, `trusted` para el perfil de shell), `allow` (allowlist custom del shell),
`mcpApproval` (`always` por defecto; usa `mutating` solo con servidores confiables), `mcpEnvAllowlist`
(variables de entorno que un MCP del proyecto puede resolver), `allowPrivateMcpHttp` (opt-in local para un MCP HTTP privado),
`budgetTokens` (presupuesto del prompt) y `maxSteps` (pasos por instrucción).

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

**La skill instala y configura; el portón verifica.** El 80% no se da por bueno: el portón de calidad
corre la herramienta y lee el score del archivo de reporte que escribe. Por eso la skill también te
manda habilitar el reporter `json` de Stryker y terminar la corrida de mutmut con `mutmut junitxml` —
sin archivo de reporte no hay nada que verificar, y la etapa bloquea. Chalc **no instala nada**: si
falta la herramienta, el portón imprime el comando exacto y se detiene.

## Internacionalización

- **CLI bilingüe (es/en)**: toda la salida al usuario pasa por `lib/i18n.mjs` y sale en el idioma elegido.
- **Fijar el idioma una sola vez**: `chalc lang es` o `chalc lang en` lo guarda en `~/.chalc/config.json`
  y se aplica a todos tus proyectos. `chalc lang` sin argumento abre el menú interactivo.
- **Precedencia del idioma**: `--lang` > `CHALC_LANG` > config guardada (`chalc lang`) > `LANG`/`LC_*` del SO > `en`.
- **Idioma del spec**: `chalc spec-ia --lang es|en|pt|…` (o el menú) — independiente del idioma del CLI.
- El método SDD (constitución, plantillas, reglas, gráfico explicativo) está en **es y en**.

## Seguridad

- La **API key** vive en `~/.chalc/config.json` (archivo `600` / directorio `700`), **nunca** en el proyecto ni en `.chalc.json`; entrada enmascarada y escritura local atómica.
- Las fuentes remotas para `spec-ia` usan timeout, límite de tamaño y validación de redirects; se bloquean protocolos no HTTP(S), `localhost` e IPs privadas/locales.
- Las llamadas a proveedores de IA tienen timeout para evitar procesos colgados.
- Las trazas IA guardan hashes, conteos y metadatos; no guardan prompts, documentos fuente ni secretos.
- Los ids de targets, skills, MCP, rules y métodos se validan como kebab-case seguro antes de usarse como rutas o imports.
- Instalar skills desde Git/GitHub o `skills.sh` requiere confirmación interactiva o `--allow-exec` en modo no interactivo.
- Los endpoints MCP HTTP remotos se validan contra DNS/IPs públicas, se rechazan redirects y cada llamada MCP pide aprobación por defecto. Un MCP HTTP privado es un opt-in local del usuario, nunca del proyecto.
- El login QA confirma su destino antes de aceptar credenciales; las capturas están desactivadas por defecto (`--screenshots`) y, cuando se solicitan, se guardan bajo `.chalc/qa-evidence/` ignorado por Git.
- Las actualizaciones de skills preparan, verifican y reemplazan atómicamente la copia vendorizada, conservando la versión anterior si falla la validación.
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
| **Codex CLI** | `AGENTS.md` | `.chalc/skills/<id>/` (referenciados) | `.codex/config.toml` (`[mcp_servers.<id>]`, bloque gestionado) |

Todos escriben además `.chalc.json` (manifiesto). Agregar otro asistente = un `targets/<nombre>.mjs` con `apply()`, reusando catálogo y reglas.
