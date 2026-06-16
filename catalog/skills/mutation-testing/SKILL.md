---
name: mutation-testing
description: Mutation testing for ANY stack — verify the tests actually catch bugs, not just pass. Required final step of the SDD Implement phase (constitution "test quality" article) and whenever writing or strengthening tests or wiring CI. Kill the mutants; target ≥80% mutation score. Framework-agnostic: detects the project's existing unit-test setup and uses the matching tool (Stryker + its runner, Stryker.NET, mutmut, PIT, Gremlins, cargo-mutants, Infection).
metadata:
  source: chalc-authored
  updated: "2026"
---

# Mutation Testing (any language, any test framework)

A passing test isn't proof of quality — it must **catch bugs**. Mutation testing introduces small
changes (mutants) into the code and checks whether your tests fail (kill the mutant). Surviving
mutants = weak or missing tests. This is the **final gate of the SDD Implement phase** (after
Red → Green → Refactor) and is mandated by the project constitution (test quality).

> This skill is **guidance**, not an executor. Chalc does not run mutation testing — YOU (the assistant)
> install and run the tool **in the project**. Install it **PROJECT-LOCAL** (dev-dependency / tool
> manifest), **never `-g` global**, so the version is pinned and reproducible in CI. Commit the config.

## Core principle: detect, reuse, configure, report — never assume

The runner is decided by the project's **actual unit-test framework**, NOT by its language or stack.
Two Angular apps can use Karma, Jest or Vitest; do not guess. Always, in this order:

1. **Detect** the existing test framework from real signals — `package.json` (deps/scripts like
   `jest`, `karma`, `vitest`, `mocha`, `jasmine`, `ng test`, `@analogjs/vite-plugin-angular`) and
   config files (`jest.config.*`, `karma.conf.js`, `vitest.config.*`, `.mocharc*`).
2. **Reuse** that framework's existing config. The Stryker runner runs the project's own tests —
   point it at the config the project already has. **Never invent a parallel test config** (that's
   why a hand-written `vitest.config.ts` "doesn't compile components": it dropped the project's
   compiler plugin). If the real tests compile, mutation testing compiles.
3. **Configure** via the project's own `stryker.conf.json` (commit it). That file is the single,
   per-project config surface — including an explicit runner override. **Respect an explicit
   override over detection.**
4. **Report & ask** — state what you detected and what you'll use
   (e.g. "framework: vitest → runner: @stryker-mutator/vitest-runner → reusing vitest.config.ts").
   If detection is ambiguous, the runner can't compile, or the install is blocked (private registry,
   missing auth), **stop and report it as a blocker and ask — do NOT silently switch runner or invent
   config.**

## Pick the tool by language; pick the JS/TS runner by detected framework

| Language | Install once, project-local (if missing) | Run |
|---|---|---|
| JS / TS | `npm i -D @stryker-mutator/core` **+ the runner that matches the detected framework** (see mapping below). Then `npx stryker init` (reuses your existing test config). | `npx stryker run` |
| .NET / C# | `dotnet new tool-manifest` (once) → `dotnet tool install dotnet-stryker` (**local**, writes `.config/dotnet-tools.json`, commit it) | `dotnet stryker` |
| Python | `uv add --dev mutmut` (or, inside a venv, `pip install mutmut`) | `uv run mutmut run` → `mutmut results` |
| Java / Kotlin | PIT plugin in `pom.xml` (project build) | `mvn org.pitest:pitest-maven:mutationCoverage` |
| Go | no install: `go run github.com/go-gremlins/gremlins/cmd/gremlins@latest unleash` | (same command) |
| Rust | `cargo install --locked cargo-mutants` (cargo subcommand, user-level) | `cargo mutants` |
| PHP | `composer require --dev infection/infection` | `vendor/bin/infection` |

### JS/TS — framework → Stryker runner (lookup, not a stack rule)
| Detected unit-test framework | Runner plugin |
|---|---|
| Jest (incl. NestJS, jest-preset-angular) | `@stryker-mutator/jest-runner` |
| Karma / Jasmine (classic Angular) | `@stryker-mutator/karma-runner` |
| Vitest (incl. Angular via its Vite plugin) | `@stryker-mutator/vitest-runner` (reuses the project's `vitest.config.*`, plugins included) |
| Mocha | `@stryker-mutator/mocha-runner` |
| Jasmine (standalone) | `@stryker-mutator/jasmine-runner` |

Notes:
- **StrykerJS = `@stryker-mutator/core` + ONE runner plugin** (table above). `npx stryker init` reuses
  your existing framework config; commit `stryker.conf.json`.
- **Private registry?** Don't go global (it reads the same `.npmrc` and breaks plugin resolution).
  Scope only Stryker to public npm: `@stryker-mutator:registry=https://registry.npmjs.org/`, or fix the
  feed token. Report it if you can't.
- These are **dev-time** tools — they do NOT ship to production. Still, pin them as dev-deps and check for
  known CVEs: `npm audit` · `dotnet list package --vulnerable` · `pip-audit` · `composer audit`.

## The loop (right after TDD Green/Refactor)
1. Run the mutation tool on the code you changed (scope `mutate` to the feature's files — fast and focused).
2. Read the **surviving mutants** — each one is a bug your tests do NOT catch.
3. Add or strengthen tests until those mutants are killed.
4. Reach **≥ 80% mutation score** on critical logic (set the threshold in the tool config).

## Cleanup (don't leave or commit artifacts)
Mutation tools create temp sandboxes and reports. When the run finishes:
- **Remove the temp sandbox.** Stryker deletes `.stryker-tmp/` on its own when `cleanTempDir` is on
  (default); if a crash leaves it behind, delete it. Same idea for other tools (e.g. `.mutmut-cache/`,
  PIT's `target/pit-reports/`).
- **Never commit it.** Add the temp/report paths to the project's `.gitignore`, e.g.
  `.stryker-tmp/` and the mutation report dir (`reports/mutation/`). Commit only the **config**
  (`stryker.conf.json` / equivalent), not the run output.

## Where it fits in SDD
`Red (failing test) → Green (code) → Refactor → MUTATION TESTING (kill mutants)`.
No feature closes with surviving mutants in critical logic. If it's blocked by environment/tooling,
keep the task open (traceability) and move the run to CI — don't drop it.

## Don'ts
- **Don't pick a runner by language/stack** — pick it from the project's detected test framework.
- **Don't invent a parallel test config** — reuse the project's existing one so it compiles.
- **Don't install `-g` global** — project-local only (pinned, reproducible, plugin resolution works).
- Don't chase 100% blindly — focus mutation effort on business/critical logic.
- Don't run full mutation on every commit if it's slow: changed files in PRs, full run in nightly CI.
- Don't "kill" a mutant by deleting code — kill it by improving the test.
