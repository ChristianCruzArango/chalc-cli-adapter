---
name: mutation-testing
description: Mutation testing for ANY stack — verify the tests actually catch bugs, not just pass. Required final step of the SDD Implement phase (constitution "test quality" article) and whenever writing or strengthening tests or wiring CI. Kill the mutants; target ≥80% mutation score. Framework-agnostic: detects the project's existing unit-test setup and uses the matching tool (Stryker + its runner, Stryker.NET, mutmut, PIT, Gremlins, cargo-mutants, Infection).
metadata:
  source: chalc-authored
  updated: "2026"
---

# Mutation Testing (any language, any test framework)

> **This repo's stack could not be detected.** chalc did not resolve it from the root signals,
> so no per-stack guidance is given here — use the full table below, and fill
> `test.command` and `mutation.*` in `.chalc/gate.json` yourself.

A passing test isn't proof of quality — it must **catch bugs**. Mutation testing introduces small
changes (mutants) into the code and checks whether your tests fail (kill the mutant). Surviving
mutants = weak or missing tests. This is the **final gate of the SDD Implement phase** (after
Red → Green → Refactor) and is mandated by the project constitution (test quality).

> **The gate runs this and checks it.** An equipped repo carries `.chalc/gate.mjs`: it executes the
> command in `.chalc/gate.json` and reads the **native report file** the tool writes. The score comes
> from that file — never from a summary you type. A missing tool, a missing report, or a report older
> than the code you changed is a **BLOCKER**, not a pass.
>
> Your job is to install and configure the tool **PROJECT-LOCAL** (dev-dependency / tool manifest),
> **never `-g` global**, so the version is pinned and reproducible in CI — and to make it write its
> report **where the gate reads it** (table below). Commit the config.

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

| Language | Install once, project-local (if missing) | Run | Native report the gate parses |
|---|---|---|---|
| JS / TS | `npm i -D @stryker-mutator/core @stryker-mutator/{runner}` | `npx --no-install stryker run` | `reports/mutation/mutation.json` |
| .NET / C# | `dotnet new tool-manifest && dotnet tool install dotnet-stryker` | `dotnet stryker` | `StrykerOutput/**/reports/mutation-report.json` |
| Dart / Flutter | — | — | **no parser yet** |
| Python | `uv add --dev mutmut` | `mutmut run && mutmut junitxml > reports/mutation/mutmut.xml` | `reports/mutation/mutmut.xml` |
| Java / Kotlin (Maven) | — | `mvn org.pitest:pitest-maven:mutationCoverage` | `target/pit-reports/**/mutations.xml` |
| Rust | — | — | **no parser yet** |
| PHP | — | — | **no parser yet** |

### The report is the evidence — make the tool write it
The gate never reads the tool's stdout, because stdout is exactly what a summary can fake. It parses
the report file. Two tools need you to ask for it explicitly:

- **StrykerJS does not write the JSON report by default.** Its default reporters are HTML and
progress. Add the `json` reporter to `stryker.conf.json` (and commit it):

```json
{
  "reporters": ["html", "json", "progress"],
  "jsonReporter": { "fileName": "reports/mutation/mutation.json" }
}
```

- **mutmut prints results to the screen.** `mutmut results` is for humans; the gate needs the file,
so the run always ends with the `junitxml` redirect into `reports/mutation/mutmut.xml`.

Note the `--no-install` in the JS command: plain `npx stryker run` **downloads** whatever it cannot
find — and the bare `stryker` package on npm is an abandoned 2019 release, not `@stryker-mutator/core`.
The gate never installs anything, so neither does the command it launches. If the tool is missing, the
stage blocks and prints the exact install command instead of pulling a random package from the network.

If you change where the report lands, change `mutation.report` in `.chalc/gate.json` to match. That
file is the single place the gate reads its configuration from.

### Stacks the gate cannot verify yet
Dart / Flutter, Rust, PHP have no report parser in the gate. There the mutation stage ends as a
**BLOCKER** by default, and that is deliberate: the gate says "I could not verify this", never
"this passed".

Two honest ways out — pick one **with the user**, never on your own:

1. **Configure a tool the gate can read.** Point `mutation.command`, `mutation.report` and
   `mutation.format` in `.chalc/gate.json` at a tool that writes one of the supported formats
   (`elements`, `junit`, `pit`).
2. **Declare the stage not applicable**: set `"required": false` inside `mutation` in
   `.chalc/gate.json`. The stage is then reported as *not applicable* instead of blocking, and the
   reason is recorded in `.chalc/gate.md` on every run. This only works where the gate has **no
   parser for the stack** — on a repo it can measure, the flag is ignored and the stage runs anyway.

Do not work around a blocker by editing the gate code: it is regenerated on every equip.

### JS/TS — framework → Stryker runner (lookup, not a stack rule)
| Detected unit-test framework | Runner plugin |
|---|---|
| Jest (incl. NestJS, jest-preset-angular) | `@stryker-mutator/jest-runner` |
| Karma / Jasmine (Angular clásico) | `@stryker-mutator/karma-runner` |
| Vitest (incl. Angular vía su plugin de Vite) | `@stryker-mutator/vitest-runner` |
| Mocha | `@stryker-mutator/mocha-runner` |
| Jasmine (suelto) | `@stryker-mutator/jasmine-runner` |

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
4. Reach **≥ 80% mutation score** on critical logic (`mutation.threshold` in `.chalc/gate.json`).
5. Close the task by running the gate: `node .chalc/gate.mjs`. It reruns the tool, parses the report
   and writes the evidence to `.chalc/gate.md`. Your word is not the evidence; that file is.

## Cleanup (don't leave or commit artifacts)
Mutation tools create temp sandboxes and reports.
- **Remove the temp sandbox.** Stryker deletes `.stryker-tmp/` on its own when `cleanTempDir` is on
  (default); if a crash leaves it behind, delete it. Same idea for `.mutmut-cache/`.
- **Never delete the report before the gate reads it.** `reports/mutation/`, `StrykerOutput/` and
  `target/pit-reports/` are the evidence, not sandbox litter. Deleting them makes the gate block with
  "the tool left no report".
- **Never commit run output.** Add the temp and report paths to `.gitignore` (`.stryker-tmp/`,
  `reports/mutation/`, `StrykerOutput/`). Commit only the **config** (`stryker.conf.json` / equivalent).

## Where it fits in SDD
`Red (failing test) → Green (code) → Refactor → MUTATION TESTING (kill mutants) → GATE (verifies it)`.
No feature closes with surviving mutants in critical logic. If it's blocked by environment or tooling,
say so as a blocker and keep the task open — the gate will not let it pass either, and that is the
point: an unverified run is never a green run.

## Don'ts
- **Don't pick a runner by language/stack** — pick it from the project's detected test framework.
- **Don't invent a parallel test config** — reuse the project's existing one so it compiles.
- **Don't install `-g` global** — project-local only (pinned, reproducible, plugin resolution works).
- Don't chase 100% blindly — focus mutation effort on business/critical logic.
- Don't run full mutation on every commit if it's slow: changed files in PRs, full run in nightly CI.
- Don't "kill" a mutant by deleting code — kill it by improving the test.
- **Don't report a score you did not read from the report file** — the gate parses that same file and
  will contradict you.
- **Don't edit `.chalc/gate.mjs` or the modules under `.chalc/gate/`** to get past a blocker: they are
  regenerated on every equip. Configuration goes in `.chalc/gate.json`.
