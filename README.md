# ⚙️ Chalc

> [Español](README.es.md) · **English**

Chalc is a local CLI for **creating new projects** (`chalc init`) and **equipping existing projects** with development-assistant configuration: skills, MCP servers, rules, and working methods.

The equip flow (`chalc`) doesn't call AI models: it reads project signals (`package.json`, root files, globs), applies catalog rules, and writes the files the chosen target needs (Claude Code, GitHub Copilot, Cursor, or Gemini CLI).

AI is **opt-in** and used only in three commands, always with the API key configured by the user:
- **`chalc init`** — the AI *suggests* an architecture calibrated to your proposal (an ally, not an oracle; you decide).
- **`chalc spec-ia`** — turns a user story or document into SDD files (`spec.md`, `plan.md`, `tasks.md`).
- **`chalc qa --agent`** — verifies each `R#` requirement against the live app.

If you don't use those commands, Chalc needs no AI provider or tokens. AI calls use **CCR** (reversible compression) to save tokens and are provider-agnostic (OpenRouter, Anthropic, OpenAI, Gemini, or Ollama).

## The idea in one sentence

> Chalc doesn't analyze code with AI: it detects simple project signals and applies explicit catalog rules.

## Why it exists

The idea was born from a practical need: today many assistant configurations get resolved inside a CLI or a token-consuming session, and each project ends up depending on whatever was configured or remembered at that moment.

Chalc aims to separate those two things. AI can help when needed, but tools, rules, skills, MCP, and working methods should be able to travel with projects in an explicit, repeatable way. Instead of configuring everything by hand over and over, Chalc lets you maintain your own catalog and apply that "inheritance" to each project according to its stack.

This way, an Angular project can receive its Angular skills, a NestJS one its backend rules, all of them can inherit global rules like mutation testing, and each assistant receives the configuration in its own format. The intent isn't to replace the assistant, but to prepare the ground well so it works with the right context.

## Commands (quick reference)

| Command | What it does | AI? |
|---|---|---|
| `chalc lang [es\|en]` | Sets Chalc's language once (saved in `~/.chalc/config.json`) | no |
| `chalc init` | Creates a new project from scratch with a user-chosen architecture and equips it | opt-in (suggests arch.; `--no-ai` disables it) |
| `chalc` | Detects the stack and equips skills/MCP/method (interactive) | no |
| `chalc inspect` | Explains what it detects and why, without writing | no |
| `chalc doctor` | Validates the catalog (rules, skills, MCP, methods, targets) | no |
| `chalc configure` | Manages the catalog (rules/skills/MCP) via menu | no |
| `chalc install <source>` | Installs a skill into the catalog and wires it to a rule | no |
| `chalc spec` | Creates an empty `specs/NNN-feature` folder/template | no |
| `chalc config-ia` | Configures the AI provider + API key (once) | yes (setup) |
| `chalc ai-doctor` | Shows provider, profile, and models resolved per task | no |
| `chalc eval-ia` | Runs local evals of prompts/parsers without calling the provider | no |
| `chalc spec-ia` | User story (Azure DevOps/Jira/Drive/Word/paste) → spec/plan/tasks | yes |
| `chalc qa <path>` | Lists specs and validates the QA preflight (Docker + documentation) | no |
| `chalc qa <path> --spec 004-login --plan` | Generates the QA plan traceable to a spec's requirements | no |
| `chalc qa <path> --spec 004-login --env qa:up --plan` | Records the chosen startup environment in the plan (without running it yet) | no |
| `chalc qa <path> --spec 004-login --env serve --url http://localhost:3000 --up` | Brings up the environment, waits for the URL to respond, then tears it down | no |
| `chalc qa <path> --spec 004-login --env serve --url http://localhost:3000 --agent` | Brings up the app, runs the QA agent (verifies each R# against the live app), writes `qa/results.md`, and tears down | yes |
| `chalc qa <path> ... --agent --repair-plan` | Also generates `qa/repair-plan.md` from FAIL/BLOCKED | yes |
| `chalc qa <path> ... --agent --surface web\|api` | Forces the surface (browser vs HTTP) if autodetection gets it wrong | yes |

Every command has its `npm run <command>` equivalent (e.g. `npm run spec-ia`) in case you don't run `npm link`.
The whole CLI is **bilingual (es/en)**. By default it follows the operating system's language, but you can
set it once with **`chalc lang es`** or **`chalc lang en`** (it's saved and applies to all
your projects, without having to touch environment variables every time).

## How it's used (the idea: download, one command, interactive)

**One time only** — inside the `chalc/` folder, install the global command:
```bash
npm link        # creates the `chalc` command system-wide
chalc lang es   # (optional) sets the CLI language; saved forever
```

**Create a new project from scratch:**
```bash
chalc init angular
```

**Equip an existing project:**
```bash
cd my-project
chalc             # detects the language/stack and asks what to set up (interactive)
```

That's it. `chalc` guides you: pick an assistant (Claude…), confirm the stack, enable methods (SDD…), and apply.

### Without installing anything (from the chalc folder)
```bash
npm start                          # equips the current folder
npm start -- /path/to/project      # equips another project
npm run inspect -- /path/to/project
npm run doctor
npm run configure
npm run init -- angular mi-app --description "admin dashboard with roles and permissions"
npm run spec
```

### Flags (for automation / no questions)
```bash
chalc inspect               # explains what it detects and why, without writing
chalc init angular          # creates an Angular project from scratch
chalc doctor                # validates rules, catalog, MCP, methods, and targets
chalc ai-doctor             # validates the local AI config without spending tokens
chalc eval-ia               # local evals of AI/prompt contracts, no network
chalc configure             # creates rules and wires skills/MCP in a guided way
chalc spec                  # creates an empty specs/NNN-feature template
chalc --yes                 # uses the defaults, without asking
chalc --method sdd          # enables the SDD method without asking
chalc --dry-run             # shows the plan without writing anything
chalc --target claude       # picks the destination assistant
chalc install <fuente> --allow-exec  # allows Git/npx if you trust the source
chalc install <fuente> --force       # replaces an existing skill without asking
```

### Create from scratch (`chalc init`)

`chalc init` is the flow for taking the pain out of starting projects. Chalc reads a proposal
from text or a file (`--doc` supports Word/PDF/Markdown/TXT via `docread`), suggests architectures,
explains tradeoffs, and lets the user select. The rule is: **Chalc suggests, the user decides**.
The AI is never the authority: if it proposes something outside the catalog, Chalc discards it and falls back
to a deterministic recommendation.

Minimal implementation, Clean Code, SOLID, and modular architecture are **mandatory principles** in every project.
What the user chooses is the concrete architecture. It supports **Angular, NestJS, and .NET**, orchestrating
each one's **official** scaffolder (`ng new`, `nest new`, `dotnet new`):

```bash
chalc init                         # interactive: pick stack, describe the idea, pick architecture
chalc init angular
chalc init angular mi-admin --description "admin dashboard with users, roles, permissions, and API"
chalc init angular mi-admin --doc proposal.docx --architecture modular-clean-architecture --target claude
chalc init nestjs mi-api --description "ticketing API with authentication and queues"
chalc init dotnet mi-svc --architecture clean-architecture --verify   # --verify compiles at the end
```

#### Step by step (interactive flow)
1. **Stack** — you pick Angular / NestJS / .NET.
2. **Name and folder** — where the project is created (`--dir` to set it without asking).
3. **Proposal** — you describe the idea in text or attach a document (`--doc` reads Word/PDF/Markdown/TXT).
4. **The AI suggests the architecture** (calibrated to your proposal) and, if it has doubts that change the decision,
   **it asks you about them**. You pick the final architecture from the list. With `--no-ai` you use only the deterministic analysis.
5. **Summary and confirmation** — Chalc shows you what it's going to do (including the chosen CLI version) before creating.
6. It creates the project with the official scaffolder, reshapes it to the architecture, and **equips** it.

Available architectures (the AI recommends the lightest one that fits; you decide):

| Stack | Official scaffolder | Architectures |
|---|---|---|
| **Angular** | `ng new` | `modular-feature-first` (MVPs/dashboards) · `modular-clean-architecture` (domain/long-lived) · `enterprise-modular` (large teams) |
| **NestJS** | `nest new` | `modular-feature` · `clean-hexagonal` · `enterprise-microservices` |
| **.NET** | `dotnet new` | `webapi-simple` · `clean-architecture` (solution + Domain/Application/Infrastructure/Api layers) |
| **Flutter** | `flutter create` | `feature-first` · `clean-architecture` (`presentation/domain/data` layers) · `enterprise-modular` |

#### What makes `chalc init` special
- **It adapts to your machine:** it uses the version of the tool you **already have installed**. On Angular/NestJS
  it picks the CLI major **compatible with your Node** (e.g. Node 22.20 → `@angular/cli@20`, not 22 which aborts);
  on **Flutter** and **.NET** it directly uses the **installed SDK** (`flutter create` / `dotnet new`), and shows
  that version in the summary. It doesn't force you to update anything.
- **Every folder is born documented:** instead of an empty `.gitkeep`, each folder ships a `README.md` that
  explains —according to the architecture— what goes there, best practices, and which skills to apply. This way your AI has local context.
- **Detailed `docs/architecture.md`:** folder map, dependency rules, and how to add a feature.
- **The assistant reads it first:** `CLAUDE.md` (and equivalents) opens with a **Mandatory principles
  (always)** block and a reference to `docs/architecture.md` so the AI respects the architecture before creating files.
- **`--verify`** runs the build/analysis (`npm run build` / `dotnet build` / `flutter analyze`) to confirm the project compiles at birth.
- **Bilingual (es/en)** following `chalc lang` or the system language.

When creating, Chalc generates the official scaffolder's base project, the architecture's folders with their
`README.md`, `docs/architecture.md`, `specs/` (SDD method), the global skills (`minimal-implementation`,
`clean-code`, `solid-principles`, `modular-architecture`, `mutation-testing`), the stack's skills, the MCP, and the chosen AI target
(`CLAUDE.md`, Cursor, Copilot, or Gemini).

#### Extensible to any framework

`chalc init` isn't married to Angular/NestJS/.NET/Flutter: each stack is **a declarative entry** in
the stack registry (`lib/init.mjs`). Adding Vue, Django, Spring, Go, Rails… is a matter of defining its official
scaffolder, its architectures, and its folders — **the engine isn't touched**.

The flow is the same for all stacks:

```
chalc init <stack>
     │
     ├─ 1) OFFICIAL scaffolder  (uses the version installed on your machine)  ──►  base project
     │        ng new · nest new · dotnet new · flutter create · …
     │
     ├─ 2) reshape to the chosen architecture  ──►  folders + README per folder + docs/architecture.md
     │
     └─ 3) equip (rules/<stack>.json + global rule)  ──►  skills + MCP + SDD method (specs/) + assistant file
```

To finish equipping the new stack: create its skills in `catalog/skills/`, (optionally) its MCP in
`catalog/mcp/`, and wire them in `rules/<stack>.json`. Each architecture folder documents itself
via `lib/init-folders.mjs` (if you use a new folder role, add its guide there). Tool
versioning: if it's an npm CLI, add its Node→version table as in Angular/NestJS; if it's a local SDK
(like Flutter/.NET), just use the installed one.

### Understand before applying
```bash
chalc inspect /path/to/project
```

`inspect` is interactive by default and writes no files: it asks you which detail you want to see,
lists the rules that apply, the signals that triggered them (`package.json`, root files, or globs
like `*.csproj`), and the base plan that `chalc --yes` would set up. In non-interactive environments it prints the
full diagnosis.

### QA agent: actually test the app (`chalc qa --agent`)
With `--agent`, chalc **brings up your app, tests it like a person, and reports** each `R#` requirement:

1. **Brings up the environment** without forcing a port and **reads the URL the dev server announces** (`ng serve` → `:4201`,
   Vite → `:5173`…), respecting the app's config (forcing a port breaks Module Federation). `--url` sets it.
2. **Detects the surface** (web vs API) by stack; `--surface web|api` forces it.
3. **If the app requires authentication, it ASKS you** (doesn't fail silently): it detects guards/MSAL/Bearer interceptor
   and asks how to inject the session (token in localStorage/sessionStorage or `Authorization: Bearer` header).
4. **Explores and verifies with an AI agent** (provider-agnostic): the verdict is anchored in observed facts
   (HTTP status, visible text/element), never assumptions — a requirement without evidence stays `BLOCKED`,
   never a fabricated `PASS`. The step budget scales with the `R#` count (`--max-steps` adjusts it).
5. **Writes `qa/results.md`** (verdict + evidence per `R#`) and an **executable Playwright spec**
   (`qa/e2e/<spec>.agent.spec.mjs`, one test per `R#`); if you have `@playwright/test`, it **runs it with `npx playwright test`**.
6. **Tears down the environment** when done (always).

```bash
chalc qa . --spec 004-login --env start --agent           # interactive: asks surface/auth if needed
chalc qa . --spec 004-login --env start --agent --url http://localhost:3000 --surface web --max-steps 24 --allow-exec
chalc qa . --spec 004-login --env start --agent --repair-plan --allow-exec
chalc qa . --spec 004-login --repair-plan                 # generates repair-plan from existing qa/results.md
```

### Token handling in the QA agent (CCR, built in)
The agent (`qa --agent`) ships its own **CCR (Reversible Compression)**, inspired by Headroom but **with no
dependencies and provider-agnostic** (works the same with Anthropic, OpenRouter, OpenAI, Gemini, or Ollama):

- Bulky outputs (HTTP responses, DOM, logs) are replaced in the prompt by a compact reference
  `[CCR ref=... chars=N preview="..."]`.
- The original stays in a local cache with a TTL; if the model needs the full content, it requests
  `{"type":"recall","ref":"..."}` and gets it back whole during the next turn; then it's deferred again.
  **Reversible as long as the reference lives within its TTL.**
- **The plan and the R# requirements are never compressed** (fidelity). Only observations are deferred.
- It's on by default; disable it with `--no-ccr`. The `qa/results.md` report shows how much was deferred.

Optionally you can **also** point to an external proxy (Headroom or another OpenAI-compatible one) via
`CHALC_BASE_URL`, without touching code:
```bash
headroom proxy --port 8787
CHALC_BASE_URL=http://localhost:8787/v1 CHALC_PROVIDER=openai CHALC_API_KEY=$TU_KEY \
  chalc qa . --spec 004-login --env serve --url http://localhost:3000 --agent
```

### Check Chalc's health
```bash
chalc doctor
```

`doctor` is interactive by default and validates that the catalog is consistent: JSON rules,
references to skills/MCP, basic skill frontmatter, safe ids, `implies`, MCP
definitions, methods, and loadable targets. In non-interactive mode (`chalc doctor --yes`) it exits with code
`1` if it finds errors, useful for CI.

### Prepare a spec template
```bash
chalc spec
```

The official path is `specs/` in plural. `chalc spec` **does not write the specification**:
it only creates the folder and copies empty templates with placeholders. Each feature lives in
`specs/NNN-nombre/` with `spec.md`, `plan.md`, and `tasks.md` (plus extra files in `full` mode).
The real spec is written afterwards by a person or an assistant, inside `spec.md`.

## How it works

```
project   ──►  detects signals        ──►  applies rules      ──►  target projects
               (package.json, files)        (rules/*.json)          the assistant files
```

1. **Detects** the stack by real signals (`@angular/core`, `nest-cli.json`, etc.), including the nested projects typical of monorepos.
2. **Resolves** from the `catalog/` the skills + MCP the rule indicates.
3. **Projects** with the chosen `target` to the right files.

## Structure

```
chalc/
├── bin/chalc.mjs            the engine / CLI (pure Node, no dependencies)
├── lib/                     engine modules
│   ├── cli/args.mjs         testable flag/argument parser
│   ├── i18n.mjs             bilingual strings (es/en) + `chalc lang` (persistent language)
│   ├── ids.mjs              safe-id validation (kebab-case)
│   ├── net.mjs              fetch with timeout/limits and external-URL validation
│   ├── install.mjs          install/vendor skills (Git/skills.sh/local)
│   ├── targetkit.mjs        shared utilities for the targets (principles, architecture, blocks)
│   ├── docread.mjs          extracts text from Word/PDF/CSV/…
│   ├── sources.mjs          fetches the user story from Azure DevOps / Jira / Drive
│   ├── ── project creation (`chalc init`) ──
│   ├── init.mjs             stack registry: architectures, official scaffolder, CLI version per Node
│   ├── init-folders.mjs     per-folder guides (README.md) + folder map for architecture.md
│   ├── init-scaffold.mjs    reshapes the project to the architecture + writes docs/architecture.md
│   ├── initai.mjs           optional AI layer that suggests architecture (CCR + recall, clarifications)
│   ├── ── spec generation (`chalc spec-ia`) ──
│   ├── ai.mjs               multi-provider AI client (fetch) + ~/.chalc config (per-task profiles)
│   ├── ccr.mjs              reversible compression (CCR) to save tokens, provider-agnostic
│   ├── specgen.mjs          orchestrates spec generation
│   ├── specvalidate.mjs     validates the output (R#, traceability, minimum structure)
│   ├── aitrace.mjs          reproducible trace per spec (hashes, no raw content)
│   ├── aieval.mjs           local evals of prompts/parsers without calling the provider
│   ├── ── QA agent (`chalc qa --agent`) ──
│   ├── qa.mjs               QA plan, environments, reports (results.md / repair-plan.md)
│   ├── qaagent.mjs          agent that verifies each R# against the live app (provider-agnostic)
│   └── prompts/             system prompts (HALLC XML standard)
│       ├── spec-gen.prompt.xml       spec generation (fidelity harness)
│       ├── init-architect.prompt.xml architecture suggestion (ally, not oracle)
│       └── qa-agent.prompt.xml       fact-anchored QA verification
├── catalog/
│   ├── skills/              the real skills (self-contained, portable)
│   ├── mcp/                 MCP server definitions
│   ├── profiles/            per-task model profiles (chalc-default.json: spec/qa/repair)
│   └── methods/sdd/         the SDD method (constitution, es/en templates, rules, graphic)
├── rules/                   criteria: which signal = which stack = what gets installed (incl. global.json)
├── targets/
│   ├── claude.mjs           translator to Claude Code
│   ├── copilot.mjs          translator to GitHub Copilot
│   ├── cursor.mjs           translator to Cursor
│   └── gemini.mjs           translator to Gemini CLI
└── test/                    suite with `node --test` (parser, init, AI, QA, security, doctor)
```

## What it generates (Claude target)

| Concept | File in the project |
|---|---|
| Skills | `.claude/skills/<id>/` (real copy) |
| MCP | `.mcp.json` (merged, doesn't clobber what exists) |
| Rules/stack | `CLAUDE.md` (managed block between `<!-- chalc:start -->` and `<!-- chalc:end -->`) |
| Manifest | `.chalc.json` (what was installed and when) |

## Extending Chalc

- **New stack / language** → create `rules/<id>.json` with its `detect` (`anyDependency`/`anyFile`/`anyGlob` or the `all*` variants), `skills`, `mcp`. A specific stack can `"implies": ["javascript", …]` to suppress generic languages in the display.
- **New skill** → copy the folder to `catalog/skills/<id>/` and reference it in a rule (or use `chalc install` / `chalc configure`).
- **Universal skill** → add it to `rules/global.json` (`always:true`) so every project receives it (that's how `mutation-testing` works).
- **New MCP** → create `catalog/mcp/<id>.json`.
- **New assistant** → create `targets/<nombre>.mjs` with an `apply()` that writes that tool's files. The catalog and rules are reused as is.
- **New method** → a folder in `catalog/methods/<id>/` with `method.json` (label/description/explain/modes, all `{es,en}`), rules, and a scaffold per mode.
- **New CLI language** → add the key (`pt`, …) in `lib/i18n.mjs` and the `*.pt.*` / `scaffold-*-pt` files of the method.

## Multilanguage

Chalc detects the **language/stack** by real signals and adapts:

| Group | Included rules | Status |
|---|---|---|
| Web/TypeScript | JavaScript, TypeScript, Angular, NestJS | Angular/NestJS with skills; JS/TS detected |
| Mobile | Flutter, Dart, Swift, Kotlin | Flutter with skills + MCP (`dart`); Dart/Swift/Kotlin detected |
| Backend/General | .NET, Go, Java, PHP, Ruby, Python, Rust, Elixir | detected |
| Systems/IaC | C, C++, Shell, Terraform, Zig | detected |
| Other ecosystems | Clojure, Erlang, Haskell, Julia, Lua, Perl, R, Scala | detected |

Adding a language = creating `rules/<lang>.json` with its `detect`. It supports:
- `anyDependency`, `anyFile`, `anyGlob`: a single signal is enough.
- `allDependency`, `allFile`, `allGlob`: all those signals must be present.

## Configuring the catalog (rules, skills, and MCP)

The recommended way to maintain Chalc is interactively:

```bash
npm run configure
# or, if you ran npm link:
chalc configure
```

`configure` opens a menu to manage the catalog without editing JSON by hand:

| Option | What it does | Where it writes |
|---|---|---|
| Create a new rule | Creates a detection rule by files, globs, or dependencies | `rules/<id>.json` |
| Install a skill and add it to a rule | Downloads/copies the skill into the catalog and then asks which rule to wire it to | `catalog/skills/<id>/` + `rules/<id>.json` |
| Add an existing skill to a rule | Finds an already-installed skill and adds it to the chosen rule's `skills` | `rules/<id>.json` |
| Register a new MCP | Creates the MCP server definition | `catalog/mcp/<id>.json` |
| Add an existing MCP to a rule | Finds an MCP and adds it to the chosen rule's `mcp` or `optionalMcp` | `rules/<id>.json` |

The rule selector includes search by `id`, name, or language. For example, you can type
`angular`, `TypeScript`, `nest`, `python`, etc., and then pick the rule with arrow keys.

### Typical flow: adding a skill

```bash
npm run configure
```

1. Choose **Install a skill and add it to a rule**.
2. Paste the source: GitHub URL, `skills.sh` name, local path, or the full `npx skills add ...` command.
3. Chalc copies/vendors the skill into `catalog/skills/<id>/`. That's the permanent destination.
4. Chalc asks whether you want to wire it to a rule.
5. You search for the target rule and Chalc updates `rules/<id>.json`.

If the skill already exists, Chalc asks before replacing it. In direct/non-interactive mode you can use:

```bash
chalc install <fuente> --stack angular
chalc install <fuente> --stack angular --allow-exec
chalc install <fuente> --stack angular --force
```

Git/GitHub and `skills.sh` sources require running external tools (`git clone` or
`npx --yes skills add`). In interactive mode Chalc asks for confirmation before running them. In
non-interactive mode you must pass `--allow-exec` explicitly if you trust the source. Local paths
don't need that permission.

You can also paste full commands from the new skills CLI:

```bash
chalc install "npx skills add https://github.com/wshobson/agents --skill angular-migration" --allow-exec
```

### Typical flow: adding an MCP

```bash
npm run configure
```

1. Choose **Register a new MCP**.
2. Define `id`, description, command, and arguments.
3. If it requires secrets, add the corresponding variable/env.
4. Chalc writes `catalog/mcp/<id>.json`.
5. You can wire it immediately to a rule as required (`mcp`) or optional (`optionalMcp`).

Conceptual MCP example:

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

After configuring, check the catalog's health:

```bash
npm run doctor -- --yes
```

## Installing new skills (what keeps the system alive)

Skills from skills.sh (or any marketplace) land in `~/.claude/skills`, **never** in Chalc's catalog.
That's why Chalc installs them into a temp folder, **copies them into the catalog** (dereferencing symlinks), and
**wires them to a rule** by asking which stack they belong to. This way the rules fill up through use.

```bash
chalc install <fuente> [--stack <id>] [--allow-exec]
```

`<fuente>` can be:
- **Git/GitHub URL** — `https://github.com/owner/repo`, `.../tree/<rama>/<subcarpeta>`, or `*.git`.
- **skills.sh** — a name/URL; Chalc uses `npx skills add` under the hood and vendors the result.
- **Local path / folder** — a direct copy into the catalog.

For safety, Git/GitHub and `skills.sh` aren't run automatically in non-interactive mode:
use `--allow-exec` when the source is trusted. In interactive mode, Chalc asks before running.

After installing, Chalc asks **which stack it belongs to** (Angular, Nest, … or *Global* = all projects)
and writes the skill into `rules/<stack>.json`. From then on, every project of that stack receives it.
If the skill already exists, Chalc asks before replacing it; in non-interactive mode you must use `--force`.
Each vendored skill includes `.chalc-skill.json` with source, date, and content hash.

> You can also install **within the interactive flow** (`chalc`): it offers you *"Install a new skill?"*,
> wires it to a rule, and equips it right away in the current project.

## Working methods

Besides per-stack skills/MCP, Chalc can set up **methods** (ways of working), independent of the language.

### Spec-Driven Development (SDD)

The **specification is the source of truth**, not the code. Based on GitHub Spec Kit + AWS Kiro.
Five phases in order: **Constitution → Specify → Plan → Tasks → Implement**.

- **EARS**: requirements are written to be testable — `WHEN <evento> THE SYSTEM SHALL <comportamiento>` — with an id (`R1`, `R2`…).
- **Test-First (non-negotiable)**: no code before a test that **fails** (Red), approved. Then the minimal code (Green), refactor.
- **Mutation testing**: after Green/refactor, the tests must **kill mutants** (score ≥ 80%). See the *Test-First + Mutation testing* section.
- **Traceability**: each task and each test points to a requirement (`R#`).

When you choose it in interactive mode, Chalc **shows a brief diagram** explaining SDD before integrating it, and asks the **project size**:

| Mode | For | Sets up in `specs/` |
|---|---|---|
| `lite` | small projects | `constitution.md` + `_template/{spec,plan,tasks}.md` |
| `full` | large projects | the above + `research.md`, `data-model.md`, `contracts/`, `quickstart.md` |

The method is injected into the assistant's file (`CLAUDE.md`, etc.) as rules, and leaves `specs/` in the project.
Without interactive: `chalc --method sdd:lite` or `chalc --method sdd:full` (or `--mode lite|full`).
The constitution, templates, and rules are in **es and en** (they follow the system language).

## Optional AI layer — generating specs from a user story

Chalc's core doesn't use AI. But two **opt-in** commands (with your API key) turn a user
story into an SDD specification. The AI here **only structures** what you give it — it doesn't make things up.

### 1) `chalc config-ia` — configure the brain (once)

```bash
chalc config-ia        # or: npm run config-ia
```

Choose the LLM provider and paste your API key:

| Provider | Notes |
|---|---|
| **OpenRouter** | one key → Claude, GPT, Gemini, Llama… (recommended) |
| **Anthropic** | native Claude |
| **OpenAI** | GPT |
| **Google Gemini** | Gemini |
| **Ollama** | local, no key |

The config is saved in `~/.chalc/config.json` (`600` permissions, **outside the project**, never committed).
The key is typed **masked**. Environment override: `CHALC_PROVIDER`, `CHALC_API_KEY`, `CHALC_MODEL`, `CHALC_BASE_URL`.
You can also split models per task with `CHALC_SPEC_MODEL`, `CHALC_QA_MODEL`, and `CHALC_REPAIR_MODEL`.
HTTP client with native `fetch`, zero dependencies.

Chalc supports versionable profiles in `catalog/profiles/*.json`. The bundled profile (`chalc-default`) defines:
- `spec`: a strong model to convert user stories/documents into SDD.
- `qa`: a cheaper/faster model for verification loops.
- `repair`: a strong model if assisted repair is later added; the current plan is generated deterministically from QA.

You can inspect the final resolution without consuming tokens:

```bash
chalc ai-doctor
CHALC_QA_MODEL=mi-modelo-rapido chalc ai-doctor
```

> **Copilot isn't a generation provider** (it doesn't expose an API with a key) — it's a *target*. To generate, use
> OpenRouter / Anthropic / OpenAI / Gemini / Ollama.

### 2) `chalc spec-ia` — user story → spec/plan/tasks

```bash
chalc spec-ia                                   # interactive
chalc spec-ia /path/to/project --lang es --doc my-story.docx
```

Flow:
1. **Project path.** If it has no SDD, Chalc **sets it up on the fly** (`specs/` with constitution + templates).
2. **Spec language** (independent of the CLI language): `--lang es` or you pick it in the menu.
3. **User story source** (where the user story comes from):

   | Source | What it asks for |
   |---|---|
   | Local file | path to `.md` / `.txt` (recommended: read directly, no extra tools) / Word / PDF / Excel→CSV |
   | **Azure DevOps** | work item URL + PAT → brings title + description + criteria |
   | **Jira** | issue URL + email + token |
   | **Google Drive / URL** | the URL (exported to text) |
   | Paste text | the text directly |

4. The AI generates `specs/NNN-feature/{spec,plan,tasks}.md` (in `full`, also data-model/research/quickstart/contracts).
5. Chalc validates the output: `R#` requirements, references in tasks, minimal structure, and pending clarifications.
6. It saves a reproducible trace in `specs/<feature>/.chalc/ai-trace.jsonl` with prompt/output hashes, never the raw content.
7. It prints a detailed **hand-off command** to paste into your assistant and generate the code with TDD.

### Fidelity harness (the AI does NOT make things up)

The prompt (`lib/prompts/spec-gen.prompt.xml`) has a strict fence: the AI is a **structurer, not an
author**. If something isn't in the document, **it doesn't go into the spec** — it goes as `[NEEDS CLARIFICATION]`. It never
invents requirements, fields, entities, rules, edge cases, or technology. A short document produces a
short spec full of open questions — and that's **correct**, not a failure.

## Test-First + Mutation testing (quality)

The SDD method enforces **Test-First** (Red → Green → Refactor) and **mutation testing** across 4 layers
(constitution, assistant rules, the `tasks.md` template, and the `spec-ia` prompt). The universal skill
`mutation-testing` is wired to the `global` rule, so **every project receives it**, with the
right tool per stack (**project-local** install, never global):

| Stack | Tool | Install (project-local) |
|---|---|---|
| JS/TS (Angular, Nest, Node) | Stryker | `npm i -D @stryker-mutator/core` + el runner (jest/karma/…) |
| .NET / C# | Stryker.NET | `dotnet new tool-manifest` → `dotnet tool install dotnet-stryker` |
| Python | mutmut | `uv add --dev mutmut` |
| Java · Go · Rust · PHP | PIT · Gremlins · cargo-mutants · Infection | (ver el skill) |

Goal: **mutation score ≥ 80%** on critical logic. These are **dev-only** tools (they don't go to
production); audit them with `npm audit` / `dotnet list package --vulnerable` / `pip-audit` / `composer audit`.

## Internationalization

- **Bilingual CLI (es/en)**: all user-facing output goes through `lib/i18n.mjs` and comes out in the chosen language.
- **Set the language once**: `chalc lang es` or `chalc lang en` saves it in `~/.chalc/config.json`
  and applies to all your projects. `chalc lang` with no argument opens the interactive menu.
- **Language precedence**: `--lang` > `CHALC_LANG` > saved config (`chalc lang`) > `LANG`/`LC_*` of the OS > `en`.
- **Spec language**: `chalc spec-ia --lang es|en|pt|…` (or the menu) — independent of the CLI language.
- The SDD method (constitution, templates, rules, explanatory diagram) is in **es and en**.

## Security

- The **API key** lives in `~/.chalc/config.json` (`600` permissions), **never** in the project or in `.chalc.json`; masked input.
- Remote sources for `spec-ia` use timeout, size limit, and redirect validation; non-HTTP(S) protocols, `localhost`, and private/local IPs are blocked.
- Calls to AI providers have a timeout to avoid hung processes.
- AI traces store hashes, counts, and metadata; they don't store prompts, source documents, or secrets.
- The ids of targets, skills, MCP, rules, and methods are validated as safe kebab-case before being used as paths or imports.
- Installing skills from Git/GitHub or `skills.sh` requires interactive confirmation or `--allow-exec` in non-interactive mode.
- The **mutation tools** are installed **project-local** (dev-dependency / tool-manifest), never `-g` global.
- Chalc **doesn't overwrite** your `CLAUDE.md`: it only edits its block between `<!-- chalc:start -->` and `<!-- chalc:end -->`; the rest is preserved.
- Skills are **vendored** (real content, no symlinks) and ship with `.chalc-skill.json` containing source, date, and hash.

## Tests and CI

Chalc uses Node's native runner:

```bash
npm test
```

The suite covers the argument parser, stack detection with fixtures versioned in `test/fixtures/`,
security blocks (unsafe `target`, external install without `--allow-exec`, local URLs), and
`doctor`. For CI, the recommended minimum is:

```bash
npm test
npm run doctor -- --yes
node bin/chalc.mjs eval-ia --yes
```

## Supported targets (assistants)

The same neutral catalog is projected to each tool's native format. You pick the target in the interactive flow or with `--target`.

| Target | Instructions | Skills | MCP |
|---|---|---|---|
| **Claude Code** | `CLAUDE.md` | `.claude/skills/<id>/` | `.mcp.json` |
| **GitHub Copilot** | `.github/copilot-instructions.md` | `.chalc/skills/<id>/` (referenced) | `.vscode/mcp.json` (`servers`, type `stdio`) |
| **Gemini CLI** | `GEMINI.md` | `.chalc/skills/<id>/` (referenced) | `.gemini/settings.json` (`mcpServers`) |
| **Cursor** | `.cursor/rules/chalc-*.mdc` | `.chalc/skills/<id>/` + a `.mdc` per skill | `.cursor/mcp.json` (`mcpServers`) |

All of them also write `.chalc.json` (manifest). Adding another assistant = one `targets/<nombre>.mjs` with `apply()`, reusing the catalog and rules.
