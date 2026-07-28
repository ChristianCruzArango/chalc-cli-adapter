# ⚙️ Chalc

> [Español](README.es.md) · **English**

Chalc is a local CLI for **creating new projects** (`chalc init`) and **equipping existing projects** with development-assistant configuration: skills, MCP servers, rules, and working methods.

The equip flow (`chalc`) doesn't call AI models: it reads project signals (`package.json`, root files, globs), applies catalog rules, and writes the files the chosen target needs (Claude Code, GitHub Copilot, Cursor, Gemini CLI, or Codex CLI).

AI is **opt-in** and used only in three commands, always with the API key configured by the user:
- **`chalc init`** — the AI *suggests* an architecture calibrated to your proposal (an ally, not an oracle; you decide).
- **`chalc spec-ia`** — turns a user story or document into SDD files (`spec.md`, `plan.md`, `tasks.md`).
- **`chalc qa --agent`** — verifies each `R#` requirement against the live app.

If you don't use those commands, Chalc needs no AI provider or tokens. AI calls use **CCR** (reversible compression) to save tokens and are provider-agnostic (OpenRouter, Anthropic, OpenAI, Gemini, or Ollama). And **whenever the AI is consulted, Chalc shows how many tokens it used** (input/output/total and number of calls), so you know the cost.

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
| `chalc verify [path]` | Verifies a project: completeness (folders/README, architecture.md, specs/) + **architecture boundaries** (layers) | no |
| `chalc doctor` | Validates the catalog (rules, skills, MCP, methods, targets) | no |
| `chalc configure` | Manages the catalog (rules/skills/MCP) via menu | no |
| `chalc install <source>` | Installs a skill into the catalog and wires it to a rule | no |
| `chalc spec` | Creates an empty `specs/NNN-feature` folder/template | no |
| `chalc config-ia` | Configures the AI by packages: base (provider + key), `cli` (leader/developer/reviewer team), `spec`, `qa`, `repair` | yes (setup) |
| `chalc ai-doctor` | Shows provider, profile, and models resolved per task | no |
| `chalc eval-ia` | Runs local evals of prompts/parsers without calling the provider | no |
| `chalc spec-ia` | User story (Azure DevOps/Jira/Drive/Word/paste) → spec/plan/tasks | yes |
| `chalc feature` | Full-stack orchestrator: ONE user story → API contract + back spec + front spec + optional mobile spec (same `NNN` in every repo) | yes |
| `chalc-cli` | Interactive agent shell over your equipped project (approval-gated tools, skills, and MCP) | yes |
| `chalc qa <path>` | Lists specs and validates the QA preflight (Docker + documentation) | no |
| `chalc qa <path> --spec 004-login --plan` | Generates the QA plan traceable to a spec's requirements | no |
| `chalc qa <path> --spec 004-login --env qa:up --plan` | Records the chosen startup environment in the plan (without running it yet) | no |
| `chalc qa <path> --spec 004-login --env serve --url http://localhost:3000 --up` | Brings up the environment, waits for the URL to respond, then tears it down | no |
| `chalc qa <path> --spec 004-login --env serve --url http://localhost:3000 --agent` | Brings up the app, runs the QA agent (verifies each R# against the live app), writes `qa/results.md`, and tears down | yes |
| `chalc qa <path> ... --agent --repair-plan` | Also generates `qa/repair-plan.md` from FAIL/BLOCKED | yes |
| `chalc deliver <path> --spec 004-login --env serve --allow-exec` | QA → repair-plan → verify → rerun flow; stops on FAIL/BLOCKED so you can repair and continue with `--rerun` | yes |
| `chalc qa <path> ... --agent --surface web\|api` | Forces the surface (browser vs HTTP) if autodetection gets it wrong | yes |
| `chalc tokens <path> [--json]` | Shows the project's accumulated AI spend (tokens + estimated USD) by command, task/role, and model | no |
| `chalc update [id…] [--check]` | Syncs installed skills with their source (git/skills.sh/local) and regenerates `skills-lock.json`; `--check` only reports | no |

Most commands have an `npm run <command>` equivalent (e.g. `npm run spec-ia`) in case you don't run
`npm link`; the exceptions are `qa`, `deliver`, `verify`, `install`, and `feature`, which you invoke as `npm start -- <command> …`.
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
3. **Proposal** — you describe the idea in text or attach a document (`--doc` reads Word/PDF/Markdown/TXT;
   Word/PDF require system tools — see the note under `spec-ia` —; on Windows use `.md`/`.txt`).
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
- **Automatic verification at the end** (no tokens): checks that everything is in place (folders with README, `docs/architecture.md`, `specs/`, manifest, assistant file) and the **architecture boundaries**, closing with a **✓ Project created successfully**. The same runs later with `chalc verify` on any project.
- **`--verify`** runs the build/analysis (`npm run build` / `dotnet build` / `flutter analyze`) to confirm the project compiles at birth.
- **Bilingual (es/en)** following `chalc lang` or the system language.

When creating, Chalc generates the official scaffolder's base project, the architecture's folders with their
`README.md`, `docs/architecture.md`, `specs/` (SDD method), the global skills (`minimal-implementation`,
`clean-code`, `solid-principles`, `modular-architecture`, `mutation-testing`), the stack's skills, the MCP, and the chosen AI target
(`CLAUDE.md`, Cursor, Copilot, Gemini, or Codex).

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
3. **If the app requires authentication, it gets a session for you** (doesn't fail silently) — see "QA login" below.
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

### QA login: chalc gets the token for you (don't paste JWTs)
To test protected endpoints the agent needs a session. Pasting a raw JWT is painful (it expires, it's huge), so
chalc can **log in for you**: declare your app's login contract once and chalc asks *which user* and mints the token.

Session resolution order for `--agent`:
1. **Direct token** (CI or external token): `--auth-token <jwt>` or `CHALC_QA_TOKEN` — used as-is, wins over everything.
2. **Login by credentials**: if the project declares a `qa.login` contract, chalc asks for the credentials
   (interactive) — or reads them from `--auth-<field>` / `CHALC_QA_<FIELD>` (non-interactive) — brings the app up,
   calls the login endpoint, extracts the token, and injects it. Interactive mode shows and confirms the destination
   before requesting secrets; non-interactive mode requires `--allow-login`. By default the endpoint must be the app's
   own origin or loopback (`--allow-external-login` is an explicit HTTPS-only exception). Credentials are never printed or stored.
3. **Classic**: detects guards/MSAL/Bearer interceptor and asks how to inject the session (storage or header).

Declare the contract in `.chalc.json` (`qa.login`) — or per spec in `specs/<id>/qa/inputs.json` (`login`, takes precedence):

```jsonc
// .chalc.json — example matching a dev login endpoint that mints a token from a userType
"qa": { "login": {
  "url": "http://localhost:5002/api/auth/generate-token",
  "method": "POST",
  "query":     { "userType": "${userType}" },   // ${field} is filled from the collected credentials
  "tokenPath": "datos.token",                    // dot-path to the token in the JSON response
  "fields":    [{ "name": "userType", "label": "User type", "default": "admin" }]
} }
// classic login instead: "body": { "email": "${email}", "password": "${password}" }, "tokenPath": "token",
//                        "fields": [{ "name": "email" }, { "name": "password", "secret": true }]
```

```bash
chalc qa . --spec 012 --env dotnet --agent --allow-exec            # interactive: asks "User type [admin]"
CHALC_QA_USERTYPE=admin chalc qa . --spec 012 --agent --allow-exec --allow-login  # non-interactive (CI)
```

A failed login (bad credentials, endpoint down, `tokenPath` missing) aborts the agent with a clear error and still
tears the environment down — it never runs the agent unauthenticated.

### Deliver flow: QA → repair → verify → rerun
`chalc deliver` chains a release-quality gate without inventing fixes:

1. Runs `qa --agent --repair-plan`.
2. If any `FAIL`/`BLOCKED` remains, writes `qa/repair-plan.md` and stops so you can apply the repair.
3. Continue with `chalc deliver ... --rerun`: it runs `verify` first; if that passes, it reruns QA.

```bash
chalc deliver . --spec 004-login --env start --allow-exec
chalc deliver . --spec 004-login --env start --rerun --allow-exec
```

### AI spend history: `chalc tokens`
Every AI call (from `spec-ia`, `feature`, `qa`, `deliver`, `init`, and the `chalc-cli` shell) is recorded in the
project's `.chalc/tokens.jsonl` — date, command, task/role, provider, model, and tokens. `chalc tokens` aggregates
that history so you can see where the money goes and measure savings:

```bash
chalc tokens .           # total + breakdown by command, task/role, and model, with estimated USD
chalc tokens . --json    # same aggregate as clean JSON (for scripts/CI)
```

- USD amounts are **estimates** from a local price table (per 1M tokens); models without a known price are
  flagged as such — never guessed. Local providers (Ollama) count as $0.
- You can set or override prices in `~/.chalc/config.json`:
  `"prices": { "<model>": { "input": USD_per_1M, "output": USD_per_1M } }`.
- Logging is best-effort and append-only: it never breaks a command, and the spend is persisted even when a
  command fails after paying for tokens.

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

1. **Detects** the stack by real signals anchored to the project root (`package.json`, `angular.json`, `nest-cli.json`, root globs, etc.). In monorepos, run `chalc` inside the package/app you want to equip.
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
│   ├── detect.mjs           stack/rule detection from project-root signals
│   ├── net.mjs              fetch with timeout/limits and external-URL validation
│   ├── install.mjs          install/vendor skills (Git/skills.sh/local)
│   ├── targetkit.mjs        shared utilities for the targets (principles, architecture, blocks)
│   ├── docread.mjs          extracts text from Word/PDF/CSV/…
│   ├── sources.mjs          fetches the user story from Azure DevOps / Jira / Drive
│   ├── ── project creation (`chalc init`) ──
│   ├── init.mjs             stack registry: architectures, official scaffolder, CLI version per Node
│   ├── init-folders.mjs     per-folder guides (README.md) + folder map for architecture.md
│   ├── init-scaffold.mjs    reshapes the project to the architecture + writes docs/architecture.md
│   ├── verify.mjs           project completeness verification (folders, docs, specs, manifest)
│   ├── verify-boundaries.mjs architecture boundary linter (layers, no AI) — `chalc verify`
│   ├── initai.mjs           optional AI layer that suggests architecture (CCR + recall, clarifications)
│   ├── ── spec generation (`chalc spec-ia`) ──
│   ├── ai.mjs               multi-provider AI client (fetch) + ~/.chalc config (per-task profiles)
│   ├── tokenmeter.mjs       measures the tokens the AI consumed and shows them to the user
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
├── cli/                     interactive shell and agent-team orchestrator
│   ├── index.mjs            REPL, slash commands, live queue, and leader/dev/reviewer coordination
│   ├── session.mjs          session, per-role models, context, and observable lifecycle
│   ├── agents/
│   │   └── registry.mjs     run registry: status, task, tool, timing, and errors
│   ├── ui/
│   │   ├── screen.mjs       pinned-input TUI, history, and typing while agents work
│   │   ├── render.mjs       shared ANSI presentation
│   │   └── agents.mjs       adaptive `/agents` panel/graph
│   ├── engine/              plan→action→observation loop, planner, reviewer, and budgeting
│   ├── tools/               confined filesystem and approval-gated shell
│   ├── mcp/                 stdio/HTTP MCP clients and agent-tool adaptation
│   └── skills/loader.mjs    equipped skills → relevant agent context
├── catalog/
│   ├── skills/              the real skills (self-contained, portable)
│   ├── mcp/                 MCP server definitions
│   ├── profiles/            per-task model profiles (chalc-default.json: spec/qa/repair)
│   └── methods/sdd/         the SDD method (constitution, es/en templates, rules, graphic)
├── rules/                   criteria: which signal = which stack = what gets installed (incl. global.json)
├── targets/
│   ├── claude.mjs           translator to Claude Code
│   ├── codex.mjs            translator to Codex CLI
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

### Keeping installed skills fresh: `chalc update`
Every installed skill keeps a manifest (`catalog/skills/<id>/.chalc-skill.json`) with its source and a
content hash. `chalc update` re-downloads each source, compares hashes, and replaces only what actually
changed — then regenerates `skills-lock.json` as a faithful mirror of the catalog:

```bash
chalc update --check                 # report only: up to date / outdated / error (writes nothing)
chalc update                         # apply updates (asks before running git/npx; --allow-exec skips the question)
chalc update angular-migration       # update only the given skill(s)
```

- A broken source doesn't abort the rest: it's reported per skill and the run continues.
- Catalog builtins (no source) are skipped and counted as non-updatable.
- After updating, re-run `chalc apply` on your projects to propagate the new skill content.

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

### 1) `chalc config-ia` — configure the brain (once), by packages

Configuration is split into **packages** so each command asks ONLY what you are configuring —
no long interrogation about tasks you won't use:

```bash
chalc config-ia          # base: provider + API key + default model (start here)
chalc config-ia cli      # the shell TEAM: leader / developer / reviewer models
chalc config-ia spec     # model for spec-ia only
chalc config-ia qa       # model for qa --agent only
chalc config-ia repair   # model for repair-plan only
chalc config-ia doctor   # inspect the final resolution, no tokens spent
```

`config-ia cli` configures your **agent team** and speaks plain language: each agent is introduced
with its name and what it does (the **LEADER AGENT** plans the task and writes the work orders; the
**DEVELOPER AGENT** writes the code, order by order; the **REVIEWER AGENT** checks the delivered
quality). For every agent you pick where it runs — the base provider or a different one with its own
API key — so a cloud leader/reviewer can direct a free local developer. On save it renders the
**team card** (agent → model → cloud ☁ / local ⌂). Note: on OpenRouter, model ids carry the vendor
prefix (`anthropic/claude-sonnet-4.6`, not `claude-sonnet-4.6`).

> **Switching provider (e.g. Ollama → OpenRouter):** per-task models and team roles are saved
> **against the provider they were chosen on**. When you change the base provider, Chalc drops the
> ones that no longer exist there (`gpt-oss:20b` sent to OpenRouter is a `400 not a valid model ID`)
> and falls back to the new default model, telling you so. Pick the new ones with `config-ia
> spec|qa|repair` and `config-ia cli`; `config-ia doctor` lists any leftovers.

The base wizard asks you to choose the LLM provider and paste your API key:

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

   > **Note (Word/PDF):** `.docx`, `.odt`, `.rtf` and `.html` are read with pure Node (zip + zlib), so they
   > work the same on Windows, macOS and Linux — no extra tools. For `.pdf` Chalc uses `pdftotext` if it is
   > installed and otherwise falls back to a built-in extractor (text PDFs only: a scanned PDF still needs
   > OCR). Legacy `.doc` requires LibreOffice (`soffice`) in the PATH, or just save it as `.docx`.
   | **Azure DevOps** | work item URL + PAT → brings title + description + criteria |
   | **Jira** | issue URL + email + token |
   | **Google Drive / URL** | the URL (exported to text) |
   | Paste text | the text directly |

4. The AI generates `specs/NNN-feature/{spec,plan,tasks}.md` (in `full`, also data-model/research/quickstart/contracts).
5. Chalc validates the output: `R#` requirements, references in tasks, minimal structure, and pending clarifications.
6. It saves a reproducible trace in `specs/<feature>/.chalc/ai-trace.jsonl` with prompt/output hashes, never the raw content.
7. It prints a detailed **hand-off command** to paste into your assistant and generate the code with TDD.

### 3) `chalc feature` — full-stack orchestrator (user story → contract + back spec + front spec + mobile spec)

```bash
chalc feature                                     # interactive (asks for front and back paths, and whether there's a mobile app)
chalc feature /path/front --back /path/back --lang en --no-branch
chalc feature /path/front --back /path/back --movil /path/app   # with a mobile repo (alias: --mobile)
```

It takes **one** user story and coordinates **two repos** (front and back) — or **three**, if the
feature also has a **mobile app** — around an API contract:

1. Detects each repo's stack (framework and language: Angular, NestJS, Flutter, React Native, Kotlin,
   Swift…), confirms it with you, and equips them if needed (SDD included).
2. Acquires the user story from the same sources as `spec-ia` (file, Azure DevOps, Jira, URL, or paste).
3. The AI generates, in order: **shared API contract** → **back spec** → **front spec** → **mobile
   spec** (if there is one), so every client consumes exactly what the back promises. The mobile app
   is another consumer of the SAME contract: no separate endpoints per client.
4. Writes `specs/NNN-<slug>/` in EVERY repo with the **same number**, stores the contract in
   `contracts/api.md`, and stamps its fingerprint into every file (anti-drift: if you regenerate the
   feature against a different contract, it warns you). Re-running the same story is **idempotent**:
   it reuses the slug's folder instead of creating `NNN+1` duplicates.
5. Optional: creates the `feat/<slug>` branch in every repo — all or nothing, and only if all trees
   are clean. `--branch` / `--no-branch` decide without asking.
6. Ends with a **single hand-off** for your assistant that coordinates the implementation across all repos.

Flags: `--back <path>`, `--movil <path>` (alias `--mobile`), `--lang es|en`, `--full` or `--mode lite|full` (SDD mode), `--branch`/`--no-branch`.

### Fidelity harness (the AI does NOT make things up)

The prompt (`lib/prompts/spec-gen.prompt.xml`) has a strict fence: the AI is a **structurer, not an
author**. If something isn't in the document, **it doesn't go into the spec** — it goes as `[NEEDS CLARIFICATION]`. It never
invents requirements, fields, entities, rules, edge cases, or technology. A short document produces a
short spec full of open questions — and that's **correct**, not a failure.

## Interactive agent shell (`chalc-cli`)

```bash
npm run cli        # or `chalc-cli` if you ran npm link
```

An agent shell in the spirit of Claude Code but **100% local and provider-agnostic**: it uses exactly the
provider/model you configured with `chalc config-ia` (for example a local Ollama model) and works on the
project you point it at — ideally one already equipped by chalc.

- **Deterministic tools**: `read`, `list`, `grep`, `write`, `edit`, and `bash` (with a command allowlist).
  Writes, edits, and shell commands require **per-action approval**: `y` approves, `n` rejects,
  `a` approves everything for the rest of the instruction.
- **Equipped skills**: the compact index always goes into the prompt; the full `SKILL.md` only for the
  skills relevant to the task (the mandatory ones — clean-code, SOLID… — always go in).
- **Project MCP**: connects the servers from the equipped `.mcp.json`, showing you the command and asking
  for **per-server approval** before running it (opening someone else's repo never executes anything blindly).
- **Built-in CCR**: compresses bulky observations (long files, shell output) so the local model's window
  doesn't fill up; the agent expands them on demand with `recall`.
- **Runtime control** (Claude Code style): `/model [name]` switches the model **hot** without losing
  the conversation, `/tools` lists the available tools (fs + shell + MCP), `/tokens` shows the
  session's accumulated usage, `/agents` shows the team and its current activity, `/clear` resets
  the conversation, `/skills`, `/mcp`, `/help`, `/exit`.
- **Non-blocking agent panel**: `/agents` is handled immediately even while an agent is working or
  waiting for approval; it is not paused, interrupted, or queued. It shows status, elapsed time,
  model/provider, task, and the latest real tool used by the leader, developer, and reviewer. The
  input box remains available for typing or queueing changes.
- **Interrupt without quitting**: `ESC` (in the TUI) or `Ctrl+C` (in scroll mode) cancel the running
  turn — the agent stops at the end of the current step and does NOT execute whatever action it was
  proposing; the session stays alive. In the TUI you can also **keep typing while it works**:
  instructions are queued and processed when the turn finishes.
- The TUI is the default view: the conversation lives in the terminal's NORMAL buffer (native
  scrollback — the full session survives after exit) with the input box always pinned at the bottom.
  Mouse wheel / PgUp opens a reading mode over the history with the box still usable; if the agent
  prints while you read, a "↓ N new messages" notice appears and `End` returns to live.
  `CHALC_TUI=0` falls back to the classic scroll mode (robust in any terminal).

**Per-role models** — the cli TEAM (leader/developer/reviewer): configured with **`chalc config-ia cli`**,
which asks only about the shell (where does each role run and which model), using plain-language role
names. Each role can even live on a DIFFERENT provider with its own API key (e.g. a cloud leader and
reviewer via OpenRouter, and a local Ollama developer). Unconfigured, all roles use the default model.
`/model <name>` hot-switches it within the session. The other packages configure separately too:
`config-ia spec`, `config-ia qa`, `config-ia repair` — each asks only for its own model.

### The team process (`/plan`): leader → developer → reviewer

`/plan <task>` runs the whole team. The agents don't chat with each other: they communicate through
auditable artifacts persisted in the project.

1. **The LEADER plans and writes the spec — in ONE call.** It receives the full project context
   (skills, MCP, instructions file, constitution, architecture, folder READMEs) plus the project's
   spec template (`specs/_template/spec.md`) when it exists. It delivers two artifacts:
   `.chalc/plan.md` (the work-order checklist, including the LITERAL order each task will receive)
   and the **spec** — following the project's template (EARS requirements R1, R2…) with one
   `## Task N` section per step — saved into the project's `specs/NNN-slug/` folder (`.chalc/spec.md`
   as fallback) and linked from the plan. Only files stamped by chalc are ever overwritten: a spec
   written by the user (or by `spec-ia`) is never touched.
2. **The DEVELOPER executes task by task.** Each turn carries ONE order with ONLY its `## Task N`
   section — small, explicit context. If in doubt it must READ the specs; it never writes them
   (spec-authoring steps are routed to the leader). The harness — never the model — ticks each `[x]`
   in `plan.md` on real evidence (file written / command run). A dropped run resumes with `/plan`
   (no argument) from the first pending task, without paying the leader again.
3. **The REVIEWER closes the quality loop against the contract.** It receives the approved spec, the
   execution plan (with the harness-verified `[x]`) and the relevant skills, and reviews the diff in
   read-only mode on two dimensions: contract compliance (requirements, complete tasks) and code
   quality (conventions, architecture, real imports, no hollow deliverables). Findings are traceable
   ("R2 unmet", with file and cause); fixes are always executed by the developer through logged
   literal orders, and every round lands in `.chalc/review.md`. After its OK, the stack's real build
   runs as the final deterministic gate.

Additional optional configuration in `~/.chalc/config.json`, under the `cli` block: `numCtx` (model
window), `trust` (`safe`, `dev`, `trusted` shell profile), `allow` (custom shell allowlist),
`mcpApproval` (`always` by default; use `mutating` only for a trusted server), `mcpEnvAllowlist` (environment
variables a project MCP may resolve), `allowPrivateMcpHttp` (local opt-in for a private HTTP MCP), `budgetTokens`
(prompt budget), and `maxSteps` (steps per instruction).

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

- The **API key** lives in `~/.chalc/config.json` (`600` file / `700` directory permissions), **never** in the project or in `.chalc.json`; masked input and atomic local writes.
- Remote sources for `spec-ia` use timeout, size limit, and redirect validation; non-HTTP(S) protocols, `localhost`, and private/local IPs are blocked.
- Calls to AI providers have a timeout to avoid hung processes.
- AI traces store hashes, counts, and metadata; they don't store prompts, source documents, or secrets.
- The ids of targets, skills, MCP, rules, and methods are validated as safe kebab-case before being used as paths or imports.
- Installing skills from Git/GitHub or `skills.sh` requires interactive confirmation or `--allow-exec` in non-interactive mode.
- Remote MCP HTTP endpoints are validated against public DNS/IPs, redirects are rejected, and every MCP call requires approval by default. Private HTTP MCP is a local-user opt-in, never enabled by a project.
- QA login confirms its destination before accepting credentials; screenshots are off by default (`--screenshots`) and, when requested, are kept under ignored `.chalc/qa-evidence/`.
- Skill updates stage, verify and atomically swap the vendored copy, preserving the previous version if validation fails.
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
| **Codex CLI** | `AGENTS.md` | `.chalc/skills/<id>/` (referenced) | `.codex/config.toml` (`[mcp_servers.<id>]`, managed block) |

All of them also write `.chalc.json` (manifest). Adding another assistant = one `targets/<nombre>.mjs` with `apply()`, reusing the catalog and rules.
