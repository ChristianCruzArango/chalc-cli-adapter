---
name: mutation-testing
description: Mutation testing for ANY stack — verify the tests actually catch bugs, not just pass. Required final step of the SDD Implement phase (constitution "test quality" article) and whenever writing or strengthening tests or wiring CI. Kill the mutants; target ≥80% mutation score. Picks the right tool per language (Stryker, Stryker.NET, mutmut, PIT, Gremlins, cargo-mutants, Infection).
metadata:
  source: chalc-authored
  updated: "2026"
---

# Mutation Testing (any language)

A passing test isn't proof of quality — it must **catch bugs**. Mutation testing introduces small
changes (mutants) into the code and checks whether your tests fail (kill the mutant). Surviving
mutants = weak or missing tests. This is the **final gate of the SDD Implement phase** (after
Red → Green → Refactor) and is mandated by the project constitution (test quality).

> This skill is **guidance**, not an executor. Chalc does not run mutation testing — YOU (the assistant)
> install and run the tool **in the project**. Install it **PROJECT-LOCAL** (dev-dependency / tool
> manifest), **never `-g` global**, so the version is pinned and reproducible in CI. Commit the config.

## Setup & run by stack (always project-local)
| Stack | Install once, project-local (if missing) | Run |
|---|---|---|
| JS / TS | `npm i -D @stryker-mutator/core` **+ the runner for your test framework**: `@stryker-mutator/jest-runner` (Jest/NestJS), `@stryker-mutator/karma-runner` (Angular), `@stryker-mutator/vitest-runner`, `@stryker-mutator/mocha-runner`, `@stryker-mutator/jasmine-runner`. Then `npx stryker init`. | `npx stryker run` |
| .NET / C# | `dotnet new tool-manifest` (once) → `dotnet tool install dotnet-stryker` (**local**, writes `.config/dotnet-tools.json`, commit it) | `dotnet stryker` |
| Python | `uv add --dev mutmut` (or, inside a venv, `pip install mutmut`) | `uv run mutmut run` → `mutmut results` |
| Java / Kotlin | PIT plugin in `pom.xml` (project build) | `mvn org.pitest:pitest-maven:mutationCoverage` |
| Go | no install: `go run github.com/go-gremlins/gremlins/cmd/gremlins@latest unleash` | (same command) |
| Rust | `cargo install --locked cargo-mutants` (cargo subcommand, user-level) | `cargo mutants` |
| PHP | `composer require --dev infection/infection` | `vendor/bin/infection` |

Notes:
- **StrykerJS = `@stryker-mutator/core` + ONE test-runner plugin** (see table). `npx stryker init` can add it for you. Commit `stryker.conf.json`.
- These are **dev-time** tools — they do NOT ship to production. Still, pin them as dev-deps and check for known CVEs:
  `npm audit` · `dotnet list package --vulnerable` · `pip-audit` · `composer audit`. Fix or update before relying on them in CI.

## The loop (right after TDD Green/Refactor)
1. Run the mutation tool on the code you changed.
2. Read the **surviving mutants** — each one is a bug your tests do NOT catch.
3. Add or strengthen tests until those mutants are killed.
4. Reach **≥ 80% mutation score** on critical logic (set the threshold in the tool config).

## Where it fits in SDD
`Red (failing test) → Green (code) → Refactor → MUTATION TESTING (kill mutants)`.
No feature closes with surviving mutants in critical logic.

## Don'ts
- Don't chase 100% blindly — focus mutation effort on business/critical logic.
- Don't run full mutation on every commit if it's slow: run on changed files in PRs, full run in nightly CI.
- Don't "kill" a mutant by deleting code — kill it by improving the test.
